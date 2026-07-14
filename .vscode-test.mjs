import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/extension/**/*.test.js',
	version: '1.80.0',
	mocha: {
		timeout: 20_000,
	},
});
