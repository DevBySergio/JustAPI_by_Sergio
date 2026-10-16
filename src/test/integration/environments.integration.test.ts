import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnv } from '../../engine/variables/EnvParser';
import { VariableSetManager } from '../../engine/variables/VariableSetManager';
import { VariableEngine } from '../../engine/variables/VariableEngine';
import { AuthService } from '../../engine/auth/AuthService';
import { RequestPreparationService, type RequestPreparation } from '../../services/RequestPreparationService';
import { PersistenceService } from '../../services/PersistenceService';
import { RequestService } from '../../services/RequestService';
import { CodeGenerationService } from '../../services/CodeGenerationService';
import { CodeGenerator } from '../../commands/CodeGenerator';
import type { CollectionService } from '../../services/CollectionService';
import type { HistoryService } from '../../services/HistoryService';
import type { JustResponse } from '../../models/Response';
import type { DataStore } from '../../services/DataStore';
import { startHttpFixtureServer } from '../support/httpFixtureServer';
import { createRequestFixture } from '../fixtures/requestFixtures';

test('uses one environment snapshot through asynchronous preparation and actual HTTP bytes; snippets use the current environment', async context => {
  const server = await startHttpFixtureServer(); context.after(() => server.close());
  const values = new Map<string, unknown>();
  const store: DataStore = { read: async <T>(key: string) => structuredClone(values.get(key) ?? null) as T | null,
    write: async (key, value) => { values.set(key, structuredClone(value)); } };
  const sets = new VariableSetManager(store); context.after(() => sets.dispose());
  const dev = await sets.create('Dev', 'environment', parseEnv(`BASE_URL=${server.baseUrl}\nENV_NAME=dev\nTOKEN=synthetic-env-token`).variables);
  const prod = await sets.create('Prod', 'environment', parseEnv(`BASE_URL=${server.baseUrl}\nENV_NAME=prod\nTOKEN=synthetic-prod-token`).variables);
  await sets.selectEnvironment(dev.id);
  const auth = new AuthService({ get: async () => undefined, store: async () => undefined, delete: async () => undefined }); context.after(() => auth.dispose());
  const collections = { getPersistedRequest: () => undefined } as unknown as CollectionService;
  const preparation = new RequestPreparationService(new VariableEngine(), collections, sets, new PersistenceService(store, store), auth);
  const pinned: RequestPreparation = { ...preparation, capture: () => {
    const captured = preparation.capture();
    return { ...captured, resolve: async (request, collectionId) => { const result = await captured.resolve(request, collectionId); await sets.selectEnvironment(prod.id); return result; },
      resolveForTransport: captured.resolveForTransport.bind(captured), redactForDerivative: captured.redactForDerivative.bind(captured), preview: captured.preview.bind(captured) };
  }, resolve: preparation.resolve.bind(preparation), resolveForTransport: preparation.resolveForTransport.bind(preparation),
  redactForDerivative: preparation.redactForDerivative.bind(preparation), preview: preparation.preview.bind(preparation) };
  const request = createRequestFixture({ method: 'POST', url: '{{BASE_URL}}/echo?environment={{ENV_NAME}}',
    headers: [{ id: 'env-header', key: 'X-Environment', value: '{{ENV_NAME}}', enabled: true }, { id: 'auth', key: 'Authorization', value: 'Bearer {{TOKEN}}', enabled: true }],
    body: { type: 'text', content: 'body={{ENV_NAME}}' } });
  const service = new RequestService(pinned, collections, { record: async () => ({ id: 'summary' }) } as unknown as HistoryService);
  context.after(() => service.dispose()); let response: JustResponse | undefined;
  await service.execute({ type: 'executeRequest', operationId: 'env-op', executionId: 'env-execution', request }, event => { if (event.type === 'response') { response = event.response; } });
  assert.ok(response); assert.equal(response.statusCode, 200);
  const echoed = JSON.parse(response.body) as { query: Record<string, string>; headers: Record<string, string>; body: string };
  assert.equal(echoed.query.environment, 'dev'); assert.equal(echoed.headers['x-environment'], 'dev'); assert.equal(echoed.body, 'body=dev');
  assert.equal(echoed.headers.authorization, 'Bearer synthetic-env-token');
  const generated = await new CodeGenerationService(new CodeGenerator(), preparation, collections, auth, async () => false).generate(request, 'javascript');
  assert.match(generated.code, /prod/); assert.doesNotMatch(generated.code, /synthetic-prod-token|synthetic-env-token/);
  service.finalize('env-op', 'env-execution', () => undefined);
});
