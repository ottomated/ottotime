import { sep } from 'path';
import { Remote } from './git';
import parseGit from 'git-url-parse';
import webviewHtml from './webview.html';

function isWindowsPath(path: string): boolean {
	return /^[a-zA-Z]:\\/.test(path);
}

export function isDescendant(parent: string, descendant: string): boolean {
	if (parent === descendant) {
		return true;
	}

	if (parent.charAt(parent.length - 1) !== sep) {
		parent += sep;
	}

	// Windows is case insensitive
	if (isWindowsPath(parent)) {
		parent = parent.toLowerCase();
		descendant = descendant.toLowerCase();
	}

	return descendant.startsWith(parent);
}

export function getOriginId(remote: Remote | undefined) {
	if (!remote) return null;

	const url = remote.fetchUrl ?? remote.pushUrl;
	if (!url) return null;
	try {
		const parsed = parseGit(url);
		return parsed.owner + '/' + parsed.name;
	} catch (e) {
		console.warn(e);
		return null;
	}
}

export function getTimeText(time: number) {
	const hours = Math.floor(time / 1000 / 60 / 60);
	const minutes = Math.floor(time / 1000 / 60) % 60;
	return `${hours}:${minutes.toString().padStart(2, '0')}`;
}

type WebviewKey =
	| 'CSP_SOURCE'
	| 'NONCE'
	| 'SCRIPT_SRC'
	| 'PAST_SESSIONS'
	| 'CURRENT_SESSION'
	| 'PROJECT_NAME'
	| 'GIT_ORIGIN';

export function generateWebviewHtml(data: Record<WebviewKey, string>) {
	let html = webviewHtml;
	for (const [key, value] of Object.entries(data)) {
		html = html.replace(new RegExp(key, 'g'), value);
	}
	return html;
}

export function getNonce() {
	let text = '';
	const possible =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
