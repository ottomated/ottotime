import { defineConfig } from 'tsup';

export default defineConfig((options) => {
	return {
		entry: ['src/extension.ts', 'src/webmain.ts'],
		external: ['vscode'],
		loader: {
			'.html': 'text',
		},
		minify: !options.watch,
	};
});
