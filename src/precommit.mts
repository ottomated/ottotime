import { join } from 'node:path';
import { merge, read, write } from './serde.mjs';
import { readFile, writeFile } from 'node:fs/promises';

async function load(path: string) {
	let data: Buffer;
	try {
		data = await readFile(path);
	} catch (e) {
		if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
			return [];
		}
		throw e;
	}
	return read(data);
}
async function main() {
	const publicPath = join(process.cwd(), '.ottotime');
	const publicFile = await load(publicPath);
	const gitFile = await load(join(process.cwd(), '.git/.ottotime'));

	const merged = merge(publicFile, gitFile);
	await writeFile(publicPath, write(merged));
}
main();
