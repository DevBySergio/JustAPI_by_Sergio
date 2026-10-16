import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/extension/**/*.test.js',
	version: '1.80.0',
	useInstallation: process.env.JUSTAPI_TEST_EXECUTABLE ? { fromPath: process.env.JUSTAPI_TEST_EXECUTABLE } : undefined,
	extensionDevelopmentPath: process.env.JUSTAPI_PACKAGED_EXTENSION,
	launchArgs: process.env.JUSTAPI_TEST_PROFILE ? [
		'--user-data-dir', process.env.JUSTAPI_TEST_PROFILE,
		'--extensions-dir', process.env.JUSTAPI_TEST_EXTENSIONS,
		'--disable-telemetry', '--skip-welcome', '--skip-release-notes',
	] : [],
	mocha: {
		timeout: 20_000,
	},
});
