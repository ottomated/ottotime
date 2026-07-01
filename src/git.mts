import { chmod } from 'fs/promises';
import * as vscode from 'vscode';
import quote from 'shell-quote/quote';

export async function getGitFolder(root: vscode.Uri | undefined) {
	if (!root) return;
	const path = vscode.Uri.joinPath(root, '.git');
	try {
		const stat = await vscode.workspace.fs.stat(path);
		if (stat.type !== vscode.FileType.Directory) return;
		return path;
	} catch (e) {
		if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
			return;
		}
		throw e;
	}
}

const GITATTRIBUTES_COMMENT = '# Prevents merge conflicts in Ottotime files';
const GITATTRIBUTES_CONFIG = '.ottotime merge=union';

async function deleteGitAttributes(root: vscode.Uri) {
	const gitattributes = vscode.Uri.joinPath(root, '.gitattributes');

	try {
		const data = await vscode.workspace.fs
			.readFile(gitattributes)
			.then((d) => d.toString());
		const lines = data.split('\n');
		const filtered = lines.filter(
			(line) => line !== GITATTRIBUTES_COMMENT && line !== GITATTRIBUTES_CONFIG,
		);
		const shouldDelete = filtered.every((line) => line === '');
		if (shouldDelete) {
			await vscode.workspace.fs.delete(gitattributes);
		} else {
			await vscode.workspace.fs.writeFile(
				gitattributes,
				Buffer.from(filtered.join('\n')),
			);
		}
	} catch {
		/* ignore */
	}
}

const PRECOMMIT_HOOK = /* sh */ `# ottotime-start
command
# ottotime-end`;
const PRECOMMIT_PATTERN = /# ottotime-start\n(.+?)\n# ottotime-end/;
const COMPATIBLE_HASHBANGS = ['/sh', '/bash', '/env sh', '/env bash'];
async function ensureGitHook(
	gitFolder: vscode.Uri,
	context: vscode.ExtensionContext,
) {
	const precommit = vscode.Uri.joinPath(gitFolder, 'hooks/pre-commit');

	let data = '#!/usr/bin/env sh\n';
	try {
		data = await vscode.workspace.fs
			.readFile(precommit)
			.then((d) => d.toString());
	} catch (e) {
		if (!(e instanceof vscode.FileSystemError) || e.code !== 'FileNotFound') {
			throw e;
		}
	}

	const quoted = quote([
		process.argv[0]!,
		context.asAbsolutePath('dist/precommit.js'),
	]);
	const command = `ELECTRON_RUN_AS_NODE=1 ${quoted} && git add .ottotime || true`;

	const existing_hook = PRECOMMIT_PATTERN.exec(data)?.[1];

	if (existing_hook === command) return;

	if (existing_hook === undefined) {
		if (!data.endsWith('\n')) data += '\n';

		const hashbang = data.substring(0, data.indexOf('\n'));
		const is_incompatible =
			hashbang.startsWith('#!/') &&
			COMPATIBLE_HASHBANGS.every((shell) => !hashbang.endsWith(shell));

		if (is_incompatible) {
			throw new Error(
				`Failed to install git hook: existing hashbang "${hashbang}" is incompatible (must be sh or bash)`,
			);
		}

		await vscode.workspace.fs.writeFile(
			precommit,
			Buffer.from(`${data}${PRECOMMIT_HOOK.replace('command', command)}\n`),
		);
		// executable
		try {
			await chmod(precommit.fsPath, 0o755);
		} catch {
			// ignor
		}
	} else {
		data = data.replace(
			PRECOMMIT_PATTERN,
			PRECOMMIT_HOOK.replace('command', command),
		);
		await vscode.workspace.fs.writeFile(precommit, Buffer.from(data));
	}
}

async function deleteGitHook(root: vscode.Uri) {
	const precommit = vscode.Uri.joinPath(root, '.git/hooks/pre-commit');

	try {
		const data = await vscode.workspace.fs
			.readFile(precommit)
			.then((d) => d.toString());
		const replaced = data.replace(PRECOMMIT_PATTERN, '');
		const shouldDelete = replaced
			.split('\n')
			.every((line) => line === '' || line.startsWith('#!'));
		if (shouldDelete) {
			await vscode.workspace.fs.delete(precommit);
		} else {
			await vscode.workspace.fs.writeFile(precommit, Buffer.from(replaced));
		}
	} catch {
		/* ignore */
	}
}

export async function ensureGitConfig(
	root: vscode.Uri | undefined,
	context: vscode.ExtensionContext,
) {
	if (!root) return;
	// .gitattributes is no longer needed
	await deleteGitAttributes(root);

	const gitFolder = await getGitFolder(root);
	if (!gitFolder) return;

	await ensureGitHook(gitFolder, context);
}
export async function deleteGitConfig(root: vscode.Uri | undefined) {
	if (!root) return;

	await deleteGitHook(root);
}
