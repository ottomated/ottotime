import Preview from './Preview.js';
import { mount } from 'svelte';

mount(Preview, {
	target: document.body,
	props: {
		initial: window.initial,
	},
});

window.postMessage('ready', '*');
