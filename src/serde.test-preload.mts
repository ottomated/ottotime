import { mock } from 'bun:test';
import type { FileStat, Uri } from 'vscode';

class FileSystemError extends Error {
	code: string;
	constructor(code: string) {
		super(code);
		this.code = code;
	}
}

mock.module('vscode', () => {
	return {
		FileType: {
			File: 1,
			Directory: 2,
		},
		FileSystemError,
		workspace: {
			fs: {
				async stat(uri: Uri): Promise<FileStat> {
					try {
						const stat = await Bun.file(uri.fsPath).stat();
						return {
							type: stat.isFile() ? 1 : 2,
							ctime: stat.birthtime.getTime(),
							mtime: stat.mtime.getTime(),
							size: stat.size,
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
						return await Bun.file(uri.fsPath).bytes();
					} catch (e) {
						if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
							throw new FileSystemError('FileNotFound');
						}
						throw e;
					}
				},
				async writeFile(uri: Uri, data: Uint8Array): Promise<void> {
					await Bun.file(uri.fsPath).write(data);
				},
			},
		},
	};
});
