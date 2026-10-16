import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PostmanImportService } from '../../services/PostmanImportService';
import { CollectionService } from '../../services/CollectionService';
import { AuthService } from '../../engine/auth/AuthService';
import { CollectionManager } from '../../engine/collection/CollectionManager';
import { VariableSetManager } from '../../engine/variables/VariableSetManager';
import { VariableEngine } from '../../engine/variables/VariableEngine';
import { JsonFileStore } from '../../storage/JsonFileStore';
import { RequestPreparationService } from '../../services/RequestPreparationService';
import { PersistenceService } from '../../services/PersistenceService';
import { RequestService } from '../../services/RequestService';
import { CodeGenerationService } from '../../services/CodeGenerationService';
import { CodeGenerator } from '../../commands/CodeGenerator';
import type { HistoryService } from '../../services/HistoryService';
import type { JustResponse } from '../../models/Response';
import { startHttpFixtureServer } from '../support/httpFixtureServer';
import { postmanCollection, postmanRequest, postmanEnvironment } from '../fixtures/postmanFixtures';

test('migrates offline exports through disk and SecretStorage to actual HTTP bytes, templates and default-redacted snippets', async context => {
  const server = await startHttpFixtureServer(); context.after(() => server.close());
  const root = await mkdtemp(join(tmpdir(), 'justapi-postman-http-')); const store = new JsonFileStore(root);
  const secrets = new Map<string, string>(); const auth = new AuthService({ get: async key => secrets.get(key), store: async (key, value) => { secrets.set(key, value); }, delete: async key => { secrets.delete(key); } });
  const collections = new CollectionService(new CollectionManager(store), auth); const sets = new VariableSetManager(store); const persistence = new PersistenceService(store, store);
  await collections.load(); await sets.load();
  const file = join(root, 'migration.json'); const imports = new PostmanImportService(collections, sets, async () => file);
  const preparation = new RequestPreparationService(new VariableEngine(), collections, sets, persistence, auth);
  const requests = new RequestService(preparation, collections, { record: async () => ({ id: 'summary' }) } as unknown as HistoryService);
  context.after(async () => { imports.reset(); requests.dispose(); await collections.dispose(); await sets.dispose(); await auth.dispose(); await store.dispose(); await rm(root, { recursive: true, force: true }); });
  await writeFile(file, JSON.stringify(postmanEnvironment([{ key: 'HOST', value: server.baseUrl }, { key: 'TOKEN', value: 'synthetic-http-token' }, { key: 'USER', value: 'local-user' }, { key: 'PASSWORD', value: 'synthetic-http-password' }])));
  const environmentPreview = (await imports.preview())!; await imports.confirm(environmentPreview.previewId, 'HTTP environment', false); await sets.selectEnvironment(sets.getAll()[0].id);
  const source = postmanCollection([
    postmanRequest('Bearer form', { method: 'POST', url: { raw: '{{HOST}}/echo?x=one&off=two', query: [{ key: 'x', value: 'a + b' }, { key: 'x', value: 'next' }, { key: 'off', value: 'two', disabled: true }] },
      body: { mode: 'urlencoded', urlencoded: [{ key: 'name', value: 'a + b' }, { key: 'off', value: 'hidden', disabled: true }] } }),
    postmanRequest('Basic raw', { method: 'POST', url: '{{HOST}}/echo', auth: { type: 'basic', basic: [{ key: 'username', value: '{{USER}}' }, { key: 'password', value: '{{PASSWORD}}' }] },
      header: [{ key: 'Content-Type', value: 'application/custom' }], body: { mode: 'raw', raw: '{"value":"á + %2F"}', options: { raw: { language: 'json' } } } }),
    postmanRequest('API query', { url: '{{HOST}}/echo', auth: { type: 'apikey', apikey: [{ key: 'key', value: 'api_key' }, { key: 'value', value: '{{TOKEN}}' }, { key: 'in', value: 'query' }] } }),
  ], { auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{TOKEN}}' }] } });
  await writeFile(file, JSON.stringify(source)); const preview = (await imports.preview())!; await imports.confirm(preview.previewId, 'HTTP collection', false);
  const collection = collections.getCollections()[0]; const saved = collections.getRequestsForCollection(collection.id);
  const echoes: Array<{ queryEntries: string[][]; query: Record<string, string>; headers: Record<string, string>; body: string }> = [];
  for (const [index, persisted] of saved.entries()) {
    let response: JustResponse | undefined;
    await requests.execute({ type: 'executeRequest', operationId: `migration-${index}`, executionId: `execution-${index}`, request: collections.getRequest(persisted.id)!, collectionId: collection.id }, event => { if (event.type === 'response') { response = event.response; } });
    assert.equal(response?.statusCode, 200); echoes.push(JSON.parse(response!.body)); requests.finalize(`migration-${index}`, `execution-${index}`, () => undefined);
  }
  assert.deepEqual(echoes[0].queryEntries, [['x', 'a + b'], ['x', 'next']]); assert.equal(echoes[0].body, 'name=a+%2B+b'); assert.equal(echoes[0].headers.authorization, 'Bearer synthetic-http-token');
  assert.equal(echoes[1].headers.authorization, 'Basic ' + Buffer.from('local-user:synthetic-http-password').toString('base64'));
  assert.equal(echoes[1].headers['content-type'], 'application/custom'); assert.equal(echoes[1].body, '{"value":"á + %2F"}');
  assert.equal(echoes[2].query.api_key, 'synthetic-http-token'); assert.equal(echoes[2].headers.authorization, undefined);
  const generation = new CodeGenerationService(new CodeGenerator(), preparation, collections, auth, async () => true);
  for (const persisted of saved) {
    const generated = await generation.generate(collections.getRequest(persisted.id)!, 'curl', collection.id);
    assert.doesNotMatch(generated.code, /synthetic-http|local-user/);
  }
  const disclosed = await generation.generate(collections.getRequest(saved[1].id)!, 'curl', collection.id, true);
  assert.match(disclosed.code, new RegExp(Buffer.from('local-user:synthetic-http-password').toString('base64')));
  const active = sets.getActiveEnvironment()!; await sets.update({ ...active, variables: active.variables.filter(variable => variable.key !== 'TOKEN') });
  await assert.rejects(preparation.resolveForTransport(collections.getRequest(saved[0].id)!, collection.id), error => String(error).includes('VARIABLE_RESOLUTION_FAILED'));
});
