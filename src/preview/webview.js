/* global acquireVsCodeApi */
import Preview from './Preview.js';
import { mount } from 'svelte';

mount(Preview, {
	target: document.body,
	props: {
		initial: window.initial,
		vscode: acquireVsCodeApi(),
	},
});
