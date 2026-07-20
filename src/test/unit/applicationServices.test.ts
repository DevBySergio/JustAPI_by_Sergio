import * as assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { CodeGenerator } from '../../commands/CodeGenerator';
import { AuthService, SecretStorageLike } from '../../engine/auth/AuthService';
import { CollectionManager } from '../../engine/collection/CollectionManager';
import type { ExtensionMessage } from '../../models/MessageProtocol';
import type { JustResponse } from '../../models/Response';
import {
  WebviewMessageRouter,
  WebviewProtocol,
} from '../../protocol/WebviewProtocol';
import { ApplicationError } from '../../services/ApplicationError';
import { CodeGenerationService } from '../../services/CodeGenerationService';
import { CollectionService } from '../../services/CollectionService';
import { DataStore } from '../../services/DataStore';
import { HistoryService } from '../../services/HistoryService';
import { PersistenceService } from '../../services/PersistenceService';
import type {
  RequestPreparation,
  ResolutionPreview,
} from '../../services/RequestPreparationService';
import { RequestService, RequestTransport } from '../../services/RequestService';
import { JsonFileStore } from '../../storage/JsonFileStore';
import { createRequestFixture } from '../fixtures/requestFixtures';

class MemoryStore implements DataStore {
  private readonly values = new Map<string, unknown>();

  async read<T>(key: string): Promise<T | null> {
    const value = this.values.get(key);
    return value === undefined ? null : structuredClone(value) as T;
  }

  async write<T>(key: string, data: T): Promise<void> {
    this.values.set(key, structuredClone(data));
  }
}

class MemorySecrets implements SecretStorageLike {
  private readonly values = new Map<string, string>();

  get(key: string): PromiseLike<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }

  store(key: string, value: string): PromiseLike<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): PromiseLike<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

function responseFixture(): JustResponse {
  return {
    statusCode: 200,
    statusText: 'OK',
    httpVersion: 'HTTP/1.1',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    bodyType: 'json',
    size: 2,
    duration: 4,
    timings: { total: 4 },
    cookies: [],
    redirected: false,
    mimeType: 'application/json',
  };
}

function preparationFixture(): RequestPreparation {
  return {
    resolve: async request => ({ ok: true, request, diagnostics: [] }),
    resolveForTransport: async request => request,
    redactForDerivative: request => request,
    preview: async (): Promise<ResolutionPreview> => ({
      resolvedUrl: '',
      resolvedHeaders: '[]',
      resolvedQueryParams: '[]',
      resolvedBody: '',
      diagnostics: [],
      canExecute: true,
    }),
  };
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(path);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function localDependencies(file: string, sourceFiles: ReadonlySet<string>): string[] {
  const source = readFileSync(file, 'utf8');
  const dependencies: string[] = [];
  const imports = /from\s+['"](\.[^'"]+)['"]/g;
  for (const match of source.matchAll(imports)) {
    const base = resolve(dirname(file), match[1]);
    const candidates = [`${base}.ts`, join(base, 'index.ts')];
    const dependency = candidates.find(candidate => existsSync(candidate) && sourceFiles.has(candidate));
    if (dependency) {
      dependencies.push(dependency);
    }
  }
  return dependencies;
}

describe('webview application services', () => {
  test('routes validated operations, acknowledges success, and centralizes errors', async () => {
    const sent: ExtensionMessage[] = [];
    const protocol = new WebviewProtocol(message => sent.push(message), () => 'operation-generated');
    const handled: string[] = [];
    const router = new WebviewMessageRouter(protocol, async message => {
      handled.push(message.type);
    });
    const valid = { type: 'getSettings', operationId: 'operation-router' } as const;

    await router.handle(valid);
    await router.handle(valid);
    await router.handle({ type: 'unknown', operationId: 'operation-unknown' });

    assert.deepEqual(handled, ['getSettings']);
    assert.deepEqual(sent.map(message => message.type), [
      'acknowledgement',
      'error',
      'error',
    ]);
    assert.equal(sent[1].type === 'error' ? sent[1].code : undefined, 'DUPLICATE_OPERATION');
    assert.equal(sent[2].type === 'error' ? sent[2].code : undefined, 'UNKNOWN_MESSAGE');

    const failedMessages: ExtensionMessage[] = [];
    const failedRouter = new WebviewMessageRouter(
      new WebviewProtocol(message => failedMessages.push(message)),
      async () => {
        throw new ApplicationError('IMPORT_ERROR', ['INVALID_DOCUMENT']);
      }
    );
    await failedRouter.handle({ type: 'getSettings', operationId: 'operation-failed' });
    assert.deepEqual(failedMessages[0], {
      type: 'error',
      operationId: 'operation-failed',
      details: ['INVALID_DOCUMENT'],
      code: 'IMPORT_ERROR',
      message: 'The import document is invalid.',
    });
  });

  test('keeps history and settings behind deterministic storage and clock ports', async () => {
    const store = new MemoryStore();
    const history = new HistoryService(store, {
      now: () => 42,
      createId: () => 'history-deterministic',
    });
    const request = createRequestFixture({
      id: 'request-history-service',
      url: 'https://fixture.test/history',
    });
    const recorded = await history.record(request, responseFixture(), {
      collectionId: 'collection-history',
      hasSavedRequest: true,
    });
    assert.equal(recorded.id, 'history-deterministic');
    assert.equal(recorded.timestamp, 42);
    assert.equal(recorded.requestId, request.id);
    assert.deepEqual(await history.list('200', 1), [recorded]);
    assert.deepEqual(await history.delete(recorded.id), []);

    const persistence = new PersistenceService(store, store);
    await persistence.saveSettings({ theme: 'dark' });
    await persistence.saveVariables([{
      id: 'variable-service',
      key: 'host',
      value: 'fixture.test',
      enabled: true,
      scope: 'global',
    }]);
    assert.deepEqual(await persistence.loadSettings(), { theme: 'dark' });
    assert.equal((await persistence.loadVariables())[0].key, 'host');
  });

  test('executes requests through injected transport and emits correlated service events', async () => {
    const request = createRequestFixture({
      id: 'request-service',
      url: 'https://fixture.test/service',
    });
    const history = new HistoryService(new MemoryStore(), {
      now: () => 84,
      createId: () => 'history-service',
    });
    const collections = {
      getPersistedRequest: () => undefined,
    } as unknown as CollectionService;
    let cancelCount = 0;
    const transport: RequestTransport = {
      cancel: () => { cancelCount += 1; },
      execute: async () => responseFixture(),
    };
    const service = new RequestService(
      preparationFixture(),
      collections,
      history,
      undefined,
      () => transport
    );
    const events: ExtensionMessage[] = [];
    await service.execute({
      type: 'executeRequest',
      operationId: 'operation-request-service',
      executionId: 'execution-request-service',
      request,
    }, event => events.push(event));
    service.finalize(
      'operation-request-service',
      'execution-request-service',
      event => events.push(event)
    );

    assert.deepEqual(events.map(event => event.type), [
      'requestExecuting',
      'response',
      'historyEntry',
      'requestExecuting',
    ]);
    assert.ok(events.every(event => event.operationId === 'operation-request-service'));
    await assert.rejects(
      service.execute({
        type: 'executeRequest',
        operationId: 'operation-request-service-duplicate',
        executionId: 'execution-request-service',
        request,
      }, () => undefined),
      (error: unknown) => error instanceof ApplicationError
        && error.code === 'DUPLICATE_EXECUTION'
    );
    service.dispose();
    assert.equal(cancelCount, 0);
  });

  test('reports execution errors before clearing their active correlation', async () => {
    const request = createRequestFixture({
      url: 'https://fixture.test/{{missing}}',
    });
    const preparation: RequestPreparation = {
      ...preparationFixture(),
      resolve: async unresolved => ({
        ok: false,
        request: unresolved,
        diagnostics: [{
          code: 'MISSING_VARIABLE',
          location: 'url',
          variable: 'missing',
        }],
      }),
    };
    const collections = {
      getPersistedRequest: () => undefined,
    } as unknown as CollectionService;
    const requests = new RequestService(
      preparation,
      collections,
      new HistoryService(new MemoryStore())
    );
    const sent: ExtensionMessage[] = [];
    const protocol = new WebviewProtocol(message => sent.push(message));
    const router = new WebviewMessageRouter(
      protocol,
      async message => {
        if (message.type === 'executeRequest') {
          await requests.execute(message, event => protocol.post(event));
        }
      },
      undefined,
      message => {
        if (message.type === 'executeRequest') {
          requests.finalize(
            message.operationId,
            message.executionId,
            event => protocol.post(event)
          );
        }
      }
    );

    await router.handle({
      type: 'executeRequest',
      operationId: 'operation-error-order',
      executionId: 'execution-error-order',
      request,
    });

    assert.deepEqual(sent.map(message => message.type), [
      'requestExecuting',
      'error',
      'requestExecuting',
    ]);
    assert.equal(sent[1].type === 'error' ? sent[1].code : undefined, 'VARIABLE_RESOLUTION_FAILED');
  });

  test('cancels an active injected transport exactly once during repeated disposal', async () => {
    const request = createRequestFixture({ url: 'https://fixture.test/pending' });
    const collections = {
      getPersistedRequest: () => undefined,
    } as unknown as CollectionService;
    let completeTransport: ((response: JustResponse) => void) | undefined;
    let cancelCount = 0;
    const service = new RequestService(
      preparationFixture(),
      collections,
      new HistoryService(new MemoryStore()),
      undefined,
      () => ({
        execute: async () => await new Promise<JustResponse>(resolveResponse => {
          completeTransport = resolveResponse;
        }),
        cancel: () => {
          cancelCount += 1;
          completeTransport?.(responseFixture());
        },
      })
    );
    const running = service.execute({
      type: 'executeRequest',
      operationId: 'operation-dispose-service',
      executionId: 'execution-dispose-service',
      request,
    }, () => undefined);
    await new Promise<void>(resolveTurn => setImmediate(resolveTurn));

    service.dispose();
    service.dispose();
    await running;
    service.finalize(
      'operation-dispose-service',
      'execution-dispose-service',
      () => undefined
    );

    assert.equal(cancelCount, 1);
  });

  test('validates collection transfer and code generation without constructing the provider', async context => {
    const directory = mkdtempSync(join(tmpdir(), 'justapi-services-'));
    const store = new JsonFileStore(directory);
    const auth = new AuthService(new MemorySecrets());
    const collections = new CollectionService(new CollectionManager(store), auth);
    context.after(async () => {
      await auth.dispose();
      await store.dispose();
      rmSync(directory, { recursive: true, force: true });
    });

    await collections.createCollection('Service fixture');
    const collectionId = collections.getCollections()[0].id;
    const exported = await collections.exportDocument(collectionId, false, async () => false);
    assert.equal(exported.name, 'Service fixture');
    assert.equal(JSON.parse(exported.json).schemaVersion, 2);

    const generated = await new CodeGenerationService(
      new CodeGenerator(),
      preparationFixture(),
      collections,
      auth,
      async () => false
    ).generate(
      createRequestFixture({ url: 'https://fixture.test/code' }),
      'curl'
    );
    assert.equal(generated.language, 'curl');
    assert.match(generated.code, /https:\/\/fixture\.test\/code/);
  });

  test('keeps the extension module graph free of circular dependencies', () => {
    const sourceRoot = resolve(__dirname, '../../..', 'src');
    const sourceFiles = new Set(collectTypeScriptFiles(sourceRoot));
    const graph = new Map(Array.from(sourceFiles, file => [
      file,
      localDependencies(file, sourceFiles),
    ]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const path: string[] = [];

    const visit = (file: string): void => {
      if (visiting.has(file)) {
        const cycleStart = path.indexOf(file);
        const cycle = [...path.slice(cycleStart), file]
          .map(item => relative(sourceRoot, item))
          .join(' -> ');
        assert.fail(`Circular dependency detected: ${cycle}`);
      }
      if (visited.has(file)) {
        return;
      }
      visiting.add(file);
      path.push(file);
      for (const dependency of graph.get(file) ?? []) {
        visit(dependency);
      }
      path.pop();
      visiting.delete(file);
      visited.add(file);
    };

    for (const file of sourceFiles) {
      visit(file);
    }
    assert.equal(visited.size, sourceFiles.size);
  });
});
