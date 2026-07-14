import { spawnSync } from 'node:child_process';

const result = spawnSync('npm', ['exec', '--', 'vsce', 'ls', '--no-dependencies'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const files = result.stdout
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean);

const required = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'dist/extension.js',
  'dist/webview/bundle.js',
  'dist/webview/bundle.js.LICENSE.txt',
  'media/activity-icon.svg',
  'media/icon.png',
];

const forbidden = /(^|\/)(?:node_modules|src|test|tests|out|coverage|docs|scripts|\.github|\.vscode|\.git|\.env)(?:\/|$)|\.map$|\.DS_Store$/i;
const missing = required.filter(file => !files.includes(file));
const unexpected = files.filter(file => forbidden.test(file));

if (missing.length > 0 || unexpected.length > 0) {
  if (missing.length > 0) {
    console.error(`Missing package files: ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    console.error(`Forbidden package files: ${unexpected.join(', ')}`);
  }
  process.exit(1);
}

console.log(`Validated ${files.length} VSIX payload files:`);
console.log(files.join('\n'));
