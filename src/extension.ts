import * as vscode from 'vscode';
import { GitExtension } from './git';
import {
	generateWebviewHtml,
	getNonce,
	getOriginId,
	getTimeText,
	isDescendant,
} from './util';
import { fetch } from 'undici';
import { basename } from 'path';

type Session = {
	id: string;
	startTime: number;
	endTime: number;
	ongoing: boolean;
};

export async function activate(context: vscode.ExtensionContext) {
	// #region Settings

	context.subscriptions.push(
		vscode.commands.registerCommand('ottotime.setApiKey', async () => {
			const value = await vscode.window.showInputBox({
				prompt: 'Enter your Ottotime API key',
				value: context.globalState.get('ottotime.apikey'),
			});
			if (!value) return;
			context.globalState.update('ottotime.apikey', value);
			vscode.commands.executeCommand('workbench.action.reloadWindow');
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('ottotime.setApiUrl', async () => {
			const value = await vscode.window.showInputBox({
				prompt: 'Enter your Ottotime API Url',
				value: context.globalState.get('ottotime.apiUrl'),
			});
			if (!value) return;
			context.globalState.update('ottotime.apiUrl', value);
			vscode.commands.executeCommand('workbench.action.reloadWindow');
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('ottotime.setTimeout', async () => {
			const value = await vscode.window.showInputBox({
				prompt: 'How long before a session times out? (in seconds)',
				value: (
					context.globalState.get('ottotime.timeout', 1000 * 60 * 5) / 1000
				).toString(),
			});
			if (!value) return;
			const num = Number(value);
			if (isNaN(num) || num < 30) {
				vscode.window.showErrorMessage('Invalid timeout');
				return;
			}

			context.globalState.update('ottotime.timeout', num * 1000);
			vscode.commands.executeCommand('workbench.action.reloadWindow');
		})
	);
	context.globalState.setKeysForSync([
		'ottotime.apikey',
		'ottotime.timeout',
		'ottotime.apiUrl',
	]);
	const TIMEOUT = context.globalState.get('ottotime.timeout', 1000 * 60 * 5);
	let API_KEY = context.globalState.get<string>('ottotime.apikey')!;
	const API_URL = context.globalState.get(
		'ottotime.apiUrl',
		'http://localhost:8787'
	);

	if (!API_KEY) {
		const value = await vscode.window.showInputBox({
			prompt: 'Enter your Ottotime API key',
		});
		if (!value) {
			vscode.window.showErrorMessage(
				'You must enter an API key to use Ottotime'
			);
			return;
		}
		context.globalState.update('ottotime.apikey', value);
		API_KEY = value;
	}
	// #endregion

	const git = vscode.extensions
		.getExtension<GitExtension>('vscode.git')
		?.exports?.getAPI(1);
	if (!git) throw new Error('Git extension not found');

	const workspaceId = (vscode.workspace.workspaceFile ??
		vscode.workspace.workspaceFolders?.[0].uri)!;
	if (!workspaceId) return;

	const repository = git.repositories.find((r) =>
		isDescendant(r.rootUri.fsPath, workspaceId.fsPath)
	);

	if (repository && repository.state.HEAD === undefined) {
		// wait for repository to be ready
		await new Promise<void>((resolve) => {
			const interval = setInterval(() => {
				if (repository.state.HEAD !== undefined) {
					clearInterval(interval);
					resolve();
				}
			}, 200);
			context.subscriptions.push(
				new vscode.Disposable(() => clearInterval(interval))
			);
		});
	}
	const originRemote = repository?.state.remotes.find(
		(r) => r.name === 'origin'
	);

	const origin = getOriginId(originRemote);

	async function getPastSessions() {
		const res = await fetch(API_URL + '/past_sessions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Key': API_KEY,
			},
			body: JSON.stringify({
				git: origin,
				local: workspaceId.fsPath,
			}),
		});
		return res.json() as Promise<Session[]>;
	}
	async function createSession() {
		// upload session to server
		const res = await fetch(API_URL + '/start_session', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Key': API_KEY,
			},
			body: JSON.stringify({
				git: origin,
				local: workspaceId.fsPath,
			}),
		});
		return {
			...((await res.json()) as any),
			ongoing: true,
		} as Session;
	}
	async function updateSession() {
		await fetch(API_URL + '/update_session', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Key': API_KEY,
			},
			body: JSON.stringify({
				id: currentSession.id,
				endTime: currentSession.endTime,
			}),
		});
	}
	function updateStatusBar() {
		const time = currentSession.endTime - currentSession.startTime;
		const currentText = getTimeText(time);
		const totalText = getTimeText(totalPastTime + time);
		const icon = currentSession.ongoing
			? '$(otto-ottomated)'
			: '$(debug-pause)';
		statusBarItem.text = `${icon} ${totalText} (${currentText})`;
		statusBarItem.tooltip = `Total time: ${totalText}, current session: ${currentText}`;
		statusBarItem.color = currentSession.ongoing ? '#9a4fef' : '#ffffff';
	}

	const pastSessions = await getPastSessions();

	let totalPastTime = pastSessions.reduce(
		(acc, cur) => acc + (cur.endTime - cur.startTime),
		0
	);
	let currentSession = await createSession();

	// #region Tick
	const interval = setInterval(async () => {
		const timeUnfocused = lastUnfocused ? Date.now() - lastUnfocused : 0;
		if (timeUnfocused > TIMEOUT) {
			currentSession.endTime = Date.now() - timeUnfocused;
			currentSession.ongoing = false;
			updateStatusBar();
			await updateSession();
		}

		if (currentSession.ongoing) {
			currentSession.endTime = Date.now();
			updateStatusBar();

			await updateSession();
		}
	}, 1000);
	context.subscriptions.push(
		new vscode.Disposable(() => {
			clearInterval(interval);
		})
	);
	// #endregion

	// #region Unfocus tracker

	let lastUnfocused = vscode.window.state.focused ? null : Date.now();
	vscode.window.onDidChangeWindowState(async (e) => {
		if (e.focused) {
			lastUnfocused = null;
			if (!currentSession.ongoing) {
				// Make new session when refocusing
				pastSessions.push(currentSession);
				totalPastTime += currentSession.endTime - currentSession.startTime;
				currentSession = await createSession();
			}
		} else {
			lastUnfocused = Date.now();
		}
	});

	// #endregion

	// #region Status bar
	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		Number.MAX_VALUE
	);
	updateStatusBar();
	statusBarItem.show();
	statusBarItem.command = 'ottotime.showtime';
	context.subscriptions.push(statusBarItem);
	// #endregion

	// #region Webview
	context.subscriptions.push(
		vscode.commands.registerCommand('ottotime.showtime', () => {
			const panel = vscode.window.createWebviewPanel(
				'ottotime',
				'Project Hours',
				vscode.ViewColumn.One,
				{
					enableScripts: true,
				}
			);
			panel.iconPath = {
				light: vscode.Uri.joinPath(context.extensionUri, 'otto_black.svg'),
				dark: vscode.Uri.joinPath(context.extensionUri, 'otto.svg'),
			};
			panel.webview.html = generateWebviewHtml({
				PAST_SESSIONS: JSON.stringify(pastSessions),
				NONCE: getNonce(),
				CSP_SOURCE: panel.webview.cspSource,
				SCRIPT_SRC: panel.webview
					.asWebviewUri(
						vscode.Uri.joinPath(context.extensionUri, 'dist/webmain.js')
					)
					.toString(),
				CURRENT_SESSION: JSON.stringify(currentSession),
				PROJECT_NAME:
					vscode.workspace.name ?? origin ?? basename(workspaceId.fsPath),
				GIT_ORIGIN: origin ?? '',
			});
		})
	);

	// #endregion
}

export function deactivate() {}
