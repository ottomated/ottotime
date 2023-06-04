import { Chart } from 'chart.js/auto';
import { format, isSameDay, startOfDay } from 'date-fns';

declare global {
	interface Window {
		pastSessions: {
			startTime: number;
			endTime: number;
		}[];
		currentSession: { startTime: number; endTime: number };
	}
}

const canvas = document.getElementById('chart') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const dailyData = new Map<number, number>();
for (const session of window.pastSessions) {
	const startDay = startOfDay(session.startTime).getTime();
	const endDay = startOfDay(session.endTime).getTime();
	if (!dailyData.has(startDay)) dailyData.set(startDay, 0);

	if (endDay !== startDay) {
		if (!dailyData.has(endDay)) dailyData.set(endDay, 0);
		dailyData.set(
			startDay,
			dailyData.get(startDay)! + endDay - session.startTime
		);
		dailyData.set(endDay, dailyData.get(endDay)! + session.endTime - endDay);
	} else {
		dailyData.set(
			startDay,
			dailyData.get(startDay)! + session.endTime - session.startTime
		);
	}
}

const daysWithWork = [...dailyData.keys()].sort((a, b) => a - b);

const labels: string[] = [];
const data: number[] = [];
const cumulativeData: number[] = [];
let acc = 0;

let lastDay = daysWithWork[0];
for (const day of daysWithWork) {
	const diff = day - lastDay;
	lastDay = day;
	if (diff > 1000 * 60 * 60 * 24 * 1.5) {
		labels.push('...');
		data.push(0);
		cumulativeData.push(acc);
	}
	const y = dailyData.get(day)! / 1000 / 60 / 60;
	acc += y;
	data.push(y);
	cumulativeData.push(acc);
	labels.push(format(day, 'MMM do'));
}

const styles = getComputedStyle(document.body);
const textColor = styles.getPropertyValue('--vscode-foreground');
const green = styles.getPropertyValue('--vscode-charts-green');
const red = styles.getPropertyValue('--vscode-charts-red');

const chart = new Chart(ctx, {
	type: 'bar',
	data: {
		labels,
		datasets: [
			{
				label: 'Daily Hours',
				data,
				backgroundColor: green,
				order: 1,
			},
			{
				label: 'Cumulative Hours',
				data: cumulativeData,
				backgroundColor: red,
				borderColor: red,
				type: 'line',
				order: 0,
			},
		],
	},
	options: {
		responsive: true,
		plugins: {
			tooltip: {
				callbacks: {
					label: ({ raw, datasetIndex }) => {
						const hours = Math.floor(raw as number);
						const minutes = Math.floor((raw as number) * 60) % 60;
						const suffix = datasetIndex === 0 ? ' today' : ' total';
						return `${hours}:${minutes.toString().padStart(2, '0')}${suffix}`;
					},
				},
				filter: ({ label }) => label !== '...',
			},
		},
		color: textColor,
		elements: {
			line: {
				borderCapStyle: 'round',
			},
			point: {
				radius: 0,
				hitRadius: 20,
			},
		},
		scales: {
			y: {
				stacked: true,
				ticks: {
					color: textColor,
				},
			},
			x: {
				ticks: {
					color: textColor,
				},
			},
		},
	},
});

// const table = document.getElementById('tbody') as HTMLTableSectionElement;
// const sessions = [...window.pastSessions, window.currentSession].sort(
// 	(a, b) => b.startTime - a.startTime
// );
// for (const session of sessions) {
// 	const row = document.createElement('tr');
// 	const start = document.createElement('td');
// 	const end = document.createElement('td');
// 	const duration = document.createElement('td');
// 	start.textContent = format(session.startTime, 'MMM do, h:mm a');
// 	if (isSameDay(session.startTime, session.endTime)) {
// 		end.textContent = format(session.endTime, 'h:mm a');
// 	} else {
// 		end.textContent = format(session.endTime, 'MMM do, h:mm a');
// 	}
// 	const diff = session.endTime - session.startTime;
// 	const hours = Math.floor(diff / 1000 / 60 / 60);
// 	const minutes = Math.floor((diff / 1000 / 60) % 60);
// 	duration.textContent = `${hours}:${minutes.toString().padStart(2, '0')}`;
// 	row.append(start, end, duration);
// 	table.append(row);
// }

function makeDayContainer(day: number, ranges: HTMLElement[], total: number) {
	const container = document.createElement('details');
	const date = document.createElement('summary');
	date.className = 'day-header';
	const name = document.createElement('h3');
	name.textContent = '▸ ' + format(day, 'MMM do');
	const details = document.createElement('span');
	const hours = Math.floor(total / 1000 / 60 / 60);
	const minutes = Math.floor((total / 1000 / 60) % 60);
	details.textContent = `${hours}:${minutes.toString().padStart(2, '0')}`;
	date.append(name, details);
	container.append(date);
	ranges.reverse();
	container.append(...ranges);
	sessionContainer.append(container);
}

const sessionContainer = document.getElementById('sessions') as HTMLDivElement;
const sessions = [...window.pastSessions, window.currentSession].sort(
	(a, b) => b.startTime - a.startTime
);
if (sessions.length > 0) {
	let ranges: HTMLElement[] = [];
	let day = sessions[0].startTime;
	let total = 0;
	for (const session of sessions) {
		if (!isSameDay(session.startTime, day)) {
			makeDayContainer(day, ranges, total);
			day = session.startTime;
			ranges = [];
			total = 0;
		}
		const range = document.createElement('p');
		range.textContent = `${format(session.startTime, 'h:mm a')} - ${format(
			session.endTime,
			'h:mm a'
		)}`;
		ranges.push(range);
		total += session.endTime - session.startTime;
	}
	makeDayContainer(day, ranges, total);
}

const totalEl = document.getElementById('total') as HTMLDivElement;
const totalTime = cumulativeData[cumulativeData.length - 1];
const hours = Math.floor(totalTime);
const minutes = Math.floor((totalTime * 60) % 60);
totalEl.textContent = `${hours}:${minutes.toString().padStart(2, '0')} total`;

const totalSessionsEl = document.getElementById(
	'totalsessions'
) as HTMLDivElement;
totalSessionsEl.textContent = `${sessions.length} total`;
