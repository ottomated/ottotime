import * as vscode from 'vscode';
import { FSWatcher, watch } from 'fs';
import { Items, read } from '../serde.mjs';
import { uneval } from 'devalue';
import type { PreinitializedWritableAtom } from 'nanostores';

export class OttotimePreview
	implements vscode.CustomEditorProvider<OttotimeCustomDocument>
{
	constructor(
		private context: vscode.ExtensionContext,
		private $workspaceFolder: PreinitializedWritableAtom<
			vscode.WorkspaceFolder | undefined
		>,
	) {}

	async openCustomDocument(uri: vscode.Uri) {
		const watcher = watch(uri.fsPath);
		const items = read(Buffer.from(await vscode.workspace.fs.readFile(uri)));
		return new OttotimeCustomDocument(uri, watcher, items);
	}

	resolveCustomEditor(
		document: OttotimeCustomDocument,
		webviewPanel: vscode.WebviewPanel,
	) {
		const webview = webviewPanel.webview;
		webview.options = { enableScripts: true };

		const nonce = Date.now();

		document.listeners.push(
			document.onChange((e) => {
				webview.postMessage({ type: 'items', items: e.items });
			}),
		);
		document.listeners.push(
			new vscode.Disposable(
				this.$workspaceFolder.subscribe((workspace) => {
					webview.postMessage({
						type: 'workspace',
						workspace: workspace?.name ?? null,
					});
				}),
			),
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
	watcher: FSWatcher;
	uri: vscode.Uri;

	items: Items;

	listeners: vscode.Disposable[] = [];

	private readonly _onChange = new vscode.EventEmitter<{ items: Items }>();
	readonly onChange = this._onChange.event;

	constructor(uri: vscode.Uri, watcher: FSWatcher, items: Items) {
		this.uri = uri;
		this.watcher = watcher;
		this.items = items;
		watcher.on('change', async () => {
			this.items = read(
				Buffer.from(await vscode.workspace.fs.readFile(this.uri)),
			);
			this._onChange.fire({ items: this.items });
		});
	}

	dispose(): void {
		this._onChange.dispose();
		this.watcher.close();
		this.listeners.forEach((l) => l.dispose());
	}
}
