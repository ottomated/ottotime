import * as vscode from 'vscode';
import { read } from '../serde.mjs';
import { Message, OttotimeCustomDocument } from './editor.mjs';
import { PreinitializedWritableAtom } from 'nanostores';
import { basename } from 'path';
import { getHtml } from './html.mjs';

type Workspace = {
	doc: OttotimeCustomDocument;
	name: string;
};

export async function previewAll(
	context: vscode.ExtensionContext,
	currentWorkspace: vscode.WorkspaceFolder | undefined,
	$currentSession: PreinitializedWritableAtom<null | {
		start: number;
		end: number;
	}>,
) {
	const {
		workspaces: recent,
	}: { workspaces: Array<{ folderUri: vscode.Uri }> } =
		await vscode.commands.executeCommand('_workbench.getRecentlyOpened');
	const workspaces: Array<Workspace> = [];

	let currentIndex: number | undefined;
	let foundCurrent = currentWorkspace === undefined;
	await Promise.all(
		recent.map(async (workspace) => {
			try {
				const ottotime = vscode.Uri.joinPath(workspace.folderUri, '.ottotime');
				const contents = await vscode.workspace.fs.readFile(ottotime);
				const items = read(Buffer.from(contents));

				let name: string;
				if (
					!foundCurrent &&
					workspace.folderUri.path === currentWorkspace!.uri.path
				) {
					foundCurrent = true;
					name = currentWorkspace!.name;
					currentIndex = workspaces.length;
				} else {
					name = basename(workspace.folderUri.path);
				}
				workspaces.push({
					doc: new OttotimeCustomDocument(ottotime, items),
					name,
				});
			} catch (e) {
				if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
					return null;
				}
				console.error(e);
			}
		}),
	);

	console.log(workspaces, currentIndex);
	const panel = vscode.window.createWebviewPanel(
		'ottotime.all',
		'Ottotime (all workspaces)',
		vscode.ViewColumn.One,
		{ enableScripts: true },
	);

	panel.iconPath = {
		light: vscode.Uri.joinPath(context.extensionUri, 'icon-light.svg'),
		dark: vscode.Uri.joinPath(context.extensionUri, 'icon-dark.svg'),
	};

	const webview = panel.webview;

	function send(message: Message) {
		webview.postMessage(message);
	}

	for (let i = 0; i < workspaces.length; i++) {
		const workspace = workspaces[i]!;
		workspace.doc.listeners.push(
			workspace.doc.onChange((e) => {
				send({
					type: 'items',
					items: e.items,
					i,
				});
			}),
		);
	}

	const mountedListener = webview.onDidReceiveMessage((command) => {
		if (command === 'mounted') {
			for (let i = 0; i < workspaces.length; i++) {
				const workspace = workspaces[i]!;
				send({
					type: 'items',
					items: workspace.doc.items,
					i,
				});
			}
			if (currentIndex !== undefined) {
				send({
					type: 'currentSession',
					currentSession: $currentSession.get(),
					i: currentIndex,
				});
			}
			return;
		}
	});

	let currentSessionD: ReturnType<typeof $currentSession.subscribe> | undefined;
	if (currentIndex !== undefined) {
		currentSessionD = $currentSession.subscribe((currentSession) => {
			send({
				type: 'currentSession',
				currentSession,
				i: currentIndex!,
			});
		});
	}

	webview.html = getHtml(
		workspaces.map((ws, i) => ({
			items: ws.doc.items,
			workspace: ws.name,
			currentSession: i === currentIndex ? $currentSession.get() : null,
		})),
		false,
		webview,
		context,
	);
	context.subscriptions.push(panel);
	panel.onDidDispose(() => {
		workspaces.forEach((w) => w.doc.dispose());
		mountedListener.dispose();
		currentSessionD?.();
	});
}
