import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CodeGenerator } from '../../commands/CodeGenerator';
import { CurlParser } from '../../engine/http/CurlParser';
import { createRequestFixture } from '../fixtures/requestFixtures';

describe('cURL parsing and code generation boundaries', () => {
  test('rejects non-cURL input', () => {
    assert.throws(() => new CurlParser().parse('GET https://fixture.test'), /Not a valid cURL command/);
  });

  test('parses method, header, and JSON body options', () => {
    const request = new CurlParser().parse(
      `curl -X POST -H 'Content-Type: application/json' -d '{"fixture":true}' https://fixture.test/items`
    );

    assert.equal(request.method, 'POST');
    assert.deepEqual(request.headers.map(({ key, value }) => ({ key, value })), [
      { key: 'Content-Type', value: 'application/json' },
    ]);
    assert.equal(request.body.type, 'json');
    assert.equal(request.body.content, '{"fixture":true}');
  });

  test('generates a cURL command from an explicit request fixture', () => {
    const request = createRequestFixture({
      method: 'PATCH',
      url: 'https://fixture.test/items/1',
      headers: [{ id: 'header', key: 'X-Fixture', value: 'enabled', enabled: true }],
      body: { type: 'json', content: '{"name":"fixture"}' },
    });

    const code = new CodeGenerator().generate(request, 'curl');

    assert.match(code, /^curl \\\n  -X PATCH/);
    assert.match(code, /X-Fixture: enabled/);
    assert.match(code, /fixture\.test\/items\/1/);
  });

  test('returns a stable message for unsupported languages', () => {
    const code = new CodeGenerator().generate(createRequestFixture(), 'fixture-language');
    assert.equal(code, '// Unsupported language: fixture-language');
  });
});
