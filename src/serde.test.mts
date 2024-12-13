import { $ } from 'bun';
import { DataPersister } from './serde.mjs';
import { test, expect, describe } from 'bun:test';

describe('DataPersister', () => {
	test('from no file', async () => {
		await $`rm -f /tmp/.ottotime`;
		const persister = await DataPersister.create('/tmp/.ottotime');
		expect(await persister.length()).toBe(0);
		await persister.add(123, 456);
		expect(await persister.length()).toBe(1);
		expect(await persister.get(0)).toEqual({ start: 123, end: 456 });
		await persister.add(789, 101112);
		expect(await persister.length()).toBe(2);
		expect(await persister.get(0)).toEqual({ start: 123, end: 456 });
		expect(await persister.get(1)).toEqual({ start: 789, end: 101112 });
		const contents = await Bun.file('/tmp/.ottotime').text();
		expect(contents).toBe(
			`# DO NOT EDIT! This file stores ottotime usage data.\newAAAAyAEAAA\nFQMAAA+IoBAA\n`,
		);
		await $`rm -f /tmp/.ottotime`;
	});

	test('from file', async () => {
		await Bun.write(
			'/tmp/.ottotime2',
			`# DO NOT EDIT! This file stores ottotime usage data.\nyAEAAAewAAAA\newAAAAyAEAAA`,
		);
		const persister = await DataPersister.create('/tmp/.ottotime2');
		expect(await persister.length()).toBe(2);
		expect(await persister.get(0)).toEqual({
			start: 456,
			end: 123,
		});
		expect(await persister.get(1)).toEqual({
			start: 123,
			end: 456,
		});
		await $`rm -f /tmp/.ottotime2`;
	});

	test('throws', async () => {
		await $`rm -f /tmp/.ottotime3`;
		const persister = await DataPersister.create('/tmp/.ottotime3');
		expect(() => persister.add(-1, 0)).toThrowError('Time out of bounds');
		expect(() => persister.add(0, 999999999999999)).toThrowError(
			'Time out of bounds',
		);
		expect(await persister.length()).toEqual(0);
		await $`rm -f /tmp/.ottotime3`;
	});

	test('fs watcher', async () => {
		await $`rm -f /tmp/.ottotime4`;
		const persister = await DataPersister.create('/tmp/.ottotime4');
		await persister.add(123, 456);

		await Bun.sleep(20);

		await Bun.write(
			'/tmp/.ottotime4',
			`# DO NOT EDIT! This file stores ottotime usage data.\nyAEAAAewAAAA\newAAAAyAEAAA`,
		);
		// wait for watcher
		await Bun.sleep(2);

		expect(await persister.get(1)).toEqual({
			start: 123,
			end: 456,
		});
		expect(await persister.get(0)).toEqual({
			start: 456,
			end: 123,
		});

		await $`rm -f /tmp/.ottotime4`;
	});
});
