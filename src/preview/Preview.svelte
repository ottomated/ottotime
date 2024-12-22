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
			total += duration;

			const endTime = (item.start + duration) * 1000;
			const endDate = startOfDay(endTime).getTime();
			if (endDate === date) {
				const value = days.get(date) ?? 0;
				days.set(date, value + duration);
			} else {
				const day2Duration = (endTime - endDate) / 1000;
				const day1Duration = duration - day2Duration;
				const day1 = days.get(date) ?? 0;
				days.set(date, day1 + day1Duration);
				const day2 = days.get(endDate) ?? 0;
				days.set(endDate, day2 + day2Duration);
			}
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
				d="M111.41 181.52c-18.93-4.12-34.18-19.7-38.91-39.77-1.93-8.2-1.92-25.66.02-33.29C79.04 82.77 98.99 67.03 125 67.03c26.03 0 45.86 15.66 52.52 41.47 2.04 7.91 2.06 24.21.03 32.93-3.49 15.07-14.08 29.28-26.49 35.54-11.32 5.72-26.35 7.44-39.65 4.55zm29.13-17.75c9.59-4.93 16.46-14.54 19.02-26.63 1.94-9.18 1.79-16.47-.56-25.64-2.4-9.37-5.45-14.86-11.07-19.95-6.87-6.2-11.95-7.98-22.93-8.02-8.42-.03-10.15.29-15.2 2.77-7.22 3.54-14.03 11.03-16.82 18.47-9.86 26.37.12 54.18 22.02 61.35 1.38.45 6.55.69 11.5.53 7.36-.23 9.92-.76 14.04-2.88zM216.43 127.24l2.48-1.95-3.05-2.9c-6.02-5.72-6.31-7.01-6.86-29.94-.61-25.61-1.45-26.7-10.06-26.7L194 66v-6.63-6.62l4.94.03c12.23.28 18.19 3.27 21.85 8.63 3.63 5.29 4.21 9.06 4.23 27.58.02 14.94.3 18.12 1.89 21.63 2.1 4.61 5.4 7.38 8.81 7.38H238V131.78c-5.16 0-9.22 3.48-11.06 7.54-1.63 3.59-1.9 6.66-1.92 21.68-.03 19.55-.75 23.49-5.22 28.58-4.49 5.1-9.08 7.23-20.86 7.7H194v-6.64V184s-4.44.16 4.89 0 9.96-1.62 10.12-25.16c.49-24.31 1.18-25.78 7.42-31.6zM33.57 127.24l-2.48-1.95 3.05-2.9c6.02-5.72 6.31-7.01 6.86-29.94.61-25.61 1.45-26.7 10.06-26.7L56 66v-6.63-6.62l-4.94.03c-12.23.28-18.19 3.27-21.85 8.63-3.63 5.29-4.21 9.06-4.23 27.58-.02 14.94-.3 18.12-1.89 21.63-2.1 4.61-5.4 7.38-8.81 7.38H12V131.78c5.16 0 9.22 3.48 11.06 7.54 1.63 3.59 1.9 6.66 1.92 21.68.03 19.55.75 23.49 5.22 28.58 4.49 5.1 9.08 7.23 20.86 7.7H56v-6.64V184s4.44.16-4.89 0-9.96-1.62-10.12-25.16c-.49-24.31-1.18-25.78-7.42-31.6z"
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
