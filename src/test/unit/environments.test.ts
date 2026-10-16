import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEnv } from '../../engine/variables/EnvParser';
import { VariableSetManager } from '../../engine/variables/VariableSetManager';
import { VariableEngine } from '../../engine/variables/VariableEngine';
import { EnvironmentFileService } from '../../services/EnvironmentFileService';
import { RequestPreparationService } from '../../services/RequestPreparationService';
import { PersistenceService } from '../../services/PersistenceService';
import type { CollectionService } from '../../services/CollectionService';
import { AuthService } from '../../engine/auth/AuthService';
import { validateExtensionMessage, validateWebviewMessage } from '../../protocol/MessageValidator';
import type { DataStore } from '../../services/DataStore';
import type { EnvImportPreview } from '../../models/Environment';
import { createRequestFixture } from '../fixtures/requestFixtures';
import { createPersistedRequestWorkspace, restoreRequestWorkspace } from '../../webview/WebviewState';

class Store implements DataStore {
  values = new Map<string, unknown>(); fail = false;
  async read<T>(key: string): Promise<T | null> { return structuredClone(this.values.get(key) ?? null) as T | null; }
  async write<T>(key: string, data: T): Promise<void> { if (this.fail) { throw new Error('disk failure'); } this.values.set(key, structuredClone(data)); }
}
const variable = (key: string, value: string, enabled = true) => ({ id: crypto.randomUUID(), key, value, enabled, scope: 'collection' as const });

describe('local environments and dotenv', () => {
  test('parses literal assignments, quotes, comments, CRLF/BOM, empty and multiline values without shell expansion', () => {
    const parsed = parseEnv('\uFEFF# heading\r\nexport HOST = https://local.test # note\r\nEMPTY=\r\nSINGLE=\' # literal \'\r\nDOUBLE="first\\nsecond\\r\\\"quote\\\\"\r\nMULTI="one\r\ntwo"\r\nSHELL=$(touch /tmp/never-run)\r\nREF=${HOST}');
    assert.deepEqual(parsed.diagnostics, []);
    assert.deepEqual(parsed.variables.map(value => [value.key, value.value]), [
      ['HOST', 'https://local.test'], ['EMPTY', ''], ['SINGLE', ' # literal '], ['DOUBLE', 'first\nsecond\r"quote\\'],
      ['MULTI', 'one\ntwo'], ['SHELL', '$(touch /tmp/never-run)'], ['REF', '${HOST}'],
    ]);
  });
  test('reports duplicates and invalid syntax without echoing values; enforces all bounds', () => {
    const invalid = parseEnv('KEY=synthetic-secret\nKEY=other-secret\n1BAD=x\nmissing\nTRAIL="value" nope\nOPEN="unfinished');
    assert.deepEqual(invalid.diagnostics.map(item => item.code), ['DUPLICATE_NAME', 'INVALID_NAME', 'INVALID_ASSIGNMENT', 'TRAILING_CONTENT', 'UNTERMINATED_QUOTE']);
    assert.doesNotMatch(JSON.stringify(invalid.diagnostics), /synthetic|other-secret|unfinished/);
    assert.throws(() => parseEnv('x'.repeat(1024 * 1024 + 1)));
    assert.throws(() => parseEnv('BINARY=\0'));
    assert.equal(parseEnv('LONG=' + 'a'.repeat(65537)).diagnostics[0].code, 'VALUE_TOO_LARGE');
    assert.equal(parseEnv(Array.from({ length: 1001 }, (_, index) => `K${index}=v`).join('\n')).diagnostics[0].code, 'TOO_MANY_VARIABLES');
  });
  test('retains shared sets and applies only the selected environment at its own precedence', async () => {
    const store = new Store(); const sets = new VariableSetManager(store);
    const shared = await sets.create('Shared'); await sets.update({ ...shared, linkedCollectionIds: ['collection'], variables: [variable('HOST', 'shared.test')] });
    const dev = await sets.create('Dev', 'environment', [variable('HOST', 'dev.test')]);
    const prod = await sets.create('Prod', 'environment', [variable('HOST', 'prod.test')]);
    assert.equal(sets.getActiveEnvironment(), undefined);
    await sets.selectEnvironment(dev.id);
    const context = { globalVars: [variable('HOST', 'global.test')], setsVars: sets.getVariablesForCollection('collection'), environmentVars: sets.getActiveEnvironment()!.variables, collectionVars: [], requestVars: [] };
    const engine = new VariableEngine(); assert.equal(engine.resolve('{{HOST}}', context), 'dev.test');
    assert.equal(engine.resolve('{{HOST}}', { ...context, collectionVars: [variable('HOST', 'collection.test')] }), 'collection.test');
    assert.equal(engine.resolve('{{HOST}}', { ...context, requestVars: [variable('HOST', 'request.test')] }), 'request.test');
    assert.equal(engine.resolve('{{HOST}}', { ...context, environmentVars: [variable('HOST', 'ignored', false)] }), 'shared.test');
    await sets.selectEnvironment(prod.id); const reloaded = new VariableSetManager(store); await reloaded.load();
    assert.equal(reloaded.getActiveEnvironment()?.id, prod.id);
    await sets.selectEnvironment(null); assert.equal(sets.getActiveEnvironment(), undefined);
    await assert.rejects(sets.selectEnvironment(shared.id));
    await sets.dispose(); await reloaded.dispose();
  });
  test('serializes selection, rolls back disk failures and rejects stale environment edits', async () => {
    const store = new Store(); const sets = new VariableSetManager(store);
    const [a, b] = await Promise.all([sets.create('A', 'environment'), sets.create('B', 'environment')]);
    await Promise.all([sets.selectEnvironment(a.id), sets.selectEnvironment(b.id)]);
    assert.equal(sets.getAll().filter(set => set.active).length, 1); assert.equal(sets.getActiveEnvironment()?.id, b.id);
    const before = sets.getAll(); store.fail = true;
    await assert.rejects(sets.selectEnvironment(a.id)); assert.deepEqual(sets.getAll(), before);
    store.fail = false; await assert.rejects(sets.update({ ...b, name: 'stale' }));
    await sets.delete(b.id); assert.equal(sets.getActiveEnvironment(), undefined);
    await sets.dispose();
  });
  test('pins the selected environment for an operation even if selection changes before transport resolution', async () => {
    const store = new Store(); const sets = new VariableSetManager(store);
    const a = await sets.create('A', 'environment', [variable('HOST', 'a.test')]);
    const b = await sets.create('B', 'environment', [variable('HOST', 'b.test')]); await sets.selectEnvironment(a.id);
    const auth = new AuthService({ get: async () => undefined, store: async () => undefined, delete: async () => undefined });
    const preparation = new RequestPreparationService(new VariableEngine(), { getPersistedRequest: () => undefined } as unknown as CollectionService, sets, new PersistenceService(store, store), auth);
    const request = createRequestFixture({ url: 'https://{{HOST}}/items' });
    const captured = preparation.capture(); assert.equal((await captured.resolve(request)).request.url, 'https://a.test/items');
    await sets.selectEnvironment(b.id);
    assert.equal((await captured.resolveForTransport(request)).url, 'https://a.test/items');
    assert.equal((await preparation.resolve(request)).request.url, 'https://b.test/items');
    await sets.dispose(); await auth.dispose();
  });
  test('stages imports without writes, confirms reviewed bytes once and rejects changed files', async context => {
    const root = await mkdtemp(join(tmpdir(), 'justapi-env-')); context.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, '.env'); await writeFile(path, 'HOST=local.test\nTOKEN=synthetic-token');
    const store = new Store(); const sets = new VariableSetManager(store); const service = new EnvironmentFileService(sets, async () => path, () => undefined, () => undefined);
    context.after(() => { service.reset(); });
    const preview = (await service.preview())!; assert.equal(sets.getAll().length, 0); assert.equal(preview.fileName, '.env');
    assert.equal(validateExtensionMessage({ type: 'envImportPreview', operationId: 'preview', preview }).ok, true);
    const results = await Promise.allSettled([service.confirm(preview.previewId, 'Local', false), service.confirm(preview.previewId, 'Duplicate', false)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(sets.getAll().length, 1);
    assert.equal(sets.getActiveEnvironment(), undefined); assert.deepEqual(service.getWatches(), []);
    const changed = (await service.preview())!; await writeFile(path, 'HOST=changed.test');
    await assert.rejects(service.confirm(changed.previewId, 'Changed', false)); assert.equal(sets.getAll().length, 1);
    await sets.dispose();
  });
  test('retains a failed import for retry; cancellation, malformed UTF-8, directories and binary input never commit', async context => {
    const root = await mkdtemp(join(tmpdir(), 'justapi-env-')); context.after(() => rm(root, { recursive: true, force: true }));
    let path: string | undefined = join(root, '.env'); await writeFile(path, 'KEY=value');
    const store = new Store(); const sets = new VariableSetManager(store); const service = new EnvironmentFileService(sets, async () => path, () => undefined, () => undefined);
    context.after(() => service.reset()); const preview = (await service.preview())!;
    store.fail = true; await assert.rejects(service.confirm(preview.previewId, 'Retry', false)); assert.equal(sets.getAll().length, 0);
    store.fail = false; await service.confirm(preview.previewId, 'Retry', false);
    const cancelled = (await service.preview())!; service.cancel(cancelled.previewId); await assert.rejects(service.confirm(cancelled.previewId, 'Cancelled', false));
    await writeFile(path!, Buffer.from([0xff])); await assert.rejects(service.preview());
    path = root; await assert.rejects(service.preview()); path = undefined; assert.equal(await service.preview(), undefined);
    await sets.dispose();
  });
  test('opt-in watching previews atomic replacements without applying; stale target, stop and reset are protected', async context => {
    const root = await mkdtemp(join(tmpdir(), 'justapi-env-')); context.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, '.env'); await writeFile(path, 'HOST=first.test');
    const sets = new VariableSetManager(new Store()); const previews: EnvImportPreview[] = []; let changed: () => void = () => undefined; let stopped = 0;
    const service = new EnvironmentFileService(sets, async () => path, preview => previews.push(preview), () => undefined,
      (_path, callback) => { changed = callback; return () => { stopped++; }; });
    context.after(() => service.reset()); const first = (await service.preview())!; await service.confirm(first.previewId, 'Watched', true);
    const saved = sets.getAll()[0]; assert.equal(service.getWatches()[0].setId, saved.id);
    const pending = join(root, '.env.tmp'); await writeFile(pending, 'HOST=second.test'); await rename(pending, path); changed();
    for (let attempt = 0; attempt < 100 && !previews.length; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.equal(previews.length, 1); assert.equal(sets.getById(saved.id)?.variables[0].value, 'first.test');
    await sets.update({ ...saved, name: 'Edited in UI' }); await assert.rejects(service.confirm(previews[0].previewId, 'Replace', true));
    service.stop(saved.id); assert.deepEqual(service.getWatches(), []); assert.equal(stopped, 1);
    await writeFile(path, 'HOST=ignored.test'); changed(); await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(previews.length, 1);
    const reset = (await service.preview())!; service.reset(); await assert.rejects(service.confirm(reset.previewId, 'Reset', false));
    await sets.dispose();
  });
  test('validates new protocol messages, rejects arbitrary paths and preserves legacy set payloads', () => {
    for (const message of [
      { type: 'selectEnvironment', setId: null }, { type: 'selectEnvironment', setId: 'env' },
      { type: 'previewEnvFile' }, { type: 'previewEnvFile', setId: 'env' },
      { type: 'confirmEnvImport', previewId: 'preview', name: 'Local', watch: false },
      { type: 'cancelEnvImport', previewId: 'preview' }, { type: 'stopEnvWatch', setId: 'env' },
      { type: 'createVariableSet', name: 'Environment', kind: 'environment' },
    ]) { assert.equal(validateWebviewMessage({ ...message, operationId: 'op' }).ok, true, message.type); }
    assert.equal(validateWebviewMessage({ type: 'previewEnvFile', operationId: 'op', path: '/etc/passwd' }).ok, false);
    assert.equal(validateWebviewMessage({ type: 'selectEnvironment', operationId: 'op', setId: 7 }).ok, false);
    assert.equal(validateExtensionMessage({ type: 'envWatches', operationId: 'op', watches: [{ setId: 'env', fileName: '.env' }] }).ok, true);
  });
  test('the real file watcher detects atomic replacement and stopping prevents subsequent previews', { timeout: 6000 }, async context => {
    const root = await mkdtemp(join(tmpdir(), 'justapi-env-watch-')); context.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, '.env'); await writeFile(path, 'HOST=initial.test');
    const sets = new VariableSetManager(new Store()); const previews: EnvImportPreview[] = [];
    const service = new EnvironmentFileService(sets, async () => path, preview => previews.push(preview), () => undefined);
    context.after(() => service.reset()); const initial = (await service.preview())!; await service.confirm(initial.previewId, 'Local', true);
    await new Promise(resolve => setTimeout(resolve, 30));
    const replacement = join(root, '.env.next'); await writeFile(replacement, 'HOST=replacement.test'); await rename(replacement, path);
    const deadline = Date.now() + 3500;
    while (!previews.length && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 30)); }
    assert.equal(previews.length, 1); assert.equal(previews[0].variables[0].value, 'replacement.test');
    assert.equal(sets.getAll()[0].variables[0].value, 'initial.test');
    await service.confirm(previews[0].previewId, 'Local', true); assert.equal(sets.getAll()[0].variables[0].value, 'replacement.test');
    service.stop(sets.getAll()[0].id); await writeFile(path, 'HOST=ignored.test');
    assert.deepEqual(service.getWatches(), []); await sets.dispose();
  });
  test('warns after reload about unsaved environment edits without persisting their values', () => {
    const request = createRequestFixture();
    const saved = createPersistedRequestWorkspace({ activeTab: 'variables', variableSubTab: 'environments', activeRequestTabId: 'tab', pendingEnvironmentEdits: true,
      tabs: [{ tabId: 'tab', currentRequest: request, baselineRequest: request, collectionId: null, baselineCollectionId: null, pendingAuth: false }] });
    const restored = restoreRequestWorkspace(saved)!; assert.equal(restored.variableSubTab, 'environments');
    assert.equal(restored.redactedValues, true); assert.equal(restored.pendingEnvironmentEdits, false);
    assert.equal(restoreRequestWorkspace({ ...saved, pendingEnvironmentEdits: 'invalid' }), null);
  });
  test('allows an explicitly confirmed empty file without activating or modifying another environment', async context => {
    const root = await mkdtemp(join(tmpdir(), 'justapi-env-empty-')); context.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, '.env'); await writeFile(path, '# intentionally empty\n');
    const sets = new VariableSetManager(new Store()); const service = new EnvironmentFileService(sets, async () => path, () => undefined, () => undefined);
    context.after(() => service.reset()); const preview = (await service.preview())!; assert.equal(preview.variables.length, 0);
    await service.confirm(preview.previewId, 'Empty', false); assert.equal(sets.getAll().length, 1); assert.equal(sets.getActiveEnvironment(), undefined);
    await sets.dispose();
  });
});
