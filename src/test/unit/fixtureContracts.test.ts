import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { malformedProtocolFixtures, queuedStartupFixture, staleResponseFixture } from '../fixtures/protocolFixtures';
import { regressionFixtures } from '../fixtures/regressionFixtures';
import { expectedRedactedFixture, fixtureSecret, secretStorageFixture } from '../fixtures/securityFixtures';
import { corruptStorageDocument, legacyStorageFixture } from '../fixtures/storageFixtures';

describe('future-remediation fixture contracts', () => {
  test('keeps every required regression area represented by a unique fixture', () => {
    const ids = regressionFixtures.map(fixture => fixture.id);
    assert.equal(new Set(ids).size, ids.length);

    const required = [
      'transport-methods',
      'transport-bodies',
      'transport-redirects',
      'transport-compression',
      'transport-limits',
      'transport-timing',
      'transport-timeout',
      'transport-cancellation',
      'variables-precedence-cycles',
      'storage-corruption',
      'storage-migration',
      'storage-concurrency',
      'collection-roundtrip',
      'curl-import',
      'code-generation',
      'protocol-validation',
      'protocol-errors',
      'secret-storage',
      'redaction',
      'stale-responses',
      'webview-resilience',
      'extension-activation',
      'command-startup-queue',
      'webview-lifecycle',
    ];

    assert.deepEqual([...ids].sort(), [...required].sort());
    assert.ok(regressionFixtures.every(fixture => fixture.purpose.length > 10));
  });

  test('provides malformed, stale, startup, migration, and corruption inputs', () => {
    assert.ok(malformedProtocolFixtures.length >= 5);
    assert.notEqual(staleResponseFixture.activeExecutionId, staleResponseFixture.staleExecutionId);
    assert.equal(queuedStartupFixture.expectedDeliveryCountAfterReady, 1);
    assert.deepEqual(legacyStorageFixture, { collections: [], requests: [] });
    assert.throws(() => JSON.parse(corruptStorageDocument));
  });

  test('uses unmistakably synthetic secrets and an explicit redacted value', () => {
    assert.match(fixtureSecret, /^\$\{FIXTURE_/);
    assert.equal(secretStorageFixture.value, fixtureSecret);
    assert.equal(expectedRedactedFixture.value, '<redacted>');
  });
});
