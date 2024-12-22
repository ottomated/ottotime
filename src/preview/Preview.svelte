<script lang="ts">
	import { untrack } from 'svelte';
	import type { Items } from '../serde.mjs';
	import type { Message } from './editor.mjs';
	import { startOfDay } from 'date-fns/startOfDay';

	const {
		initial,
		single,
		vscode,
	}: {
		initial: Array<{
			items: Items;
			workspace: string | null;
			currentSession: null | { start: number; end: number };
		}>;
		single: boolean;
		vscode: { postMessage(msg: string): void };
	} = $props();

	const workspaces = $state(initial);

	function groupDays(
		items: Items,
		currentSession: null | { start: number; end: number },
	) {
		const days = new Map<number, number>();
		let total = 0;

		let foundCurrent = currentSession === null;
		for (const item of items) {
			const date = startOfDay(item.start * 1000).getTime();

			let duration = item.duration;

			if (!foundCurrent && currentSession!.start === item.start) {
				foundCurrent = true;
				duration = currentSession!.end - currentSession!.start;
			}

			const value = days.get(date) ?? 0;
			days.set(date, value + duration);
			total += duration;
		}
		if (!foundCurrent && currentSession) {
			const date = startOfDay(currentSession.start * 1000).getTime();
			const duration = currentSession.end - currentSession.start;

			const value = days.get(date) ?? 0;
			days.set(date, value + duration);
			total += duration;
		}
		return {
			days: [...days].sort((a, b) => a[0] - b[0]),
			total,
		};
	}

	const days = $state(
		workspaces.map((ws) => groupDays(ws.items, ws.currentSession)),
	);
	for (let i = 0; i < workspaces.length; i++) {
		const workspace = workspaces[i]!;
		$effect(() => {
			const group = groupDays(workspace.items, workspace.currentSession);
			untrack(() => {
				days[i] = group;
			});
		});
	}

	function formatDuration(duration: number) {
		const hours = Math.floor(duration / 60 / 60);
		const minutes = Math.floor((duration / 60) % 60);
		const seconds = Math.floor(duration % 60);
		if (hours === 0) return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
		return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
	}
	function getMax(days: Array<[number, number]>) {
		let max = 0;
		for (const day of days) {
			if (day[1] > max) max = day[1];
		}
		return max;
	}
	const thisYear = new Date().getFullYear();
	function formatDate(date: number) {
		const d = new Date(date);
		if (d.getFullYear() === thisYear) {
			return d.toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric',
			});
		}
		return d.toLocaleDateString(undefined, {
			year: '2-digit',
			month: 'numeric',
			day: 'numeric',
		});
	}

	const BAR_WIDTH = 50;
	const BAR_MARGIN = 10;
	const CHART_HEIGHT = 150;
	const TEXT_HEIGHT = 22;
</script>

{#snippet chart(days: Array<[number, number]>, index: number)}
	{@const width = days.length * (BAR_WIDTH + BAR_MARGIN)}
	{@const max = getMax(days)}
	<div class="chart">
		<svg
			width="{width}px"
			height="{CHART_HEIGHT}px"
			viewBox="0 0 {width} {CHART_HEIGHT}"
		>
			<defs>
				<clipPath id="bars-{index}">
					<rect x="0" y="0" {width} height={CHART_HEIGHT - TEXT_HEIGHT + 2} />
				</clipPath>
			</defs>
			{#each days as [date, duration], i}
				{@const x = i * (BAR_WIDTH + BAR_MARGIN) + BAR_MARGIN / 2}
				{@const h = (duration / max) * (CHART_HEIGHT - TEXT_HEIGHT * 2)}
				{@const y = CHART_HEIGHT - TEXT_HEIGHT * 2 - h + TEXT_HEIGHT}
				<rect
					{x}
					{y}
					width={BAR_WIDTH}
					height={h + 5}
					class="bar"
					rx={h > 10 ? 5 : 2}
					clip-path="url(#bars-{index})"
				/>
				<text x={x + BAR_WIDTH / 2} y={y - TEXT_HEIGHT / 2} class="chart-text">
					{formatDuration(duration)}
				</text>
				<text
					x={x + BAR_WIDTH / 2}
					y={CHART_HEIGHT - TEXT_HEIGHT / 2 + 1}
					class="chart-text"
					opacity="0.7"
				>
					{formatDate(date)}
				</text>
			{/each}
			<line
				x1="0"
				y1={CHART_HEIGHT - TEXT_HEIGHT + 2}
				x2={width}
				y2={CHART_HEIGHT - TEXT_HEIGHT + 2}
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			/>
		</svg>
	</div>
{/snippet}

<svelte:window
	onmessage={(ev: MessageEvent<Message>) => {
		const index = ev.data.i ?? 0;
		if (ev.data.type === 'items') {
			workspaces[index]!.items = ev.data.items;
		} else if (ev.data.type === 'workspace') {
			workspaces[index]!.workspace = ev.data.workspace;
		} else if (ev.data.type === 'currentSession') {
			workspaces[index]!.currentSession = ev.data.currentSession;
		}
	}}
/>

<main>
	<header class="header" style:padding-top={single ? 0 : '22px'}>
		<svg width="36" height="36" viewBox="0 0 250 250" fill="currentColor">
			<path
				d="M 111.41,181.52 C 92.48,177.40 77.23,161.82 72.50,141.75 70.57,133.55 70.58,116.09 72.52,108.46 79.04,82.77 98.99,67.03 125.00,67.03 151.03,67.03 170.86,82.69 177.52,108.50 179.56,116.41 179.58,132.71 177.55,141.43 174.06,156.50 163.47,170.71 151.06,176.97 139.74,182.69 124.71,184.41 111.41,181.52 111.41,181.52 111.41,181.52 111.41,181.52 Z  M 140.54,163.77 C 150.13,158.84 157.00,149.23 159.56,137.14 161.50,127.96 161.35,120.67 159.00,111.50 156.60,102.13 153.55,96.64 147.93,91.55 141.06,85.35 135.98,83.57 125.00,83.53 116.58,83.50 114.85,83.82 109.80,86.30 102.58,89.84 95.77,97.33 92.98,104.77 83.12,131.14 93.10,158.95 115.00,166.12 116.38,166.57 121.55,166.81 126.50,166.65 133.86,166.42 136.42,165.89 140.54,163.77 140.54,163.77 140.54,163.77 140.54,163.77 Z"
			/>
			<path
				d="M 216.43,127.24 C 216.43,127.24 218.91,125.29 218.91,125.29 218.91,125.29 215.86,122.39 215.86,122.39 209.84,116.67 209.55,115.38 209.00,92.45 208.39,66.84 207.55,65.75 198.94,65.75 198.94,65.75 194.00,66.00 194.00,66.00 194.00,66.00 194.00,59.37 194.00,59.37 194.00,59.37 194.00,52.75 194.00,52.75 194.00,52.75 198.94,52.78 198.94,52.78 211.17,53.06 217.13,56.05 220.79,61.41 224.42,66.70 225.00,70.47 225.02,88.99 225.04,103.93 225.32,107.11 226.91,110.62 229.01,115.23 232.31,118.00 235.72,118.00 235.72,118.00 238.00,118.00 238.00,118.00 238.00,118.00 238.00,125.00 238.00,125.00 238.00,130.66 238.00,131.06 238.00,131.78 232.84,131.78 228.78,135.26 226.94,139.32 225.31,142.91 225.04,145.98 225.02,161.00 224.99,180.55 224.27,184.49 219.80,189.58 215.31,194.68 210.72,196.81 198.94,197.28 198.94,197.28 194.00,197.28 194.00,197.28 194.00,197.28 194.00,190.64 194.00,190.64 194.00,190.64 194.00,184.00 194.00,184.00 194.00,184.00 189.56,184.16 198.89,184.00 208.22,183.84 208.85,182.38 209.01,158.84 209.50,134.53 210.19,133.06 216.43,127.24 Z"
			/>
			<path
				d="M 33.57,127.24 C 33.57,127.24 31.09,125.29 31.09,125.29 31.09,125.29 34.14,122.39 34.14,122.39 40.16,116.67 40.45,115.38 41.00,92.45 41.61,66.84 42.45,65.75 51.06,65.75 51.06,65.75 56.00,66.00 56.00,66.00 56.00,66.00 56.00,59.37 56.00,59.37 56.00,59.37 56.00,52.75 56.00,52.75 56.00,52.75 51.06,52.78 51.06,52.78 38.83,53.06 32.87,56.05 29.21,61.41 25.58,66.70 25.00,70.47 24.98,88.99 24.96,103.93 24.68,107.11 23.09,110.62 20.99,115.23 17.69,118.00 14.28,118.00 14.28,118.00 12.00,118.00 12.00,118.00 12.00,118.00 12.00,125.00 12.00,125.00 12.00,130.66 12.00,131.06 12.00,131.78 17.16,131.78 21.22,135.26 23.06,139.32 24.69,142.91 24.96,145.98 24.98,161.00 25.01,180.55 25.73,184.49 30.20,189.58 34.69,194.68 39.28,196.81 51.06,197.28 51.06,197.28 56.00,197.28 56.00,197.28 56.00,197.28 56.00,190.64 56.00,190.64 56.00,190.64 56.00,184.00 56.00,184.00 56.00,184.00 60.44,184.16 51.11,184.00 41.78,183.84 41.15,182.38 40.99,158.84 40.50,134.53 39.81,133.06 33.57,127.24 Z"
			/>
		</svg>
		<div class="title">
			<span>Ottotime</span>
			{#if single}
				<span class="workspace">{workspaces[0]!.workspace}</span>
			{:else}
				<span class="workspace">All workspaces</span>
			{/if}
		</div>
		{#if single}
			<div class="total">
				Total: {formatDuration(days[0]!.total)}
			</div>
			<button
				class="edit"
				onclick={() => {
					vscode.postMessage('edit');
				}}
			>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
					<title>Edit</title>
					<path
						d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"
					/>
				</svg>
			</button>
		{/if}
	</header>
	{#if single && workspaces[0]}
		{@render chart(days[0]!.days, 0)}
	{:else}
		{#each workspaces as workspace, i}
			{@const d = days[i]!}
			<section class="workspace-row">
				<div class="workspace-row-name">
					<div>{workspace.workspace}</div>
					<div>Total: {formatDuration(d.total)}</div>
				</div>
				{@render chart(d.days, i)}
			</section>
		{:else}
			<p>No .ottotime files found in recent workspaces!</p>
		{/each}
	{/if}
</main>

<style>
	.workspace-row {
		display: flex;
	}
	.workspace-row-name {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		padding: 0.25rem 0.5rem;
		border-radius: 5px;
		background: var(--vscode-editor-selectionBackground);
		align-self: flex-start;
	}
	.total {
		margin-left: 1rem;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		padding: 0.25rem 0.5rem;
		border-radius: 5px;
		background: var(--vscode-editor-selectionBackground);
	}
	.workspace-row:not(:last-of-type) {
		margin-bottom: 1rem;
		padding-bottom: 1rem;
		border-bottom-width: 1px;
		border-bottom-style: solid;
		border-color: var(--vscode-sideBarSectionHeader-border);
	}
	.chart {
		width: 100%;
		display: flex;
		flex-direction: row-reverse;
		overflow-x: auto;
	}
	.chart-text {
		dominant-baseline: middle;
		text-anchor: middle;
		fill: currentColor;
		font-variant-numeric: tabular-nums;
	}
	.chart svg {
		flex-shrink: 0;
		margin-right: auto;
	}
	main {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		position: sticky;
		top: 0;
		border-bottom-width: 1px;
		border-bottom-style: solid;
		border-color: var(--vscode-sideBarSectionHeader-border);
		background: var(--vscode-editor-background);
		padding-bottom: 0.5rem;
	}
	.title {
		display: flex;
		flex-direction: column;
	}
	.workspace {
		opacity: 0.7;
		font-size: 0.75rem;
	}

	.edit {
		margin-left: auto;
		background: transparent;
		padding: 2px;
		border-radius: 5px;
		color: var(--vscode-editor-foreground);
		border: none;
		width: 20px;
		height: 20px;
		cursor: pointer;
	}
	.edit:hover {
		background: var(--vscode-inputOption-hoverBackground);
	}
	.bar {
		stroke-width: 2;
		stroke: #7f36eb;
		fill: #7f36eb;
		fill-opacity: 0.4;
	}
</style>
