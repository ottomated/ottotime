import { existsSync, FSWatcher } from 'fs';
import { watch } from 'fs';
import { readFile } from 'fs/promises';
import { writeFile } from 'fs/promises';
import { type FileHandle, open } from 'fs/promises';

const U32_MAX = 4_294_967_295;

const HEADER = '# DO NOT EDIT! This file stores ottotime usage data.\n';
const HEADER_LENGTH = HEADER.length;

export type Items = Array<{ start: number; end: number }>;

export class DataPersister {
	#file: FileHandle;
	#watcher: FSWatcher;
	#items!: Items;

	path: string;

	#last_write = 0;
	#dirty = true;

	constructor(f: FileHandle, path: string, w: FSWatcher) {
		this.path = path;
		this.#file = f;
		this.#watcher = w;
		w.on('change', () => {
			const delay = Date.now() - this.#last_write;
			if (delay > 5) this.#dirty = true;
		});
	}

	static async create(path: string) {
		if (!existsSync(path)) {
			await writeFile(path, HEADER);
		}
		const f = await open(path, 'r+');

		const watcher = watch(path, {
			persistent: false,
			recursive: false,
		});

		return new DataPersister(f, path, watcher);
	}

	async #read() {
		const data = await readFile(this.path);
		const items = read(data);

		this.#items = items;
		this.#dirty = false;
	}

	async length() {
		if (this.#dirty) await this.#read();
		return this.#items.length;
	}

	async get(index: number) {
		if (this.#dirty) await this.#read();
		return this.#items[index];
	}

	async close() {
		this.#file.close();
		this.#watcher.close();
	}

	#offset(index: number) {
		return HEADER_LENGTH + index * 13 /* 2 bytes plus newline */;
	}

	// async set(index: number, start: number, end: number) {
	// 	if (index >= this.length || index < 0)
	// 		throw new Error('Index out of bounds');
	// 	if (start > U32_MAX || end > U32_MAX || start < 0 || end < 0) {
	// 		throw new Error('Time out of bounds');
	// 	}
	// 	this.#buffer[0] = start;
	// 	this.#buffer[1] = end;
	// 	await this.#file.write(
	// 		this.#buffer as unknown as Uint8Array,
	// 		0,
	// 		8,
	// 		this.offset(index),
	// 	);
	// }
	// async setStart(index: number, start: number) {
	// 	if (index >= this.length || index < 0)
	// 		throw new Error('Index out of bounds');
	// 	if (start > U32_MAX || start < 0) throw new Error('Time out of bounds');
	// 	this.#buffer[0] = start;
	// 	await this.#file.write(
	// 		this.#buffer as unknown as Uint8Array,
	// 		0,
	// 		4,
	// 		this.offset(index),
	// 	);
	// }
	async setEnd(index: number, end: number) {
		if (end > U32_MAX || end < 0) throw new Error('Time out of bounds');

		this.#last_write = Date.now();

		const e = u32_to_base64(end);

		await this.#file.write(e, 0, 6, this.#offset(index) + 6);
	}
	async add(start: number, end: number): Promise<number> {
		if (start > U32_MAX || end > U32_MAX || start < 0 || end < 0) {
			throw new Error('Time out of bounds');
		}

		if (this.#dirty) await this.#read();

		this.#items.push({ start, end });

		const s = u32_to_base64(start);
		const e = u32_to_base64(end);

		this.#last_write = Date.now();
		await this.#file.writev(
			[s, e, Buffer.from('\n')],
			this.#offset(this.#items.length - 1),
		);
		return this.#items.length - 1;
	}
}

function u32_to_base64(n: number) {
	const buffer = Buffer.alloc(4);
	buffer.writeUint32LE(n);
	return Buffer.from(buffer.toString('base64')).subarray(0, 6);
}

export function read(data: Buffer | Uint8Array) {
	const items: Items = [];

	for (let i = HEADER_LENGTH; i < data.length; i += 13) {
		const start = Buffer.from(
			data.subarray(i, i + 6).toString(),
			'base64',
		).readUInt32LE();
		const end = Buffer.from(
			data.subarray(i + 6, i + 12).toString(),
			'base64',
		).readUInt32LE();
		items.push({ start, end });
	}

	return items;
}
