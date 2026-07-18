import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDefaultCollection } from '../../models/Collection';
import type { HistoryEntry } from '../../models/HistoryEntry';
import { validateExtensionMessage } from '../../protocol/MessageValidator';
import {
  boundResponseText,
  decodedBase64Size,
  normalizeImageMimeType,
  validateImagePreview,
} from '../../webview/ResponsePresentation';
import { buildSearchResults } from '../../webview/SearchIndex';
import {
  createPersistedWebviewState,
  nextTabIndex,
  requestsDiffer,
  restorePersistedWebviewState,
  sanitizeRequestForWebviewState,
} from '../../webview/WebviewState';
import { createRequestFixture } from '../fixtures/requestFixtures';

describe('webview resilience', () => {
  test('persists navigation and editor state without credential-like values', () => {
    const request = createRequestFixture({
      id: 'request-webview-state',
      url: 'https://embedded-user:embedded-secret@example.test/items?token=url-secret&visible=yes',
      auth: { type: 'apiKey', name: 'X-Custom-Key', in: 'header', configured: true },
      headers: [
        { id: 'header-auth', key: 'Authorization', value: 'Bearer header-secret', enabled: true },
        { id: 'header-key', key: 'X-Custom-Key', value: 'api-key-secret', enabled: true },
        { id: 'header-safe', key: 'Accept', value: 'application/json', enabled: true },
      ],
      queryParams: [
        { id: 'query-token', key: 'access_token', value: 'query-secret', enabled: true },
        { id: 'query-safe', key: 'page', value: '2', enabled: true },
      ],
      body: {
        type: 'json',
        content: JSON.stringify({ username: 'reader', password: 'body-secret' }),
      },
    });

    const sanitized = sanitizeRequestForWebviewState(request);
    assert.equal(sanitized.redacted, true);
    assert.equal(sanitized.request.auth.type, 'apiKey');
    assert.equal(sanitized.request.headers.find(item => item.id === 'header-auth')?.value, '');
    assert.equal(sanitized.request.headers.find(item => item.id === 'header-key')?.value, '');
    assert.equal(sanitized.request.headers.find(item => item.id === 'header-safe')?.value, 'application/json');
    assert.equal(sanitized.request.queryParams.find(item => item.id === 'query-token')?.value, '');
    assert.match(sanitized.request.url, /^https:\/\/example\.test\/items\?/);
    assert.equal(JSON.parse(sanitized.request.body.content).password, '');

    const state = createPersistedWebviewState({
      activeTab: 'history',
      variableSubTab: 'sets',
      activeCollectionId: 'collection-webview',
      currentRequest: request,
      baselineRequest: request,
    });
    const serialized = JSON.stringify(state);
    for (const secret of ['embedded-secret', 'url-secret', 'header-secret', 'api-key-secret', 'query-secret', 'body-secret']) {
      assert.equal(serialized.includes(secret), false);
    }
    assert.deepEqual(restorePersistedWebviewState(state), state);
    assert.equal(restorePersistedWebviewState({ ...state, schemaVersion: 2 }), null);

    const oversized = sanitizeRequestForWebviewState(createRequestFixture({
      body: { type: 'text', content: 'x'.repeat(200_001) },
    }));
    assert.equal(oversized.redacted, true);
    assert.equal(oversized.request.body.content, '');
  });

  test('tracks dirty state independently of update timestamps and supports roving tabs', () => {
    const baseline = createRequestFixture({ id: 'request-dirty', url: 'https://example.test' });
    assert.equal(requestsDiffer({ ...baseline, updated: baseline.updated + 1 }, baseline), false);
    assert.equal(requestsDiffer({ ...baseline, method: 'POST' }, baseline), true);
    assert.equal(nextTabIndex(0, 'ArrowLeft', 5), 4);
    assert.equal(nextTabIndex(4, 'ArrowRight', 5), 0);
    assert.equal(nextTabIndex(3, 'Home', 5), 0);
    assert.equal(nextTabIndex(1, 'End', 5), 4);
    assert.equal(nextTabIndex(1, 'Enter', 5), null);
  });

  test('bounds text and accepts only exact base64 with safe raster image MIME types', () => {
    assert.deepEqual(boundResponseText('abcdef', 4), { text: 'abcd', omittedCharacters: 2 });
    assert.equal(normalizeImageMimeType('IMAGE/PNG; charset=binary'), 'image/png');
    assert.equal(normalizeImageMimeType('image/svg+xml'), null);
    assert.equal(decodedBase64Size('AQIDBA=='), 4);
    assert.equal(decodedBase64Size('not base64'), null);
    assert.deepEqual(validateImagePreview('image/png', 'AQIDBA=='), {
      ok: true,
      mimeType: 'image/png',
      byteLength: 4,
    });
    assert.equal(validateImagePreview('image/svg+xml', 'AQIDBA==').ok, false);
    assert.equal(validateImagePreview('image/png', 'corrupted').ok, false);
  });

  test('indexes exact saved request IDs and distinguishes replayable history results', () => {
    const collection = createDefaultCollection('Fixture collection');
    collection.id = 'collection-search';
    collection.items = [
      {
        type: 'request',
        id: 'item-reference-not-request-id',
        requestId: 'request-exact-id',
        name: 'List widgets',
      },
      {
        type: 'folder',
        id: 'folder-admin',
        name: 'Admin',
        items: [],
      },
    ];
    const request = createRequestFixture({
      id: 'request-exact-id',
      url: 'https://example.test/widgets',
    });
    const history: HistoryEntry[] = [
      {
        id: 'history-saved',
        timestamp: 1,
        duration: 2,
        statusCode: 200,
        url: 'https://example.test/widgets?{{redacted}}',
        method: 'GET',
        responseSize: 4,
        requestId: request.id,
        collectionId: collection.id,
      },
      {
        id: 'history-summary',
        timestamp: 2,
        duration: 3,
        statusCode: 204,
        url: 'https://history.test/summary',
        method: 'POST',
        responseSize: 0,
      },
    ];

    const byName = buildSearchResults([collection], id => id === request.id ? request : undefined, history, 'widgets');
    const savedRequest = byName.find(result => result.type === 'request');
    assert.equal(savedRequest?.id, 'request-exact-id');
    assert.equal(byName.filter(result => result.type === 'request').length, 1);

    const historyResult = buildSearchResults([collection], () => undefined, history, 'summary')[0];
    assert.equal(historyResult.type, 'history');
    assert.equal(historyResult.id, 'history-summary');
    assert.equal(historyResult.requestId, undefined);
    assert.equal(validateExtensionMessage({
      type: 'searchResults',
      operationId: 'operation-search-results',
      results: byName,
    }).ok, true);
  });
});
