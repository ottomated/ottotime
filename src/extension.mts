import * as vscode from 'vscode';
import { atom } from 'nanostores';
import { DataPersister } from './serde.mjs';
import { OttotimePreview } from './preview/editor.mjs';

const TIMEOUT_SECONDS = 5 * 60;

export async function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('ottotime');
	function log(message: string) {
		output.appendLine(message);
		console.log(message);
	}

	const $enabled = atom(context.workspaceState.get('ottotime.enabled', true));
	const $workspaceFolder = atom(vscode.workspace.workspaceFolders?.[0]);
	const $active = atom(vscode.window.state.focused);
	let currentSession: { index: number; end: number } | null = null;
	let persister: DataPersister | null = null;

	vscode.window.registerCustomEditorProvider(
		'ottotime.preview',
		new OttotimePreview(context, $workspaceFolder),
		{ supportsMultipleEditorsPerDocument: true },
	);

	//#region Sync state
	context.subscriptions.push(
		vscode.commands.registerCommand('ottotime.importKey', async () => {
			const value = await vscode.window.showInputBox({
				prompt: 'Paste your encryption key',
				value: context.globalState.get('ottotime.key'),
			});
			if (!value) return;
			context.globalState.update('ottotime.key', value);
			log('Imported key, reloading window');
			vscode.commands.executeCommand('workbench.action.reloadWindow');
		}),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('ottotime.disable', () => {
			log('Disabled');
			$enabled.set(false);
		}),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('ottotime.enable', () => {
			log('Enabled');
			$enabled.set(true);
		}),
	);
	context.subscriptions.push(
		vscode.window.onDidChangeWindowState((e) => $active.set(e.focused)),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() =>
			$workspaceFolder.set(vscode.workspace.workspaceFolders?.[0]),
		),
	);
	//#endregion

	//#region Subscribe to state
	$enabled.subscribe((enabled) => {
		vscode.commands.executeCommand('setContext', 'ottotime.enabled', enabled);
		context.workspaceState.update('ottotime.enabled', enabled);
	});
	let focusedTimer: ReturnType<typeof setInterval> | null = null;
	$active.subscribe((active) => {
		if (focusedTimer !== null) {
			clearInterval(focusedTimer);
			focusedTimer = null;
		}
		if (active) {
			log('Window focused');
			focusedTimer = setInterval(tickFocused, 1000);
			tickFocused();
		} else {
			log('Window unfocused');
		}
	});
	context.subscriptions.push(
		new vscode.Disposable(() => {
			if (focusedTimer !== null) clearInterval(focusedTimer);
		}),
	);
	//#endregion

	$workspaceFolder.subscribe(async (workspace) => {
		log(`Workspace changed to ${workspace?.name ?? 'null'}`);
		if (!workspace) {
			persister = null;
			return;
		}
		const file = vscode.Uri.joinPath(workspace.uri, '.ottotime');
		persister = await DataPersister.create(file.fsPath);
	});

	async function tickFocused() {
		if (!persister) return;
		const now = Math.floor(Date.now() / 1000);
		if (currentSession && now - currentSession.end > TIMEOUT_SECONDS) {
			log('Ending previous session');
			currentSession = null;
		}
		if (!currentSession) {
			log('Creating new session');
			const index = await persister.add(now, now + 1);
			currentSession = {
				index,
				end: now + 1,
			};
			return;
		}
		currentSession.end = now;
		await persister.setEnd(currentSession.index, now);
	}

	context.subscriptions.push(
		new vscode.Disposable(() => {
			$enabled.off();
			$workspaceFolder.off();
			$active.off();
		}),
	);
}

export function deactivate() {}
