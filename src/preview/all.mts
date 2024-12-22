import * as vscode from 'vscode';
import { read } from '../serde.mjs';
import { atom } from 'nanostores';
import { OttotimeCustomDocument } from './editor.mjs';

export async function previewAll(context: vscode.ExtensionContext) {
	const {
		workspaces: recent,
	}: { workspaces: Array<{ folderUri: vscode.Uri }> } =
		await vscode.commands.executeCommand('_workbench.getRecentlyOpened');

	const workspaces = await Promise.allSettled(
		recent.map(async (workspace) => {
			const ottotime = vscode.Uri.joinPath(workspace.folderUri, '.ottotime');
			const contents = await vscode.workspace.fs.readFile(ottotime);
			const items = read(Buffer.from(contents));
			return new OttotimeCustomDocument(ottotime, items);
		}),
	).then((d) => d.filter((d) => d.status === 'fulfilled').map((d) => d.value));

	const panel = vscode.window.createWebviewPanel(
		'ottotime.all',
		'Ottotime',
		vscode.ViewColumn.One,
		{ enableScripts: true },
	);

	panel.iconPath = {
		light: vscode.Uri.joinPath(context.extensionUri, 'icon-light.svg'),
		dark: vscode.Uri.joinPath(context.extensionUri, 'icon-dark.svg'),
	};
	context.subscriptions.push(panel);
	panel.onDidDispose(() => {
		workspaces.forEach((w) => w.dispose());
	});
}
