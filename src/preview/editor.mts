import * as vscode from 'vscode';
import { FSWatcher, watch } from 'fs';
import { Items, read } from '../serde.mjs';
import { uneval } from 'devalue';
import type { PreinitializedWritableAtom } from 'nanostores';

export type Message =
	| {
			type: 'items';
			items: Items;
	  }
	| {
			type: 'workspace';
			workspace: string | null;
	  }
	| {
			type: 'currentSession';
			currentSession: null | { start: number; end: number };
	  };

export class OttotimePreview
	implements vscode.CustomEditorProvider<OttotimeCustomDocument>
{
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
		const items = read(Buffer.from(await vscode.workspace.fs.readFile(uri)));
		return new OttotimeCustomDocument(uri, items);
	}

	resolveCustomEditor(
		document: OttotimeCustomDocument,
		webviewPanel: vscode.WebviewPanel,
	) {
		const webview = webviewPanel.webview;
		webview.options = { enableScripts: true };

		const nonce = Date.now();

		function send(message: Message) {
			webview.postMessage(message);
		}

		document.listeners.push(
			document.onChange((e) => {
				send({ type: 'items', items: e.items });
			}),
		);
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
				if (command === 'edit') {
					vscode.commands.executeCommand(
						'vscode.openWith',
						document.uri,
						'default',
					);
				}
			}),
		);
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'),
		);
		const cssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'),
		);

		webview.html = /* html */ `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link rel="stylesheet" href="${cssUri}">
				<title>Ottotime</title>
			</head>
			<body>
				<div id="app"></div>
				<script nonce="${nonce}">
					window.initial = ${uneval({
						items: document.items,
						workspace: this.$workspaceFolder.get()?.name ?? null,
						currentSession: this.$currentSession.get(),
						xss: '<script>alert("xss")</script>',
					})};
				</script>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
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

	items: Items;

	listeners: vscode.Disposable[] = [];

	private readonly _onChange = new vscode.EventEmitter<{ items: Items }>();
	readonly onChange = this._onChange.event;

	constructor(uri: vscode.Uri, items: Items) {
		this.uri = uri;
		this.items = items;
		try {
			this.watcher = watch(uri.fsPath);
			this.watcher.on('change', async () => {
				this.items = read(
					Buffer.from(await vscode.workspace.fs.readFile(this.uri)),
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
