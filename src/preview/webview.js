/* global acquireVsCodeApi */
import Preview from './Preview.js';
import { mount } from 'svelte';

const vscode = acquireVsCodeApi();
mount(Preview, {
	target: document.body,
	props: {
		initial: window.initial,
		single: window.single,
		vscode,
	},
});

vscode.postMessage('mounted');
