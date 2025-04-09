import globals from 'globals';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier/recommended';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	prettier,
	{
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
		},
		files: ['src/preview/webview.js'],
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'prettier/prettier': 'warn',
			'no-console': ['warn', { allow: ['warn', 'error'] }],
		},
	},
	{ ignores: ['dist/', 'src/preview/Preview.js'] },
);
