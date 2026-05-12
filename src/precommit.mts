import { join } from 'node:path';
import { Items, read, write } from './serde.mjs';
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

	const merged: Items = publicFile;
	for (const item of gitFile) {
		const existing = merged.find((i) => i.start === item.start);
		if (existing) {
			existing.duration = Math.max(existing.duration, item.duration);
		} else {
			merged.push(item);
		}
	}
	merged.sort((a, b) => a.start - b.start);
	await writeFile(publicPath, write(merged));
}
main();
