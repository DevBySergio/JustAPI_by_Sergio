import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { RequestFileService } from '../../services/RequestFileService';
import { HttpClient } from '../../engine/http/HttpClient';
import { ResponseDownloadService } from '../../services/ResponseDownloadService';
import { RequestService } from '../../services/RequestService';
import type { RequestPreparation } from '../../services/RequestPreparationService';
import type { HistoryService } from '../../services/HistoryService';
import { createDefaultRequest } from '../../models/Request';
import type { JustResponse } from '../../models/Response';
import { PostmanImportService } from '../../services/PostmanImportService';
import { CollectionService } from '../../services/CollectionService';
import { AuthService } from '../../engine/auth/AuthService';
import { postmanCollection, postmanRequest, postmanEnvironment } from '../fixtures/postmanFixtures';
import * as assert from 'node:assert/strict';
import { existsSync, realpathSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as vscode from 'vscode';
import type { CommandResult } from '../../commands/CommandController';
import { COMMANDS } from '../../constants';
import { regressionFixtures } from '../fixtures/regressionFixtures';
import { VariableSetManager } from '../../engine/variables/VariableSetManager';
import { parseEnv } from '../../engine/variables/EnvParser';
import { VariableEngine } from '../../engine/variables/VariableEngine';
import type { DataStore } from '../../services/DataStore';
import { CurlParser } from '../../engine/http/CurlParser';
import { CollectionManager } from '../../engine/collection/CollectionManager';
import { EnvironmentFileService } from '../../services/EnvironmentFileService';
import { JsonFileStore } from '../../storage/JsonFileStore';

suite('JustAPI extension host', () => {
  test('loads the expected built artifact with packaged payload boundaries', () => {
    const extension = vscode.extensions.all.find(candidate => candidate.id.toLowerCase() === 'devbysergio.justapi');
    assert.ok(extension);
    assert.ok(existsSync(join(extension.extensionPath, 'dist', 'extension.js')));
    if (process.env.JUSTAPI_PACKAGED_EXTENSION) {
      assert.equal(realpathSync(extension.extensionPath), realpathSync(process.env.JUSTAPI_PACKAGED_EXTENSION));
      for (const excluded of ['src', 'node_modules', 'out-webview', 'webview-ui']) {
        assert.equal(existsSync(join(extension.extensionPath, excluded)), false, excluded);
      }
    }
  });
  test('activates at the declared VS Code engine floor', async () => {
    const extension = vscode.extensions.all.find(candidate => (
      candidate.packageJSON.name === 'justapi' && candidate.packageJSON.publisher === 'DevBySergio'
    ));

    assert.ok(extension, 'The JustAPI extension must be installed in the test host');
    await extension.activate();
    assert.equal(extension.isActive, true);
  });

  test('registers every contributed command', async () => {
    const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'justapi');
    assert.ok(extension);
    await extension.activate();
    const availableCommands = new Set(await vscode.commands.getCommands(true));

    const contributedCommands = (extension.packageJSON.contributes.commands as Array<{ command: string }>)
      .map(contribution => contribution.command);
    assert.deepEqual([...contributedCommands].sort(), Object.values(COMMANDS).sort());
    for (const command of contributedCommands) {
      assert.ok(availableCommands.has(command), `Expected command to be registered: ${command}`);
    }
  });

  test('delivers cold and warm startup commands through the contributed webview', async () => {
    const coldResult = await vscode.commands.executeCommand<CommandResult>(COMMANDS.CREATE_REQUEST);
    assert.equal(coldResult?.status, 'completed');

    const warmResult = await vscode.commands.executeCommand<CommandResult>(COMMANDS.OPEN_HISTORY);
    assert.equal(warmResult?.status, 'completed');

    await vscode.commands.executeCommand('workbench.action.closeSidebar');
  });

  test('tracks startup and protocol contracts explicitly', () => {
    const fixtureIds = new Set(regressionFixtures.map(fixture => fixture.id));
    assert.ok(fixtureIds.has('command-startup-queue'));
    assert.ok(fixtureIds.has('protocol-errors'));
    assert.ok(fixtureIds.has('stale-responses'));
    assert.ok(fixtureIds.has('webview-resilience'));
  });
  test('uploads local binary and multipart file bytes in the actual extension runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'justapi-upload-runtime-')); const path = join(root, 'runtime.bin');
    const bytes = Buffer.from([0, 255, 0x80, 13, 10]); writeFileSync(path, bytes);
    const bodies: Buffer[] = []; const types: string[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {
        bodies.push(Buffer.concat(chunks)); types.push(request.headers['content-type'] ?? ''); response.end('OK');
      });
    });
    const files = new RequestFileService(async () => path); const id = randomUUID();
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const file = (await files.select(id))!; const request = { ...createDefaultRequest(id), method: 'POST' as const, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/upload` };
      const createClient = () => new HttpClient({ readFile: (requestId, selected) => files.bytes(requestId, selected) });
      const raw = await createClient().execute({ ...request, body: { type: 'binary', content: '', binarySource: 'file', file } });
      assert.equal(raw.error, undefined); assert.deepEqual(bodies[0], bytes); assert.equal(types[0], 'application/octet-stream');
      const multipart = await createClient().execute({ ...request, body: { type: 'form-data', content: '', files: [{ id: 'part', key: 'upload', enabled: true, file }] } });
      assert.equal(multipart.error, undefined); assert.ok(bodies[1].includes(bytes)); assert.match(types[1], /^multipart\/form-data; boundary=/);
      files.reset(); const expired = await createClient().execute({ ...request, body: { type: 'binary', content: '', binarySource: 'file', file } });
      assert.ok(expired.error); assert.equal(bodies.length, 2);
    } finally { files.reset(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); rmSync(root, { recursive: true, force: true }); }
  });
  test('downloads original HTTP response bytes to a local file in the actual extension runtime', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'justapi-download-runtime-')); const destination = join(temporary, 'response.txt');
    const original = Buffer.from([0xe9, 13, 10, 0x80]);
    const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/plain; charset=iso-8859-1' }); response.end(original); });
    const downloads = new ResponseDownloadService(async () => destination);
    const preparation = { resolve: async request => ({ ok: true, request, diagnostics: [] }), resolveForTransport: async request => request, redactForDerivative: request => request,
      preview: async () => ({ resolvedUrl: '', resolvedHeaders: '[]', resolvedQueryParams: '[]', resolvedBody: '', diagnostics: [], canExecute: true }) } satisfies RequestPreparation;
    const requests = new RequestService(preparation, {} as CollectionService, { record: async () => ({ id: 'summary' }) } as unknown as HistoryService, undefined, undefined, downloads);
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const request = { ...createDefaultRequest(randomUUID()), url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/bytes` };
      let response: JustResponse | undefined;
      await requests.execute({ type: 'executeRequest', operationId: 'runtime-download', executionId: 'runtime-download', request }, event => { if (event.type === 'response') { response = event.response; } });
      assert.equal(response?.error, undefined); assert.ok(response?.download?.available);
      assert.notDeepEqual(Buffer.from(response!.body, 'utf8'), original);
      const result = await downloads.save(response!.download!.responseId); assert.equal(result.status, 'saved');
      assert.deepEqual(await readFile(destination), original);
      requests.finalize('runtime-download', 'runtime-download', () => undefined);
    } finally {
      requests.dispose(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      rmSync(temporary, { recursive: true, force: true });
    }
  });
  test('previews and imports local Postman exports with protected credentials in the actual extension runtime', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'justapi-postman-runtime-')); const file = join(temporary, 'export.json');
    const store = new JsonFileStore(temporary); const secrets = new Map<string, string>();
    const auth = new AuthService({ get: async key => secrets.get(key), store: async (key, value) => { secrets.set(key, value); }, delete: async key => { secrets.delete(key); } });
    const collections = new CollectionService(new CollectionManager(store), auth); const sets = new VariableSetManager(store);
    const imports = new PostmanImportService(collections, sets, async () => file);
    try {
      await collections.load(); await sets.load();
      writeFileSync(file, JSON.stringify(postmanCollection([postmanRequest('Runtime auth', { auth: { type: 'bearer', bearer: [{ key: 'token', value: 'synthetic-runtime-token' }] } })])));
      const preview = (await imports.preview())!; assert.equal(preview.credentials, 1);
      await imports.confirm(preview.previewId, 'Runtime migration', false); assert.equal(secrets.size, 1);
      const collection = collections.getCollections()[0]; const request = collections.getRequest(collections.getRequestsForCollection(collection.id)[0].id)!;
      assert.equal(request.auth.type, 'bearer'); assert.doesNotMatch(JSON.stringify(request), /synthetic-runtime-token/);
      const resolved = await auth.resolveForTransport(request, collections.getPersistedRequest(request.id));
      assert.equal(resolved.headers[0].value, 'Bearer synthetic-runtime-token');
      writeFileSync(file, JSON.stringify(postmanEnvironment([{ key: 'HOST', value: 'runtime.test', enabled: true }])));
      const environment = (await imports.preview())!; await imports.confirm(environment.previewId, 'Runtime environment', false);
      assert.equal(sets.getAll()[0].active, false); assert.equal(sets.getAll()[0].variables[0].value, 'runtime.test');
    } finally {
      imports.reset(); await collections.dispose(); await sets.dispose(); await auth.dispose(); await store.dispose(); rmSync(temporary, { recursive: true, force: true });
    }
  });
  test('creates, imports, selects and restores environments in the actual extension runtime', async () => {
    const data = new Map<string, unknown>();
    const store: DataStore = { read: async <T>(key: string) => JSON.parse(JSON.stringify(data.get(key) ?? null)) as T | null,
      write: async (key, value) => { data.set(key, JSON.parse(JSON.stringify(value))); } };
    const manager = new VariableSetManager(store); const reloaded = new VariableSetManager(store);
    const temporary = mkdtempSync(join(tmpdir(), 'justapi-env-runtime-')); const file = join(temporary, '.env');
    const collectionStore = new JsonFileStore(join(temporary, 'collections')); const collections = new CollectionManager(collectionStore);
    const imports = new EnvironmentFileService(manager, async () => file, () => undefined, () => undefined);
    try {
      await collections.load();
      assert.ok((await collections.createCollection('Runtime collection')).id);
      assert.ok(new CurlParser().parse('curl https://runtime.test').id);
      await manager.create('Manual fixture', 'environment', parseEnv('MANUAL=literal').variables);
      writeFileSync(file, 'HOST=runtime.test\nEMPTY=');
      const preview = (await imports.preview())!;
      await imports.confirm(preview.previewId, 'Host fixture', true);
      assert.equal(imports.getWatches().length, 1); imports.stop(manager.getAll().find(set => set.name === 'Host fixture')!.id);
      assert.equal(imports.getWatches().length, 0);
      const environment = manager.getAll().find(set => set.name === 'Host fixture')!;
      await manager.selectEnvironment(environment.id); await reloaded.load();
      assert.equal(reloaded.getActiveEnvironment()?.id, environment.id);
      assert.equal(new VariableEngine().resolve('https://{{HOST}}/', { globalVars: [], collectionVars: [], requestVars: [], environmentVars: reloaded.getActiveEnvironment()!.variables }), 'https://runtime.test/');
    } finally { imports.reset(); await manager.dispose(); await reloaded.dispose(); await collectionStore.dispose(); rmSync(temporary, { recursive: true, force: true }); }
  });
});
