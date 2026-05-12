import * as vscode from 'vscode';
import { FSWatcher, watch } from 'fs';
import { Items, read } from '../serde.mjs';
import type { PreinitializedWritableAtom } from 'nanostores';
import { getHtml } from './html.mjs';

export type Message =
	| {
			type: 'items';
			items: Items;
			i?: number;
	  }
	| {
			type: 'workspace';
			workspace: string | null;
			i?: number;
	  }
	| {
			type: 'currentSession';
			currentSession: null | { start: number; end: number };
			i?: number;
	  };

export class OttotimePreview implements vscode.CustomEditorProvider<OttotimeCustomDocument> {
	constructor(
		private context: vscode.ExtensionContext,
		private $workspaceFolder: PreinitializedWritableAtom<
			vscode.WorkspaceFolder | undefined
		>,
		private $currentSession: PreinitializedWritableAtom<null | {
			start: number;
			end: number;
		}>,
	) {}

	async openCustomDocument(uri: vscode.Uri) {
		const visibleUri = uri;
		let underlyingUri = vscode.Uri.joinPath(uri, '../.git/.ottotime');
		let buffer: Uint8Array;
		try {
			buffer = await vscode.workspace.fs.readFile(underlyingUri);
			if (buffer.length === 0) {
				buffer = await vscode.workspace.fs.readFile(uri);
				underlyingUri = uri;
			}
		} catch (e) {
			if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
				buffer = await vscode.workspace.fs.readFile(uri);
				underlyingUri = uri;
			} else {
				throw e;
			}
		}
		const items = read(Buffer.from(buffer));
		return new OttotimeCustomDocument(visibleUri, underlyingUri, items);
	}

	resolveCustomEditor(
		document: OttotimeCustomDocument,
		webviewPanel: vscode.WebviewPanel,
	) {
		const webview = webviewPanel.webview;
		webview.options = { enableScripts: true };

		function send(message: Message) {
			webview.postMessage(message);
		}

		// If no file watcher,
		const trackCurrentSession = !!document.watcher;

		document.listeners.push(
			document.onChange((e) => {
				send({ type: 'items', items: e.items });
			}),
		);
		if (trackCurrentSession) {
			document.listeners.push(
				new vscode.Disposable(
					this.$currentSession.subscribe((currentSession) => {
						send({
							type: 'currentSession',
							currentSession,
						});
					}),
				),
			);
		}
		document.listeners.push(
			new vscode.Disposable(
				this.$workspaceFolder.subscribe((workspace) => {
					send({
						type: 'workspace',
						workspace: workspace?.name ?? null,
					});
				}),
			),
		);

		document.listeners.push(
			webview.onDidReceiveMessage((command) => {
				if (command === 'mounted') {
					send({ type: 'items', items: document.items });
					if (trackCurrentSession) {
						send({
							type: 'currentSession',
							currentSession: this.$currentSession.get(),
						});
					}
					return;
				}
				if (command === 'edit') {
					vscode.commands.executeCommand(
						'vscode.openWith',
						document.underlyingUri,
						'default',
					);
					return;
				}
			}),
		);

		webview.html = getHtml(
			[
				{
					items: document.items,
					workspace: this.$workspaceFolder.get()?.name ?? null,
					currentSession: trackCurrentSession
						? this.$currentSession.get()
						: null,
				},
			],
			true,
			webview,
			this.context,
		);
	}

	//#region readonly scaffolding
	onDidChangeCustomDocument = new vscode.EventEmitter<never>().event;
	async saveCustomDocument() {}
	async saveCustomDocumentAs() {}
	async revertCustomDocument() {}
	async backupCustomDocument() {
		return { id: '', delete() {} };
	}
	//#endregion
}

export class OttotimeCustomDocument implements vscode.CustomDocument {
	watcher?: FSWatcher;
	uri: vscode.Uri;
	underlyingUri: vscode.Uri;

	items: Items;

	listeners: vscode.Disposable[] = [];

	private readonly _onChange = new vscode.EventEmitter<{ items: Items }>();
	readonly onChange = this._onChange.event;

	constructor(visibleUri: vscode.Uri, underlyingUri: vscode.Uri, items: Items) {
		this.uri = visibleUri;
		this.underlyingUri = underlyingUri;
		this.items = items;
		if (this.underlyingUri.scheme !== 'file') return; // Don't watch non-file uris
		try {
			this.watcher = watch(this.underlyingUri.fsPath);
			this.watcher.on('change', async () => {
				this.items = read(
					Buffer.from(await vscode.workspace.fs.readFile(this.underlyingUri)),
				);
				this._onChange.fire({ items: this.items });
			});
		} catch (e) {
			// Watching failed, we just won't get any updates
			console.error(e);
		}
	}

	dispose(): void {
		this._onChange.dispose();
		this.watcher?.close();
		this.listeners.forEach((l) => l.dispose());
	}
}
