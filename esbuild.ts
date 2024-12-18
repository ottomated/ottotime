import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { transform } from 'lightningcss';

const production = process.argv.includes('--production');

async function buildSvelte() {
	const source = await Bun.file('src/preview/Preview.svelte').text();
	const client = compile(source, {
		name: 'Preview',
		filename: 'Preview.svelte',
		dev: !production,
		generate: 'client',
	});
	for (const warning of client.warnings) {
		console.warn(warning.message);
	}
	await Bun.write('src/preview/Preview.js', client.js.code);
	const { code: css } = transform({
		code: Buffer.from(client.css!.code),
		filename: 'preview.css',
		minify: production,
	});
	await Bun.write('dist/webview.css', css);
	await build({
		entryPoints: ['src/preview/webview.js'],
		bundle: true,
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
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
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
