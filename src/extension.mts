import * as vscode from 'vscode';
import { atom, computed } from 'nanostores';
import { DataPersister } from './serde.mjs';
import { OttotimePreview } from './preview/editor.mjs';
import { previewAll } from './preview/all.mjs';

const TIMEOUT_SECONDS = 5 * 60;

export async function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('ottotime');
	function log(message: string) {
		output.appendLine(message);
		console.log('{O}', message);
	}

	const $enabled = atom(context.workspaceState.get('ottotime.enabled', true));
	const $workspaceFolder = atom(vscode.workspace.workspaceFolders?.[0]);
	const $active = atom(vscode.window.state.focused);
	const $persister = computed($workspaceFolder, (workspace) => {
		if (!workspace) return null;
		const uri = vscode.Uri.joinPath(workspace.uri, '.ottotime');
		return new DataPersister(uri.fsPath);
	});
	const $currentSession = atom<null | { start: number; end: number }>(null);

	vscode.window.registerCustomEditorProvider(
		'ottotime.preview',
		new OttotimePreview(context, $workspaceFolder, $currentSession),
		{ supportsMultipleEditorsPerDocument: true },
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('ottotime.showtime', () => {
			const persister = $persister.get();
			if (!persister) return;
			vscode.commands.executeCommand(
				'vscode.open',
				vscode.Uri.file(persister.path),
			);
		}),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('ottotime.showalltimes', () =>
			previewAll(context, $workspaceFolder.get(), $currentSession),
		),
	);

	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		Number.MAX_VALUE,
	);
	statusBarItem.text = '$(otto-ottomated)';
	statusBarItem.command = 'ottotime.showtime';
	statusBarItem.show();

	//#region Sync state
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
	// sometimes it isn't updated immediately?
	setTimeout(() => {
		$active.set(vscode.window.state.focused);
	}, 5000);

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
			log('Window focused at ' + new Date().toISOString());
			focusedTimer = setInterval(tickFocused, 1000);
			tickFocused();
		} else {
			log('Window unfocused at ' + new Date().toISOString());
		}
	});
	$currentSession.subscribe((currentSession) => {
		if (!currentSession) {
			statusBarItem.text = `$(otto-ottomated)`;
			return;
		}

		const duration = currentSession.end - currentSession.start;
		const seconds = duration % 60;
		const minutes = (duration - seconds) / 60;
		statusBarItem.text = `$(otto-ottomated) ${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
	});
	context.subscriptions.push(
		new vscode.Disposable(() => {
			if (focusedTimer !== null) clearInterval(focusedTimer);
		}),
	);
	//#endregion

	let openSessionError: string | null = null;
	function showSessionError(error: string) {
		if (openSessionError === error) return;
		openSessionError = error;
		vscode.window.showErrorMessage(error).then(() => (openSessionError = null));
	}
	let lastSaved = 0;
	async function tickFocused() {
		if (!$enabled.get()) return;
		const persister = $persister.get();
		if (!persister) return;
		const now = Math.floor(Date.now() / 1000);
		let currentSession = $currentSession.get();
		if (currentSession && now - currentSession.end > TIMEOUT_SECONDS) {
			log(
				'Ending previous session at ' +
					new Date(currentSession.end * 1000).toISOString(),
			);
			try {
				await persister.updateSession(currentSession.start, currentSession.end);
			} catch (e) {
				console.error(e);
				showSessionError(String(e));
			}
			$currentSession.set(null);
			currentSession = null;
		}
		if (!currentSession) {
			log('Starting new session at ' + new Date(now * 1000).toISOString());
			try {
				const start = await persister.startSession(now);
				currentSession = { start, end: now };
				$currentSession.set(currentSession);
				lastSaved = now;
			} catch (e) {
				console.error(e);
				showSessionError(String(e));
			}
			return;
		}
		currentSession.end = now;
		// Save every 30 seconds
		if (now - lastSaved >= 30) {
			log(`Saving session at ${new Date(now * 1000).toISOString()}`);
			lastSaved = now;
			try {
				currentSession.start = await persister.updateSession(
					currentSession.start,
					currentSession.end,
				);
			} catch (e) {
				console.error(e);
				showSessionError(String(e));
			}
		}
		$currentSession.notify();
		await ensureGitAttributes($workspaceFolder.get()?.uri);
	}

	context.subscriptions.push(
		new vscode.Disposable(() => {
			$enabled.off();
			$workspaceFolder.off();
			$persister.off();
			$active.off();
			$currentSession.off();
		}),
	);
}

export function deactivate() {}

const MERGE_CONFIG_COMMENT = '# Prevents merge conflicts in Ottotime files';
const MERGE_CONFIG = '.ottotime merge=union';
async function ensureGitAttributes(root: vscode.Uri | undefined) {
	if (!root) return;
	let gitFolder: vscode.FileStat;
	try {
		gitFolder = await vscode.workspace.fs.stat(
			vscode.Uri.joinPath(root, '.git'),
		);
	} catch (e) {
		if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
			return;
		}
		throw e;
	}
	if (gitFolder.type !== vscode.FileType.Directory) return;

	const gitattributes = vscode.Uri.joinPath(root, '.gitattributes');
	try {
		let data = await vscode.workspace.fs
			.readFile(vscode.Uri.joinPath(root, '.gitattributes'))
			.then((d) => d.toString());
		if (data.includes(MERGE_CONFIG)) return;
		if (!data.endsWith('\n')) data += '\n';
		await vscode.workspace.fs.writeFile(
			gitattributes,
			Buffer.from(`${data}${MERGE_CONFIG_COMMENT}\n${MERGE_CONFIG}\n`),
		);
	} catch (e) {
		if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
			await vscode.workspace.fs.writeFile(
				gitattributes,
				Buffer.from(`${MERGE_CONFIG_COMMENT}\n${MERGE_CONFIG}\n`),
			);
		}
		throw e;
	}
}
