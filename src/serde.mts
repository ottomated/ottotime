import { type FileHandle, open } from 'fs/promises';

export type Items = Array<{ start: number; duration: number }>;

export const HEADER = Buffer.from(
	'# OTTOTIME\n# Do not edit manually. Check into git.\n',
);
const HEADER_LENGTH = HEADER.length;
export const MAX_DURATION = 999 * 60 + 59;
const MAX_DURATION_STRING = formatDuration(MAX_DURATION);

export class DataPersister {
	/** Map of startTime -> byte index */
	cache = new Map<number, number>();

	constructor(public path: string) {}

	/**
	 * Start a new session by adding a line to the file.
	 * - The file is created if it doesn't exist.
	 * - The session is appended to the end of the file.
	 * - The function should cache the byte index of the line.
	 * @param startTime The timestamp of the start of the session
	 * @returns The startTime of the session (may be different if the session was split)
	 */
	async startSession(startTime: number, duration = 0): Promise<number> {
		let file: FileHandle;
		try {
			file = await open(this.path, 'a');
		} catch (e) {
			if (e instanceof Error && 'code' in e && e.code === 'EISDir') {
				throw new Error(`${this.path} is a directory.`);
			}
			throw e;
		}

		const info = await file.stat();

		if (!info.isFile()) {
			throw new Error(`${this.path} already exists and is not a file.`);
		}

		const lines: Buffer[] = [];
		if (info.size === 0) lines.push(HEADER);

		let indexWritten = info.size === 0 ? HEADER_LENGTH : info.size;

		while (duration > MAX_DURATION) {
			const line = `${startTime}-${MAX_DURATION_STRING}\n`;
			lines.push(Buffer.from(line));
			startTime += MAX_DURATION;
			duration -= MAX_DURATION;
			indexWritten += line.length;
		}
		lines.push(Buffer.from(`${startTime}-${formatDuration(duration)}\n`));

		this.cache.set(startTime, indexWritten);
		await file.writev(lines);

		await file.close();
		return startTime;
	}

	/**
	 * Update the duration of a session.
	 * @param startTime The startTime of the session
	 * @param endTime The endTime of the session
	 * @returns The startTime of the session (may be different if the session was split)
	 */
	async updateSession(startTime: number, endTime: number): Promise<number> {
		const duration = endTime - startTime;
		let file: FileHandle;
		try {
			file = await open(this.path, 'r+' /* read and write */);
		} catch (e) {
			if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
				return this.startSession(startTime, duration);
			}
			throw e;
		}
		const index = await this.#findDurationIndex(file, startTime);
		if (index === -1) {
			await file.close();
			return this.startSession(startTime, duration);
		}

		if (duration > MAX_DURATION) {
			const buffer = Buffer.from(MAX_DURATION_STRING);
			await file.write(buffer, 0, buffer.length, index);
			await file.close();
			return this.updateSession(startTime + MAX_DURATION, endTime);
		}

		const buffer = Buffer.from(formatDuration(duration));
		await file.write(buffer, 0, buffer.length, index);
		await file.close();
		return startTime;
	}

	/**
	 * Search for the correct index to write.
	 * @param file file handle (must be readable)
	 * @param startTime The timestamp to search for
	 * @returns The index to write a new duration (i.e. 00:10) to.
	 */
	async #findDurationIndex(file: FileHandle, startTime: number) {
		const expected = Buffer.from(`${startTime}-`);

		const cachedIndex = this.cache.get(startTime);
		if (cachedIndex !== undefined) {
			// Read where we have it cached to see if the startTime is already there
			const actual = Buffer.alloc(expected.length);
			await file.read(actual, 0, actual.length, cachedIndex);
			if (actual.equals(expected)) return cachedIndex + expected.length;
		}
		// Read the file line-by-line until we find the startTime
		const buffer = await file.readFile();
		let linePosition = 0;
		for (let i = 0; i < buffer.length; i++) {
			const char = buffer[i];
			// Scanning until the next newline
			if (linePosition === -1) {
				if (char === 0x0a /* \n */) {
					linePosition = 0;
				}
				continue;
			}
			// Check if we match
			const expectedChar = expected[linePosition];
			if (char !== expectedChar) {
				linePosition = -1;
				continue;
			}
			linePosition++;
			if (linePosition === expected.length) {
				this.cache.set(startTime, i - linePosition + 1);
				return i + 1;
			}
		}
		return -1;
	}
}
export function formatDuration(duration: number) {
	if (duration === 0) return '  0:00';
	const seconds = duration % 60;
	const minutes = (duration - seconds) / 60;
	return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`.padStart(6);
}

export function read(data: Buffer) {
	const items: Items = [];

	let start = 0;
	let hyphen = -1;
	let colon = -1;
	let hasOctothorpe = false;
	let minutesStart = -1;
	for (let i = 0; i < data.length; i++) {
		const char = data[i]!;
		if (char === 0x0a /* \n */ || i === data.length - 1) {
			const valid =
				!hasOctothorpe /* can't start with a # */ &&
				i - 3 === colon /* has a colon in the right place (:00) */ &&
				minutesStart !== -1; /* has a non-space char after the hyphen */
			if (valid) {
				const line = data.subarray(start, i).toString();
				items.push(
					parseLine(line, hyphen - start, minutesStart - start, colon - start),
				);
			}
			start = i + 1;
			hyphen = -1;
			colon = -1;
			minutesStart = -1;
			hasOctothorpe = false;
		} else if (char === 0x2d /* - */) {
			hyphen = i;
		} else if (char === 0x3a /* : */) {
			colon = i;
		} else if (char === 0x23 /* # */ && i === start) {
			hasOctothorpe = true;
		} else if (
			minutesStart === -1 &&
			char !== 0x20 /* space */ &&
			hyphen !== -1
		) {
			minutesStart = i;
		}
	}
	return items;
}

function parseLine(
	line: string,
	hyphen: number,
	minutesStart: number,
	colon: number,
) {
	const startTime = line.slice(0, hyphen);
	const minutes = line.slice(minutesStart, colon);
	const seconds = line.slice(colon + 1);
	const start = parseInt(startTime);
	return {
		start,
		duration: parseInt(minutes) * 60 + parseInt(seconds),
	};
}
