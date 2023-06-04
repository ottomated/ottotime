import { z } from 'zod';

export interface Env {
	DB: D1Database;
}

const worker: ExportedHandler<Env> = {
	async fetch(request, env) {
		try {
			const url = new URL(request.url);
			const userId = request.headers.get('X-Api-Key');
			if (!userId) return new Response('Unauthorized', { status: 401 });
			const { pathname } = url;
			if (pathname === '/start_session' && request.method === 'POST') {
				const session = await body(
					request,
					z.object({
						git: z.string().nullable(),
						local: z.string(),
					})
				);
				if (session instanceof Response) return session;
				const { git, local } = session;

				let project = await getProject(env.DB, git, local);
				let projectId = project?.id;
				if (!projectId) {
					projectId = crypto.randomUUID();
					await env.DB.prepare(
						'INSERT INTO projects (id, git_origin, local_paths, user_id) VALUES (?, ?, ?, ?)'
					)
						.bind(projectId, git, JSON.stringify([local]), userId)
						.run();
				} else {
					if (project && !project.localPaths.includes(local)) {
						project.localPaths.push(local);
						await env.DB.prepare('UPDATE projects SET local_paths=? WHERE id=?')
							.bind(JSON.stringify(project.localPaths), projectId)
							.run();
					}
				}

				const sessionId = crypto.randomUUID();
				const time = Date.now();
				await env.DB.prepare(
					'INSERT INTO sessions (id, project_id, start_time, end_time, user_id) VALUES (?, ?, ?, ?, ?)'
				)
					.bind(sessionId, projectId, time, time, userId)
					.run();
				return json({
					id: sessionId,
					startTime: time,
					endTime: time,
				});
			} else if (pathname === '/update_session' && request.method === 'POST') {
				const session = await body(
					request,
					z.object({
						id: z.string().uuid(),
						endTime: z.number(),
					})
				);
				if (session instanceof Response) return session;
				const { id, endTime } = session;
				await env.DB.prepare(
					'UPDATE sessions SET end_time=? WHERE id=? AND user_id=?'
				)
					.bind(endTime, id, userId)
					.run();
				return new Response(null, { status: 204 });
			} else if (pathname === '/past_sessions' && request.method === 'POST') {
				const session = await body(
					request,
					z.object({
						git: z.string().nullable(),
						local: z.string(),
					})
				);
				if (session instanceof Response) return session;
				const { git, local } = session;

				const project = await getProjectId(env.DB, git, local);
				if (!project) return json([]);

				const sessions = await env.DB.prepare(
					'SELECT start_time AS startTime, end_time AS endTime FROM sessions WHERE project_id=? AND endTime - startTime > 15000'
				)
					.bind(project)
					.all<Session>();
				if (sessions.success) {
					return json(sessions.results);
				} else {
					return new Response(sessions.error ?? '', { status: 500 });
				}
			}

			return new Response('Not found', { status: 404 });
		} catch (e) {
			console.error(e);
			return new Response('Internal server error', { status: 500 });
		}
	},
};

type Project = {
	id: string;
	git_origin: string | null;
	local_paths: string[];
	user_id: string;
};
type Session = {
	id: string;
	project_id: string;
	start_time: number;
	end_time: number;
	user_id: string;
};

async function getProjectId(db: D1Database, git: string | null, local: string) {
	let project: any;
	if (git) {
		project = await db
			.prepare(
				'SELECT id FROM projects WHERE git_origin=? OR EXISTS (SELECT 1 FROM json_each(local_paths) WHERE value = ?);'
			)
			.bind(git, local)
			.first();
	} else {
		project = await db
			.prepare(
				'SELECT id FROM projects WHERE EXISTS (SELECT 1 FROM json_each(local_paths) WHERE value = ?);'
			)
			.bind(local)
			.first();
	}
	if (!project) return null;
	return project.id as string;
}
async function getProject(db: D1Database, git: string | null, local: string) {
	let project: any;
	if (git) {
		project = await db
			.prepare(
				'SELECT id, local_paths FROM projects WHERE git_origin=? OR EXISTS (SELECT 1 FROM json_each(local_paths) WHERE value = ?);'
			)
			.bind(git, local)
			.first();
	} else {
		project = await db
			.prepare(
				'SELECT id, local_paths FROM projects WHERE EXISTS (SELECT 1 FROM json_each(local_paths) WHERE value = ?);'
			)
			.bind(local)
			.first();
	}
	if (!project) return null;
	return {
		id: project.id as string,
		localPaths: JSON.parse(project.local_paths) as string[],
	};
}

async function body<T>(
	request: Request,
	schema: z.ZodType<T>
): Promise<T | Response> {
	const json = await request.json().catch(() => null);
	if (json === null) return new Response('Invalid JSON', { status: 400 });
	const result = await schema.safeParseAsync(json);
	if (!result.success)
		return new Response(JSON.stringify(result.error.flatten()), {
			status: 400,
		});
	return result.data;
}

function json<T>(obj: T) {
	return new Response(JSON.stringify(obj), {
		headers: {
			'Content-Type': 'application/json',
		},
	});
}

export default worker;
