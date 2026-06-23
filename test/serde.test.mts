import { test, describe, expect } from 'vitest';
import type { Uri } from 'vscode';
import {
	DataPersisterNative,
	DataPersisterVscode,
	HEADER as HEADER_BUF,
	MAX_DURATION,
	read,
} from '../src/serde.mjs';
import { readFile, writeFile } from 'fs/promises';
import { exec as exec_cb } from 'child_process';
import { promisify } from 'util';
const exec = promisify(exec_cb);

const MOCK_DATES = [1734570950, 1734571041] as const;
const HEADER = HEADER_BUF.toString();

describe.each(['native', 'vscode'] as const)('DataPersister (%s)', (mode) => {
	const DataPersister =
		mode === 'native' ? DataPersisterNative : DataPersisterVscode;
	function uri(path: string) {
		return {
			fsPath: path,
			scheme: mode === 'native' ? 'file' : 'mock-non-file',
		} as Uri;
	}
	test('from no file, start session', async () => {
		await exec(`rm -f /tmp/.ottotime`);
		const persister = new DataPersister(uri('/tmp/.ottotime'), false);
		await persister.startSession(MOCK_DATES[0]);
		await persister.startSession(MOCK_DATES[1]);

		await expectFileToBe(
			'/tmp/.ottotime',
			`${HEADER}${MOCK_DATES[0]}-  0:00\n${MOCK_DATES[1]}-  0:00\n`,
		);
		await exec(`rm -f /tmp/.ottotime`);
	});
	test('read', async () => {
		await exec(`rm -f /tmp/.ottotime2`);
		await writeFile(
			'/tmp/.ottotime2',
			`# OTTOTIME\n# -:Do not edit manually. Check into git.\n${MOCK_DATES[0]}- 10:00\n${MOCK_DATES[1]}-  5:55\n`,
		);
		const items = read(await readFile('/tmp/.ottotime2'));
		expect(items).toEqual([
			{ start: MOCK_DATES[0], duration: 10 * 60 },
			{ start: MOCK_DATES[1], duration: 5 * 60 + 55 },
		]);

		await exec(`rm -f /tmp/.ottotime2`);
	});
	test('from existing file, start session', async () => {
		await exec(`rm -f /tmp/.ottotime3`);
		await writeFile('/tmp/.ottotime3', `${HEADER}${MOCK_DATES[0]}- 10:00\n`);
		const persister = new DataPersister(uri('/tmp/.ottotime3'), false);
		await persister.startSession(MOCK_DATES[1]);

		await expectFileToBe(
			'/tmp/.ottotime3',
			`${HEADER}${MOCK_DATES[0]}- 10:00\n${MOCK_DATES[1]}-  0:00\n`,
		);
		await exec(`rm -f /tmp/.ottotime3`);
	});
	test('update session', async () => {
		await exec(`rm -f /tmp/.ottotime4`);
		const persister = new DataPersister(uri('/tmp/.ottotime4'), false);
		await persister.startSession(MOCK_DATES[0]);
		if ('cache' in persister) {
			expect(persister.cache.get(MOCK_DATES[0])).toBe(HEADER.length);
		}
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

		await exec(`rm -f /tmp/.ottotime4`);
	});

	test('start oversized session', async () => {
		await exec(`rm -f /tmp/.ottotime5`);
		const persister = new DataPersister(uri('/tmp/.ottotime5'), false);
		const newSession = await persister.startSession(
			MOCK_DATES[0],
			MAX_DURATION * 2 + 1,
		);
		expect(newSession).toEqual(MOCK_DATES[0] + MAX_DURATION * 2);
		expect(MAX_DURATION * 2 + 1).toBe(999 * 60 + 59 + 999 * 60 + 59 + 1);

		const contents = await readFile('/tmp/.ottotime5', 'utf8');
		expect(contents).toBe(
			`${HEADER}${MOCK_DATES[0]}-999:59\n${MOCK_DATES[0] + MAX_DURATION}-999:59\n${newSession}-  0:01\n`,
		);
		const index = contents.indexOf(newSession.toString());

		if ('cache' in persister) {
			expect(persister.cache.get(MOCK_DATES[0])).toBeUndefined();
			expect(persister.cache.get(newSession)).toBe(index);
		}

		await exec(`rm -f /tmp/.ottotime5`);
	});

	test('update oversized session', async () => {
		await exec(`rm -f /tmp/.ottotime6`);
		const persister = new DataPersister(uri('/tmp/.ottotime6'), false);
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

		await exec(`rm -f /tmp/.ottotime6`);
	});

	test('file gets deleted before updating', async () => {
		await exec(`rm -f /tmp/.ottotime7`);
		const persister = new DataPersister(uri('/tmp/.ottotime7'), false);
		await persister.startSession(MOCK_DATES[0]);
		await persister.startSession(MOCK_DATES[1]);

		await exec(`rm -f /tmp/.ottotime7`);
		await persister.updateSession(MOCK_DATES[0], MOCK_DATES[0] + 1);

		await expectFileToBe(
			'/tmp/.ottotime7',
			`${HEADER}${MOCK_DATES[0]}-  0:01\n`,
		);

		await exec(`rm -f /tmp/.ottotime7`);
	});
	test('file gets edited before updating', async () => {
		await exec(`rm -f /tmp/.ottotime8`);
		const persister = new DataPersister(uri('/tmp/.ottotime8'), false);
		await persister.startSession(MOCK_DATES[0]);

		await writeFile(
			'/tmp/.ottotime8',
			`# invalid header\n${MOCK_DATES[0]}-  0:00\n`,
		);

		await persister.updateSession(MOCK_DATES[0], MOCK_DATES[0] + 1);

		if ('cache' in persister) {
			expect(persister.cache.get(MOCK_DATES[0])).toBe(
				'# invalid header\n'.length,
			);
		}

		await expectFileToBe(
			'/tmp/.ottotime8',
			`# invalid header\n${MOCK_DATES[0]}-  0:01\n`,
		);

		await exec(`rm -f /tmp/.ottotime8`);
	});

	test('git merge', async () => {
		await exec(`rm -rf /tmp/ottotime-git && mkdir /tmp/ottotime-git`);
		const cwd = { cwd: '/tmp/ottotime-git' };
		await exec(`git init`, cwd);

		const persister = new DataPersister(
			uri('/tmp/ottotime-git/.ottotime'),
			false,
		);
		await persister.startSession(MOCK_DATES[0]);
		await expectFileToBe(
			'/tmp/ottotime-git/.ottotime',
			`${HEADER}${MOCK_DATES[0]}-  0:00\n`,
		);

		await writeFile(
			'/tmp/ottotime-git/.gitattributes',
			'.ottotime merge=union',
		);

		await exec(`git add . && git commit -m "init"`, cwd);

		await exec(`git checkout -b branch1`, cwd);
		await persister.startSession(MOCK_DATES[1]);
		await expectFileToBe(
			'/tmp/ottotime-git/.ottotime',
			`${HEADER}${MOCK_DATES[0]}-  0:00\n${MOCK_DATES[1]}-  0:00\n`,
		);

		await exec(`git add .ottotime && git commit -m "branch 1"`, cwd);

		await exec(`git checkout main`, cwd);

		await expectFileToBe(
			'/tmp/ottotime-git/.ottotime',
			`${HEADER}${MOCK_DATES[0]}-  0:00\n`,
		);

		await persister.startSession(MOCK_DATES[1] + 1);
		await expectFileToBe(
			'/tmp/ottotime-git/.ottotime',
			`${HEADER}${MOCK_DATES[0]}-  0:00\n${MOCK_DATES[1] + 1}-  0:00\n`,
		);
		await exec(`git add .ottotime && git commit -m "main update"`, cwd);

		await exec(`git merge branch1`, cwd);

		const contents = await readFile('/tmp/ottotime-git/.ottotime', 'utf8');
		expect(contents).toBeOneOf([
			`${HEADER}${MOCK_DATES[0]}-  0:00\n${MOCK_DATES[1]}-  0:00\n${MOCK_DATES[1] + 1}-  0:00\n`,
			`${HEADER}${MOCK_DATES[0]}-  0:00\n${MOCK_DATES[1] + 1}-  0:00\n${MOCK_DATES[1]}-  0:00\n`,
		]);

		await exec(`rm -rf /tmp/ottotime-git`, cwd);
	});
});

async function expectFileToBe(path: string, contents: string) {
	return expect(await readFile(path, 'utf8')).toBe(contents);
}
