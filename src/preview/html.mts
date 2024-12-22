import { uneval } from 'devalue';
import * as vscode from 'vscode';
import { Items } from '../serde.mjs';

export function getHtml(
	initial: Array<{
		items: Items;
		workspace: string | null;
		currentSession: null | { start: number; end: number };
	}>,
	single: boolean,
	webview: vscode.Webview,
	context: vscode.ExtensionContext,
) {
	const nonce = Date.now();
	const scriptUri = webview.asWebviewUri(
		vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js'),
	);
	const cssUri = webview.asWebviewUri(
		vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.css'),
	);
	return /* html */ `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="${cssUri}"></head><body><div id="app"></div><script nonce="${nonce}">window.initial = ${uneval(initial)};window.single = ${single};</script><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
}
