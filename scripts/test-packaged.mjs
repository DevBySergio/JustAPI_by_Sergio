import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, runVSCodeCommand } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const vsix = join(root, `${manifest.name}-${manifest.version}.vsix`);
const cli = join(root, 'node_modules', '@vscode', 'test-cli', 'out', 'bin.mjs');
const scratch = await mkdtemp(join(tmpdir(), 'justapi-vsix-test-'));
const digest = data => createHash('sha256').update(data).digest('hex');

try {
  // Each version uses a fresh profile, extensions directory, data store, and SecretStorage.
  for (const version of process.argv.slice(2).length ? process.argv.slice(2) : ['1.80.0', 'stable']) {
    const profile = join(scratch, version, 'profile');
    const extensions = join(scratch, version, 'extensions');
    let executable = await downloadAndUnzipVSCode(version);
    if (process.platform === 'darwin' && !await access(executable).then(() => true, () => false)) {
      // Recent VS Code macOS bundles call their executable Code instead of Electron.
      executable = join(dirname(executable), 'Code');
      await access(executable);
    }
    await runVSCodeCommand([
      '--install-extension', vsix, '--force', '--extensions-dir', extensions,
      '--user-data-dir', profile, '--disable-telemetry',
    ], { version });
    const candidates = await readdir(extensions);
    let installed;
    for (const candidate of candidates) {
      const directory = join(extensions, candidate);
      const pkg = await readFile(join(directory, 'package.json'), 'utf8').then(JSON.parse).catch(() => null);
      if (pkg?.name === manifest.name && pkg?.publisher === manifest.publisher) { installed = directory; break; }
    }
    if (!installed) { throw new Error(`The VSIX was not installed for VS Code ${version}.`); }
    const webviewFiles = (await readdir(join(root, 'dist', 'webview')))
      .filter(file => /\.js(?:\.LICENSE\.txt)?$/.test(file));
    for (const path of ['dist/extension.js', ...webviewFiles.map(file => `dist/webview/${file}`)]) {
      if (digest(await readFile(join(installed, path))) !== digest(await readFile(join(root, path)))) {
        throw new Error(`Packaged bytes differ from the verified build: ${path}`);
      }
    }
    await new Promise((accept, reject) => {
      const child = spawn(process.execPath, [cli, '--code-version', version], {
        cwd: root, stdio: 'inherit', env: {
          ...process.env, JUSTAPI_PACKAGED_EXTENSION: installed,
          JUSTAPI_TEST_PROFILE: profile, JUSTAPI_TEST_EXTENSIONS: extensions,
          JUSTAPI_TEST_EXECUTABLE: executable,
        },
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`Packaged tests failed (${code ?? signal}) on VS Code ${version}.`)));
    });
    console.log(`Packaged JustAPI ${manifest.version} passed on VS Code ${version}.`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
