import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { redactRecognizedCredentials } from '../../engine/auth/CredentialRedaction';
import { redactHistoryUrl } from '../../storage/HistorySummary';
import { sanitizeRequestForWebviewState } from '../../webview/WebviewState';
import { createRequestFixture } from '../fixtures/requestFixtures';

describe('URL credential redaction before a URL is executable', () => {
  test('removes user information from incomplete and templated authorities in every local derivative', () => {
    for (const url of [
      'https://reader:synthetic-secret@',
      'https://reader:synthetic-secret@[::1',
      'https://reader:synthetic-secret@example.test:invalid/path',
      '{{scheme}}://reader:synthetic-secret@{{host}}/path',
      ' {{scheme}}://reader:synthetic-secret@{{host}}/path',
      'https:reader:synthetic-secret@',
      '//reader:synthetic-secret@{{host}}/path',
      'https://reader:synthetic-secret@extra@example.test:invalid/path',
    ]) {
      const request = createRequestFixture({ url });
      const exported = redactRecognizedCredentials(request);
      const cached = sanitizeRequestForWebviewState(request);
      const history = redactHistoryUrl(url);
      for (const value of [exported.url, cached.request.url, history]) {
        assert.doesNotMatch(value, /synthetic-secret|reader/);
      }
      assert.equal(cached.redacted, true);
      assert.equal(exported.headers.find(header => header.key === 'Authorization')?.value, 'Basic <BASIC_CREDENTIALS>');
      assert.equal(request.url, url);
    }
  });

  test('redacts recognized query credentials on templated and incomplete URLs without discarding safe values', () => {
    const request = createRequestFixture({
      url: '{{scheme}}://{{host}}/items?custom=&custom=synthetic-key&token=&token=synthetic-token&page=2#part',
      auth: { type: 'apiKey', name: 'custom', in: 'query', configured: true },
    });
    const exported = redactRecognizedCredentials(request);
    assert.doesNotMatch(exported.url, /synthetic-key/);
    assert.match(exported.url, /page=2#part$/);
    const cached = sanitizeRequestForWebviewState(request);
    assert.doesNotMatch(cached.request.url, /synthetic-key|synthetic-token/);
    assert.match(cached.request.url, /page=2#part$/);
    assert.equal(cached.redacted, true);
    const history = redactHistoryUrl(request.url);
    assert.doesNotMatch(history, /synthetic-key|synthetic-token|#part/);
  });

  test('preserves safe URL spelling and at signs outside the authority', () => {
    for (const url of ['https://example.test', 'https://@example.test', '{{scheme}}://{{host}}/reader@example.test?q=a%20b', '/reader@example.test',
      'https://example.test/path?visible=yes#reader@example.test']) {
      const request = createRequestFixture({ url });
      assert.equal(redactRecognizedCredentials(request).url, url);
      const cached = sanitizeRequestForWebviewState(request);
      assert.equal(cached.request.url, url);
      assert.equal(cached.redacted, false);
    }
  });
});
