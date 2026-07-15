import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDefaultCollection } from '../../models/Collection';
import type { ExtensionMessage } from '../../models/MessageProtocol';
import { OperationCorrelationTracker, isActiveExecution } from '../../protocol/CorrelationTracker';
import {
  PROTOCOL_LIMITS,
  protocolFailure,
  validateCollectionImportDocument,
  validateExtensionMessage,
  validateWebviewMessage,
} from '../../protocol/MessageValidator';
import { ExecutionRegistry, OperationRegistry } from '../../protocol/OperationRegistry';
import { malformedProtocolFixtures } from '../fixtures/protocolFixtures';
import { createRequestFixture } from '../fixtures/requestFixtures';

const operationId = 'operation-protocol-fixture';
const executionId = 'execution-protocol-fixture';

describe('webview protocol validation and correlation', () => {
  test('accepts a complete correlated execution and rejects malformed fixtures before dispatch', () => {
    const valid = validateWebviewMessage({
      type: 'executeRequest',
      operationId,
      executionId,
      request: createRequestFixture({ url: 'https://fixture.test' }),
    });
    assert.equal(valid.ok, true);

    for (const fixture of malformedProtocolFixtures) {
      assert.equal(validateWebviewMessage(fixture).ok, false);
    }
  });

  test('rejects unknown variants, invalid identifiers, enums, and bounded arrays', () => {
    const request = createRequestFixture({ url: 'https://fixture.test' });
    assert.deepEqual(validateWebviewMessage({ type: 'workspaceEnabled', operationId }), {
      ok: false,
      code: 'UNKNOWN_MESSAGE',
      message: 'The protocol message type is not supported.',
    });
    assert.equal(validateWebviewMessage({
      type: 'executeRequest',
      operationId: 'contains a space',
      executionId,
      request,
    }).ok, false);
    assert.equal(validateWebviewMessage({
      type: 'executeRequest',
      operationId,
      executionId,
      request: { ...request, method: 'TRACE' },
    }).ok, false);
    assert.equal(validateWebviewMessage({
      type: 'executeRequest',
      operationId,
      executionId,
      request: {
        ...request,
        headers: Array.from({ length: PROTOCOL_LIMITS.maximumHeaders + 1 }, (_, index) => ({
          id: `header-${index}`,
          key: 'X-Fixture',
          value: 'value',
          enabled: true,
        })),
      },
    }).ok, false);
  });

  test('enforces general size and depth limits while allowing staged imports up to their limit', () => {
    const largeValue = 'x'.repeat(PROTOCOL_LIMITS.generalMessageBytes + 1);
    const oversized = validateWebviewMessage({
      type: 'importCurl',
      operationId,
      curlString: largeValue,
    });
    assert.equal(oversized.ok, false);
    if (!oversized.ok) {
      assert.equal(oversized.code, 'MESSAGE_TOO_LARGE');
    }

    assert.equal(validateWebviewMessage({
      type: 'importCollection',
      operationId,
      json: largeValue,
    }).ok, true);

    let deeplyNested: Record<string, unknown> = {};
    for (let depth = 0; depth < PROTOCOL_LIMITS.maximumDepth + 1; depth += 1) {
      deeplyNested = { nested: deeplyNested };
    }
    assert.equal(validateWebviewMessage({
      type: 'setSettings',
      operationId,
      settings: deeplyNested,
    }).ok, false);
  });

  test('validates the complete import document before returning staged data', () => {
    const collection = createDefaultCollection('Fixture collection');
    const request = createRequestFixture({ url: 'https://fixture.test/import' });
    const valid = validateCollectionImportDocument(JSON.stringify({ collection, requests: [request] }));
    assert.equal(valid.ok, true);

    const invalid = validateCollectionImportDocument(JSON.stringify({
      collection,
      requests: [{ ...request, method: 'TRACE' }],
    }));
    assert.equal(invalid.ok, false);
    if (!invalid.ok) {
      assert.equal(invalid.code, 'IMPORT_ERROR');
    }
  });

  test('requires outbound response correlation and exposes only stable error text', () => {
    const response: ExtensionMessage = {
      type: 'response',
      operationId,
      executionId,
      response: {
        statusCode: 200,
        statusText: 'OK',
        httpVersion: 'HTTP/1.1',
        headers: {},
        body: '{}',
        bodyType: 'json',
        size: 2,
        duration: 1,
        cookies: [],
        redirected: false,
        finalUrl: undefined,
      },
    };
    assert.equal(validateExtensionMessage(response).ok, true);
    assert.equal(validateExtensionMessage({
      type: 'response',
      operationId,
      response: response.response,
    }).ok, false);

    const failure = protocolFailure('OPERATION_FAILED');
    assert.equal(failure.message, 'The requested operation could not be completed.');
    assert.doesNotMatch(failure.message, /authorization|fixture-secret|token=/i);
  });

  test('blocks duplicate operations and cancels exactly one registered execution', () => {
    const operations = new OperationRegistry();
    assert.equal(operations.claim(operationId), true);
    assert.equal(operations.claim(operationId), false);

    let firstCancelled = 0;
    let secondCancelled = 0;
    const executions = new ExecutionRegistry();
    assert.ok(executions.register(operationId, 'execution-first', {
      cancel: () => { firstCancelled += 1; },
    }));
    assert.ok(executions.register('operation-second', 'execution-second', {
      cancel: () => { secondCancelled += 1; },
    }));

    assert.equal(executions.cancel('execution-first')?.cancelled, true);
    assert.equal(firstCancelled, 1);
    assert.equal(secondCancelled, 0);
    assert.equal(executions.get('execution-second')?.cancelled, false);
    executions.complete('execution-first');
    assert.equal(executions.register('operation-retry', 'execution-first', { cancel: () => {} }), null);
  });

  test('suppresses superseded operations and stale execution results', () => {
    const tracker = new OperationCorrelationTracker();
    tracker.record('search', 'operation-search-old');
    tracker.record('search', 'operation-search-new');
    assert.equal(tracker.isCurrent('operation-search-old'), false);
    assert.equal(tracker.isCurrent('operation-search-new'), true);

    tracker.record('getHistory', 'operation-history-read');
    tracker.record('clearHistory', 'operation-history-clear');
    assert.equal(tracker.isCurrent('operation-history-read'), false);
    assert.equal(tracker.isCurrent('operation-history-clear'), true);

    assert.equal(isActiveExecution('execution-current', 'execution-previous'), false);
    assert.equal(isActiveExecution('execution-current', 'execution-current'), true);
  });
});
