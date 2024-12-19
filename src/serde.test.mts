import { $ } from 'bun';
import {
	DataPersister,
	HEADER as HEADER_BUF,
	MAX_DURATION,
	read,
} from './serde.mjs';
import { test, describe, expect } from 'bun:test';

const MOCK_DATES = [1734570950, 1734571041] as const;
const HEADER = HEADER_BUF.toString();

describe('DataPersister', () => {
	test('from no file, start session', async () => {
		await $`rm -f /tmp/.ottotime`;
		const persister = new DataPersister('/tmp/.ottotime');
		await persister.startSession(MOCK_DATES[0]);
		await persister.startSession(MOCK_DATES[1]);

		await expectFileToBe(
			'/tmp/.ottotime',
			`${HEADER}${MOCK_DATES[0]}-  0:00\n${MOCK_DATES[1]}-  0:00\n`,
		);
		await $`rm -f /tmp/.ottotime`;
	});
	test('read', async () => {
		await $`rm -f /tmp/.ottotime2`;
		await Bun.write(
			'/tmp/.ottotime2',
			`# OTTOTIME\n# -:Do not edit manually. Check into git.\n${MOCK_DATES[0]}- 10:00\n${MOCK_DATES[1]}-  5:55\n`,
		);
		const items = read(
			Buffer.from(await Bun.file('/tmp/.ottotime2').arrayBuffer()),
		);
		expect(items).toEqual([
			{ start: MOCK_DATES[0], end: MOCK_DATES[0] + 10 * 60 },
			{ start: MOCK_DATES[1], end: MOCK_DATES[1] + 5 * 60 + 55 },
		]);

		await $`rm -f /tmp/.ottotime2`;
	});
	test('from existing file, start session', async () => {
		await $`rm -f /tmp/.ottotime3`;
		await Bun.write('/tmp/.ottotime3', `${HEADER}${MOCK_DATES[0]}- 10:00\n`);
		const persister = new DataPersister('/tmp/.ottotime3');
		await persister.startSession(MOCK_DATES[1]);

		await expectFileToBe(
			'/tmp/.ottotime3',
			`${HEADER}${MOCK_DATES[0]}- 10:00\n${MOCK_DATES[1]}-  0:00\n`,
		);
		await $`rm -f /tmp/.ottotime3`;
	});
	test('update session', async () => {
		await $`rm -f /tmp/.ottotime4`;
		const persister = new DataPersister('/tmp/.ottotime4');
		await persister.startSession(MOCK_DATES[0]);
		expect(persister.cache.get(MOCK_DATES[0])).toBe(HEADER.length);

		await expectFileToBe(
			'/tmp/.ottotime4',
			`${HEADER}${MOCK_DATES[0]}-  0:00\n`,
		);

		await persister.updateSession(MOCK_DATES[0], MOCK_DATES[0] + 998 * 60);
		await persister.updateSession(MOCK_DATES[0], MOCK_DATES[0] + 999 * 60);

		await expectFileToBe(
			'/tmp/.ottotime4',
			`${HEADER}${MOCK_DATES[0]}-999:00\n`,
		);

		await persister.startSession(MOCK_DATES[1]);
		await persister.updateSession(MOCK_DATES[1], MOCK_DATES[1] + 1);
		await expectFileToBe(
			'/tmp/.ottotime4',
			`${HEADER}${MOCK_DATES[0]}-999:00\n${MOCK_DATES[1]}-  0:01\n`,
		);

		await $`rm -f /tmp/.ottotime4`;
	});

	test('start oversized session', async () => {
		await $`rm -f /tmp/.ottotime5`;
		const persister = new DataPersister('/tmp/.ottotime5');
		const newSession = await persister.startSession(
			MOCK_DATES[0],
			MAX_DURATION * 2 + 1,
		);
		expect(newSession).toEqual(MOCK_DATES[0] + MAX_DURATION * 2);
		expect(MAX_DURATION * 2 + 1).toBe(999 * 60 + 59 + 999 * 60 + 59 + 1);

		const contents = await Bun.file('/tmp/.ottotime5').text();
		expect(contents).toBe(
			`${HEADER}${MOCK_DATES[0]}-999:59\n${MOCK_DATES[0] + MAX_DURATION}-999:59\n${newSession}-  0:01\n`,
		);
		const index = contents.indexOf(newSession.toString());

		expect(persister.cache.get(MOCK_DATES[0])).toBeUndefined();
		expect(persister.cache.get(newSession)).toBe(index);

		await $`rm -f /tmp/.ottotime5`;
	});

	test('update oversized session', async () => {
		await $`rm -f /tmp/.ottotime6`;
		const persister = new DataPersister('/tmp/.ottotime6');
		await persister.startSession(MOCK_DATES[0]);

		await persister.updateSession(MOCK_DATES[0], MOCK_DATES[0] + MAX_DURATION);

		await expectFileToBe(
			'/tmp/.ottotime6',
			`${HEADER}${MOCK_DATES[0]}-999:59\n`,
		);

		const newSession = await persister.updateSession(
			MOCK_DATES[0],
			MOCK_DATES[0] + MAX_DURATION + 1,
		);
		expect(newSession).toEqual(MOCK_DATES[0] + MAX_DURATION);

		await expectFileToBe(
			'/tmp/.ottotime6',
			`${HEADER}${MOCK_DATES[0]}-999:59\n${MOCK_DATES[0] + MAX_DURATION}-  0:01\n`,
		);
		await persister.updateSession(
			MOCK_DATES[0],
			MOCK_DATES[0] + MAX_DURATION + 2,
		);
		await expectFileToBe(
			'/tmp/.ottotime6',
			`${HEADER}${MOCK_DATES[0]}-999:59\n${MOCK_DATES[0] + MAX_DURATION}-  0:02\n`,
		);

		await persister.updateSession(newSession, newSession + 4);

		await expectFileToBe(
			'/tmp/.ottotime6',
			`${HEADER}${MOCK_DATES[0]}-999:59\n${MOCK_DATES[0] + MAX_DURATION}-  0:04\n`,
		);

		await $`rm -f /tmp/.ottotime6`;
	});

	test('file gets deleted before updating', async () => {
		await $`rm -f /tmp/.ottotime7`;
		const persister = new DataPersister('/tmp/.ottotime7');
		await persister.startSession(MOCK_DATES[0]);
		await persister.startSession(MOCK_DATES[1]);

		await $`rm -f /tmp/.ottotime7`;
		await persister.updateSession(MOCK_DATES[0], MOCK_DATES[0] + 1);

		await expectFileToBe(
			'/tmp/.ottotime7',
			`${HEADER}${MOCK_DATES[0]}-  0:01\n`,
		);

		await $`rm -f /tmp/.ottotime7`;
	});
	test('file gets edited before updating', async () => {
		await $`rm -f /tmp/.ottotime8`;
		const persister = new DataPersister('/tmp/.ottotime8');
		await persister.startSession(MOCK_DATES[0]);

		await Bun.write(
			'/tmp/.ottotime8',
			`# invalid header\n${MOCK_DATES[0]}-  0:00\n`,
		);

		await persister.updateSession(MOCK_DATES[0], MOCK_DATES[0] + 1);

		expect(persister.cache.get(MOCK_DATES[0])).toBe(
			'# invalid header\n'.length,
		);

		await expectFileToBe(
			'/tmp/.ottotime8',
			`# invalid header\n${MOCK_DATES[0]}-  0:01\n`,
		);

		await $`rm -f /tmp/.ottotime8`;
	});
});

async function expectFileToBe(path: string, contents: string) {
	return expect(await Bun.file(path).text()).toBe(contents);
}
