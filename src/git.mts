import * as vscode from 'vscode';

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
const GITATTRIBUTES_CONFIG = '.ottotime merge=union filter=ottotime';
async function ensureGitAttributes(root: vscode.Uri) {
	const gitattributes = vscode.Uri.joinPath(root, '.gitattributes');
	try {
		let data = await vscode.workspace.fs
			.readFile(gitattributes)
			.then((d) => d.toString());
		if (data.includes(GITATTRIBUTES_CONFIG)) return;
		if (!data.endsWith('\n')) data += '\n';
		await vscode.workspace.fs.writeFile(
			gitattributes,
			Buffer.from(`${data}${GITATTRIBUTES_COMMENT}\n${GITATTRIBUTES_CONFIG}\n`),
		);
	} catch (e) {
		if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
			await vscode.workspace.fs.writeFile(
				gitattributes,
				Buffer.from(`${GITATTRIBUTES_COMMENT}\n${GITATTRIBUTES_CONFIG}\n`),
			);
		} else {
			throw e;
		}
	}
}
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

const GIT_FILTER_BLOCK = `[filter "ottotime"]\n\tclean = cat .git/.ottotime\n\tsmudge = cat`;
async function ensureGitFilter(gitFolder: vscode.Uri) {
	const ottotimeDirectory = vscode.Uri.joinPath(gitFolder, 'x-ottotime');
	try {
		const stat = await vscode.workspace.fs.stat(ottotimeDirectory);
		if (stat.type !== vscode.FileType.Directory) {
			await vscode.workspace.fs.delete(ottotimeDirectory);
		}
	} catch (e) {
		if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
			await vscode.workspace.fs.createDirectory(ottotimeDirectory);
		} else {
			throw e;
		}
	}

	const gitconfig = vscode.Uri.joinPath(gitFolder, 'config');
	try {
		let data = await vscode.workspace.fs
			.readFile(gitconfig)
			.then((d) => d.toString());
		if (data.includes(GIT_FILTER_BLOCK)) return;
		if (!data.endsWith('\n')) data += '\n';
		await vscode.workspace.fs.writeFile(
			gitconfig,
			Buffer.from(`${data}${GIT_FILTER_BLOCK}\n`),
		);
	} catch (e) {
		if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
			await vscode.workspace.fs.writeFile(
				gitconfig,
				Buffer.from(`${GIT_FILTER_BLOCK}\n`),
			);
		} else {
			throw e;
		}
	}
}
async function deleteGitFilter(root: vscode.Uri) {
	try {
		await vscode.workspace.fs.delete(
			vscode.Uri.joinPath(root, '.git/.ottotime'),
			{ recursive: true },
		);
	} catch {
		/* ignore */
	}
	const gitconfig = vscode.Uri.joinPath(root, '.git/config');

	try {
		const data = await vscode.workspace.fs
			.readFile(gitconfig)
			.then((d) => d.toString());
		const replaced = data.replace(GIT_FILTER_BLOCK, '');
		const shouldDelete = /^\s*$/.test(replaced);
		if (shouldDelete) {
			await vscode.workspace.fs.delete(gitconfig);
		} else {
			await vscode.workspace.fs.writeFile(gitconfig, Buffer.from(replaced));
		}
	} catch {
		/* ignore */
	}
}

export async function ensureGitConfig(root: vscode.Uri | undefined) {
	if (!root) return;
	const gitFolder = await getGitFolder(root);
	if (!gitFolder) return;

	await ensureGitAttributes(root);
	await ensureGitFilter(gitFolder);
}
export async function deleteGitConfig(root: vscode.Uri | undefined) {
	if (!root) return;

	await deleteGitAttributes(root);
	await deleteGitFilter(root);
}
