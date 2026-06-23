import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { transform } from 'lightningcss';
import { mkdir, readFile, writeFile } from 'fs/promises';

const production = process.argv.includes('--production');

async function buildSvelte() {
	const source = await readFile('src/preview/Preview.svelte', 'utf8');
	const client = compile(source, {
		name: 'Preview',
		filename: 'Preview.svelte',
		dev: !production,
		generate: 'client',
	});
	for (const warning of client.warnings) {
		console.warn(warning.message);
	}
	await writeFile('src/preview/Preview.js', client.js.code);
	const { code: css } = transform({
		code: Buffer.from(client.css!.code),
		filename: 'preview.css',
		minify: production,
	});
	await mkdir('dist', { recursive: true });
	await writeFile('dist/webview.css', css);
	await build({
		entryPoints: ['src/preview/webview.js'],
		bundle: true,
		conditions: production ? ['production'] : ['development'],
		format: 'esm',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/webview.js',
		external: ['vscode'],
	});
}

async function buildExtension() {
	await build({
		entryPoints: ['src/extension.mts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		define: {
			'process.env.NODE_ENV': JSON.stringify(
				production ? 'production' : 'development',
			),
		},
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
	});
	await build({
		entryPoints: ['src/precommit.mts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/precommit.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			{
				name: 'remove-vscode',
				setup(build) {
					build.onResolve({ filter: /^vscode$/ }, (args) => ({
						path: args.path,
						namespace: 'no-op',
					}));
					build.onLoad({ filter: /.*/, namespace: 'no-op' }, () => ({
						contents: 'export default {}',
						loader: 'js',
					}));
				},
			},
		],
	});
}

async function main() {
	await buildSvelte();
	await buildExtension();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
