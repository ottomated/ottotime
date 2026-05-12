import * as vscode from 'vscode';
import { atom, computed } from 'nanostores';
import { createPersister, Items, merge, read, write } from './serde.mjs';
import { OttotimePreview } from './preview/editor.mjs';
import { previewAll } from './preview/all.mjs';
import { deleteGitConfig, ensureGitConfig, getGitFolder } from './git.mjs';
import { FSWatcher, watch } from 'fs';

const TIMEOUT_SECONDS = 5 * 60;

let onShutdown: (() => Promise<void>) | undefined;

export async function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('ottotime');
	function log(message: string) {
		output.appendLine(message);
		if (process.env.NODE_ENV !== 'production') {
			// eslint-disable-next-line no-console
			console.log('{O}', message);
		}
	}

	//#region $enabled - Whether the extension is enabled for the current workspace
	const $enabled = atom(context.workspaceState.get('ottotime.enabled', true));
	$enabled.subscribe((enabled) => {
		vscode.commands.executeCommand('setContext', 'ottotime.enabled', enabled);
		context.workspaceState.update('ottotime.enabled', enabled);
	});
	context.subscriptions.push(
		vscode.commands.registerCommand('ottotime.disable', async () => {
			log('Disabled');
			$enabled.set(false);

			// Delete file if there's not very much time in it
			const root = $workspaceFolder.get();
			if (!root) return;
			for (const uri of [
				vscode.Uri.joinPath(root.uri, '.ottotime'),
				vscode.Uri.joinPath(root.uri, '.git/.ottotime'),
			]) {
				try {
					const items = read(
						Buffer.from(await vscode.workspace.fs.readFile(uri)),
					);
					let total = 0;
					for (const item of items) {
						total += item.duration;
						if (total > 60 * 5) break;
					}
					if (total < 60 * 5) {
						// Less than 5 minutes, delete the file
						await vscode.workspace.fs.delete(uri);
					}
				} catch {
					/* ignore */
				}
			}
			await deleteGitConfig(root.uri);
		}),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('ottotime.enable', async () => {
			log('Enabled');
			$enabled.set(true);
			await ensureGitConfig($workspaceFolder.get()?.uri, context);
		}),
	);
	//#endregion

	//#region $workspaceFolder - The current folder
	const $workspaceFolder = atom(vscode.workspace.workspaceFolders?.[0]);
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() =>
			$workspaceFolder.set(vscode.workspace.workspaceFolders?.[0]),
		),
	);
	//#endregion

	//#region $active - Whether the window is focused
	const $active = atom(vscode.window.state.focused);
	// sometimes it isn't updated immediately?
	setTimeout(() => {
		$active.set(vscode.window.state.focused);
	}, 5000);
	context.subscriptions.push(
		vscode.window.onDidChangeWindowState((e) => $active.set(e.focused)),
	);
	//#endregion

	//#region $gitFolder - The .git folder in the current workspace
	const $gitFolder = atom(await getGitFolder($workspaceFolder.get()?.uri));
	async function updateGitFolder(uri: vscode.Uri | undefined) {
		if (!$enabled.get()) return;
		const folder = await getGitFolder(uri);
		if ($gitFolder.get()?.toString() !== folder?.toString()) {
			$gitFolder.set(folder);
		}
	}
	let gitWatcher: FSWatcher | null = null;
	let gitWatcherInterval: ReturnType<typeof setInterval> | null = null;
	$workspaceFolder.subscribe((workspaceFolder) => {
		if (gitWatcher !== null) {
			gitWatcher.close();
			gitWatcher = null;
		}
		if (gitWatcherInterval !== null) {
			clearInterval(gitWatcherInterval);
			gitWatcherInterval = null;
		}
		if (!workspaceFolder) return;
		const workspaceUri = workspaceFolder.uri;
		if (workspaceFolder.uri.scheme !== 'file') {
			gitWatcherInterval = setInterval(
				() => updateGitFolder(workspaceUri),
				1000,
			);
			return;
		}
		try {
			gitWatcher = watch(workspaceFolder.uri.fsPath);
			gitWatcher.on('change', async (ev) => {
				if (ev !== 'rename') return;
				await updateGitFolder(workspaceUri);
			});
		} catch (e) {
			output.appendLine(
				`Failed to watch ${workspaceUri.fsPath} - falling back to polling`,
			);
			console.error(e);
			gitWatcherInterval = setInterval(
				() => updateGitFolder(workspaceUri),
				1000,
			);
		}
	});
	context.subscriptions.push(
		new vscode.Disposable(() => {
			if (gitWatcher !== null) gitWatcher.close();
		}),
	);
	//#endregion

	const $persister = computed(
		[$workspaceFolder, $gitFolder],
		(workspaceFolder, gitFolder) => {
			if (!workspaceFolder) return null;
			const uri = gitFolder
				? vscode.Uri.joinPath(gitFolder, '.ottotime')
				: vscode.Uri.joinPath(workspaceFolder.uri, '.ottotime');
			return createPersister(uri, !!gitFolder);
		},
	);

	// Copy .ottotime to .git/.ottotime, only if it doesn't exist
	$persister.subscribe(async (persister, previous) => {
		if (!persister?.isGit) return;

		let oldUri = previous?.uri;
		if (!oldUri) {
			const workspaceFolder = $workspaceFolder.get();
			if (!workspaceFolder) return;
			oldUri = vscode.Uri.joinPath(workspaceFolder.uri, '.ottotime');
		}
		let publicFile: Items = [];
		let gitFile: Items = [];
		try {
			publicFile = read(
				Buffer.from(await vscode.workspace.fs.readFile(oldUri)),
			);
		} catch {
			/* ignore */
		}
		try {
			gitFile = read(
				Buffer.from(await vscode.workspace.fs.readFile(persister.uri)),
			);
		} catch {
			/* ignore */
		}
		const merged = merge(gitFile, publicFile);
		await vscode.workspace.fs.writeFile(persister.uri, write(merged));
	});

	//#region $currentSession - The active work session, and logic for saving it to the file
	const $currentSession = atom<null | { start: number; end: number }>(null);
	let focusedTimer: ReturnType<typeof setInterval> | null = null;
	context.subscriptions.push(
		new vscode.Disposable(() => {
			if (focusedTimer !== null) clearInterval(focusedTimer);
		}),
	);
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
	}
	//#endregion

	//#region Status Bar item
	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		Number.MAX_VALUE,
	);
	statusBarItem.text = '$(otto-ottomated)';
	statusBarItem.command = 'ottotime.showtime';
	statusBarItem.show();

	$currentSession.subscribe((currentSession) => {
		if (!currentSession) {
			statusBarItem.text = `$(otto-ottomated)`;
			return;
		}

		const duration = currentSession.end - currentSession.start;
		statusBarItem.text = `$(otto-ottomated) ${formatDuration(duration)}`;
	});
	//#endregion

	vscode.window.registerCustomEditorProvider(
		'ottotime.preview',
		new OttotimePreview(context, $workspaceFolder, $currentSession),
		{ supportsMultipleEditorsPerDocument: true },
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('ottotime.showtime', () => {
			const persister = $persister.get();
			if (!persister) return;
			const workspaceFolder = $workspaceFolder.get();
			if (!workspaceFolder) return;
			vscode.commands.executeCommand(
				'vscode.open',
				vscode.Uri.joinPath(workspaceFolder.uri, '.ottotime'),
			);
		}),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('ottotime.showalltimes', () =>
			previewAll(context, $workspaceFolder.get(), $currentSession),
		),
	);
	ensureGitConfig($workspaceFolder.get()?.uri, context);

	onShutdown = async () => {
		if (!$enabled.get()) return;
		const persister = $persister.get();
		if (!persister) return;
		const currentSession = $currentSession.get();
		if (!currentSession) return;
		const now = Math.floor(Date.now() / 1000);
		if (now - currentSession.end > TIMEOUT_SECONDS) return;
		try {
			await persister.updateSession(currentSession.start, currentSession.end);
		} catch (e) {
			console.error(e);
		}
	};

	context.subscriptions.push(
		new vscode.Disposable(() => {
			$enabled.off();
			$workspaceFolder.off();
			$persister.off();
			$active.off();
			$currentSession.off();
			$gitFolder.off();
		}),
	);
}

export async function deactivate() {
	await onShutdown?.();
}

function formatDuration(duration: number) {
	const hours = Math.floor(duration / 60 / 60);
	const minutes = Math.floor((duration / 60) % 60);
	const seconds = Math.floor(duration % 60);
	if (hours === 0) return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
	return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}
