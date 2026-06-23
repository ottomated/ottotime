import { readFile, writeFile, stat } from 'fs/promises';
import type { FileStat, Uri } from 'vscode';

export class FileSystemError extends Error {
	code: string;
	constructor(code: string) {
		super(code);
		this.code = code;
	}
}

export const FileType = {
	File: 1,
	Directory: 2,
};

export const workspace = {
	fs: {
		async stat(uri: Uri): Promise<FileStat> {
			try {
				const file = await stat(uri.fsPath);
				return {
					type: file.isFile() ? 1 : 2,
					ctime: file.birthtime.getTime(),
					mtime: file.mtime.getTime(),
					size: file.size,
				};
			} catch (e) {
				if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
					throw new FileSystemError('FileNotFound');
				}
				throw e;
			}
		},
		async readFile(uri: Uri): Promise<Uint8Array> {
			try {
				return await readFile(uri.fsPath);
			} catch (e) {
				if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
					throw new FileSystemError('FileNotFound');
				}
				throw e;
			}
		},
		async writeFile(uri: Uri, data: Uint8Array): Promise<void> {
			await writeFile(uri.fsPath, data);
		},
	},
};
