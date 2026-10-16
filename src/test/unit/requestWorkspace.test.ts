import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { OperationCorrelationTracker } from '../../protocol/CorrelationTracker';
import { RequestService } from '../../services/RequestService';
import type { RequestPreparation } from '../../services/RequestPreparationService';
import type { CollectionService } from '../../services/CollectionService';
import type { HistoryService } from '../../services/HistoryService';
import { WebviewMessageHandler, type WebviewMessageHandlerOptions } from '../../webview/WebviewMessageHandler';
import type { ExtensionMessage } from '../../models/MessageProtocol';
import type { JustResponse } from '../../models/Response';
import type { JustRequest } from '../../models/Request';
import {
  createPersistedRequestWorkspace, createPersistedWebviewState, restoreRequestWorkspace,
  REQUEST_WORKSPACE_LIMITS, requestsDiffer, type PersistedRequestTab,
} from '../../webview/WebviewState';
import { createRequestFixture } from '../fixtures/requestFixtures';

function tab(id: string): PersistedRequestTab {
  const request = createRequestFixture({ id, name: id, url: `https://example.test/${id}` });
  return { tabId: `tab-${id}`, currentRequest: { ...request, name: `${id} edited` }, baselineRequest: request,
    collectionId: `collection-${id}`, baselineCollectionId: `collection-${id}`, pendingAuth: false };
}
function persist(tabs: PersistedRequestTab[]) {
  return createPersistedRequestWorkspace({ activeTab: 'editor', variableSubTab: 'vars', activeRequestTabId: tabs.at(-1)!.tabId, tabs });
}

describe('request workspace state and correlation', () => {
  test('restores every draft, baseline and collection while dropping all pending auth independently', () => {
    const first = tab('first');
    first.currentRequest.auth = { type: 'bearer', configured: true };
    first.pendingAuth = true;
    first.currentRequest.headers = [{ id: 'secret', key: 'Authorization', value: 'Bearer synthetic-secret', enabled: true }];
    const second = tab('second');
    second.baselineRequest.auth = { type: 'bearer', configured: true };
    second.currentRequest.auth = { type: 'basic', configured: true };
    second.pendingAuth = true;
    const serialized = persist([first, second]);
    assert.doesNotMatch(JSON.stringify(serialized), /synthetic-secret/);
    const restored = restoreRequestWorkspace(serialized)!;
    assert.equal(restored.activeRequestTabId, second.tabId);
    assert.deepEqual(restored.tabs.map(value => value.currentRequest.name), ['first edited', 'second edited']);
    assert.deepEqual(restored.tabs.map(value => value.collectionId), ['collection-first', 'collection-second']);
    assert.deepEqual(restored.tabs.map(value => value.currentRequest.auth), [{ type: 'none' }, { type: 'bearer', configured: true }]);
    assert.ok(restored.tabs.every(value => value.pendingAuth === false && requestsDiffer(value.currentRequest, value.baselineRequest)));
    assert.equal(restored.redactedValues, true);
    assert.doesNotMatch(JSON.stringify(serialized), /response|activeExecutionId|authUpdate/);
  });

  test('migrates the previous single-editor state without losing its dirty draft', () => {
    const source = tab('legacy');
    const legacy = createPersistedWebviewState({ activeTab: 'codegen', variableSubTab: 'sets', activeCollectionId: source.collectionId,
      currentRequest: source.currentRequest, baselineRequest: source.baselineRequest });
    const restored = restoreRequestWorkspace(legacy)!;
    assert.equal(restored.tabs.length, 1);
    assert.equal(restored.tabs[0].currentRequest.name, 'legacy edited');
    assert.equal(restored.tabs[0].baselineRequest.name, 'legacy');
    assert.equal(restored.activeTab, 'codegen');
    assert.equal(restored.variableSubTab, 'sets');
  });

  test('preserves ordinary URL spelling and JSON whitespace edits across restoration', () => {
    const source = tab('formatting');
    source.currentRequest.url = 'https://example.test';
    source.baselineRequest.url = 'https://example.test/';
    source.currentRequest.body = { type: 'json', content: '{ "value" : 1 }' };
    source.baselineRequest.body = { type: 'json', content: '{"value":1}' };
    const restored = restoreRequestWorkspace(persist([source]))!.tabs[0];
    assert.equal(restored.currentRequest.url, source.currentRequest.url);
    assert.equal(restored.currentRequest.body.content, source.currentRequest.body.content);
    assert.equal(restored.baselineRequest.body.content, source.baselineRequest.body.content);
    assert.equal(requestsDiffer(restored.currentRequest, restored.baselineRequest), true);
  });

  test('rejects duplicate identities, mismatched baselines, bad active tabs and excessive tab counts', () => {
    const saved = persist([tab('first'), tab('second')]);
    for (const mutate of [
      (value: typeof saved) => { value.tabs[1].tabId = value.tabs[0].tabId; },
      (value: typeof saved) => { value.tabs[1].currentRequest.id = value.tabs[0].currentRequest.id; },
      (value: typeof saved) => { value.tabs[1].baselineRequest.id = 'mismatched'; },
      (value: typeof saved) => { value.activeRequestTabId = 'missing'; },
      (value: typeof saved) => { value.tabs = Array.from({ length: 21 }, (_, index) => tab(`tab-${index}`)); },
    ]) {
      const copy = JSON.parse(JSON.stringify(saved)) as typeof saved;
      mutate(copy); assert.equal(restoreRequestWorkspace(copy), null);
    }
  });

  test('bounds persisted state and retains identities without mutating live large drafts', () => {
    const tabs = Array.from({ length: 20 }, (_, index) => tab(`large-${index}`));
    for (const value of tabs) {
      value.currentRequest.body = { type: 'text', content: 'ñ'.repeat(200_000) };
      value.baselineRequest.body = { type: 'text', content: 'x'.repeat(200_000) };
    }
    const saved = persist(tabs);
    assert.ok(Buffer.byteLength(JSON.stringify(saved)) <= REQUEST_WORKSPACE_LIMITS.maximumBytes);
    assert.equal(saved.tabs.length, 20);
    assert.equal(saved.redactedValues, true);
    assert.ok(tabs.every(value => value.currentRequest.body.content.length === 200_000));
    assert.ok(restoreRequestWorkspace(saved));
  });

  test('supersedes queries only within the same request while preserving mutation acknowledgements', () => {
    const tracker = new OperationCorrelationTracker();
    for (const action of ['getRequest', 'previewResolution', 'generateCode'] as const) {
      tracker.record(action, `${action}-first-old`, 'first');
      tracker.record(action, `${action}-second`, 'second');
      tracker.record(action, `${action}-first-new`, 'first');
      assert.equal(tracker.isCurrent(`${action}-first-old`), false);
      assert.equal(tracker.isCurrent(`${action}-second`), true);
      assert.equal(tracker.isCurrent(`${action}-first-new`), true);
    }
    tracker.record('saveRequest', 'save-first'); tracker.record('getCollections', 'read');
    assert.equal(tracker.isCurrent('save-first'), true);
  });

  test('cancels one concurrent execution without interrupting the other response or history', async () => {
    const response: JustResponse = { statusCode: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: {},
      body: 'response', bodyType: 'text', size: 8, duration: 1, timings: { total: 1 }, cookies: [], redirected: false };
    const releases: Array<() => void> = [];
    const cancelled: number[] = [];
    const events: ExtensionMessage[] = [];
    const history: string[] = [];
    const preparation: RequestPreparation = { resolve: async request => ({ ok: true, request, diagnostics: [] }),
      resolveForTransport: async request => request, redactForDerivative: request => request,
      preview: async () => ({ resolvedUrl: '', resolvedHeaders: '[]', resolvedQueryParams: '[]', resolvedBody: '', diagnostics: [], canExecute: true }) };
    const service = new RequestService(preparation, { getPersistedRequest: () => undefined } as unknown as CollectionService,
      { record: async (request: JustRequest) => { history.push(request.id); return { id: request.id }; } } as unknown as HistoryService,
      undefined, () => {
        const index = releases.length;
        const waiting = new Promise<void>(resolve => { releases.push(resolve); });
        return { cancel: () => { cancelled.push(index); }, execute: async () => { await waiting; return response; } };
      });
    const first = service.execute({ type: 'executeRequest', operationId: 'first-op', executionId: 'first', request: createRequestFixture({ id: 'first' }) }, message => events.push(message));
    const second = service.execute({ type: 'executeRequest', operationId: 'second-op', executionId: 'second', request: createRequestFixture({ id: 'second' }) }, message => events.push(message));
    await Promise.resolve(); await Promise.resolve();
    service.cancel('cancel-first', 'first', message => events.push(message));
    releases.forEach(release => release());
    await Promise.all([first, second]);
    assert.deepEqual(cancelled, [0]);
    assert.deepEqual(events.filter(message => message.type === 'response').map(message => message.executionId), ['second']);
    assert.deepEqual(history, ['second']);
    service.finalize('first-op', 'first', () => undefined); service.finalize('second-op', 'second', () => undefined);
    service.dispose(); assert.deepEqual(cancelled, [0]);
  });

  test('cancels previous view executions before clearing staged credentials on recreation', async () => {
    const order: string[] = [];
    const handler = new WebviewMessageHandler({ requests: { dispose: () => order.push('cancel') },
      collections: { discardAllPendingAuth: async () => { order.push('discard'); } } } as unknown as WebviewMessageHandlerOptions);
    await handler.resetForNewView();
    assert.deepEqual(order, ['cancel', 'discard']);
  });
});
