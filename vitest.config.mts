import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
	test: {
		alias: {
			vscode: resolve(import.meta.dirname, 'test/vscode.mock.mts'),
		},
	},
});
