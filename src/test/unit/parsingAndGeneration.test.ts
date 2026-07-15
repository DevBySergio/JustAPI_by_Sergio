import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CodeGenerator } from '../../commands/CodeGenerator';
import { CurlParseError, CurlParser } from '../../engine/http/CurlParser';
import { normalizeEffectiveRequest } from '../../engine/http/EffectiveRequest';
import { curlImportFixtures } from '../fixtures/curlFixtures';
import { createRequestFixture } from '../fixtures/requestFixtures';

describe('cURL parsing and code generation boundaries', () => {
  test('rejects non-cURL input', () => {
    assert.throws(
      () => new CurlParser().parse('GET https://fixture.test'),
      (error: unknown) => error instanceof CurlParseError && error.code === 'NOT_CURL_COMMAND'
    );
    assert.throws(
      () => new CurlParser().parse('curling https://fixture.test'),
      (error: unknown) => error instanceof CurlParseError && error.code === 'NOT_CURL_COMMAND'
    );
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
    assert.equal(request.url, 'https://fixture.test/items');
  });

  test('parses browser and Postman generated fixtures with line continuations', () => {
    const parser = new CurlParser();
    for (const fixture of curlImportFixtures) {
      const { request, warnings } = parser.parseWithWarnings(fixture.command);
      assert.equal(request.method, fixture.expected.method, fixture.id);
      assert.equal(request.url, fixture.expected.url, fixture.id);
      assert.equal(request.body.type, fixture.expected.bodyType, fixture.id);
      assert.equal(request.body.content, fixture.expected.bodyContent, fixture.id);
      assert.deepEqual(
        request.headers.map(({ key, value }) => ({ key, value })),
        fixture.expected.headers,
        fixture.id
      );
      assert.equal(request.settings.followRedirects, fixture.expected.followRedirects, fixture.id);
      assert.deepEqual(warnings, [], fixture.id);
    }
  });

  test('handles shell quoting, escapes, whitespace, and attached option values without execution', () => {
    const { request, warnings } = new CurlParser().parseWithWarnings(
      'curl\t-kL -XPOST -H"X-Quote: a\\\"b" --url="https://fixture.test/a b" '
      + '--data-raw="$(printf ignored)"'
    );

    assert.equal(request.method, 'POST');
    assert.equal(request.url, 'https://fixture.test/a b');
    assert.equal(request.settings.verifySSL, false);
    assert.deepEqual(request.headers.map(({ key, value }) => ({ key, value })), [
      { key: 'X-Quote', value: 'a"b' },
    ]);
    assert.equal(request.body.content, '$(printf ignored)');
    assert.ok(warnings.some(warning => warning.code === 'SHELL_SYNTAX_LITERAL'));
  });

  test('joins repeated data values and gives an explicit method precedence over body inference', () => {
    const { request, warnings } = new CurlParser().parseWithWarnings(
      "curl --request GET --data a=1 --data-urlencode 'b=two words' https://fixture.test/search"
    );

    assert.equal(request.method, 'GET');
    assert.equal(request.body.content, 'a=1&b=two%20words');
    assert.equal(request.body.type, 'text');
    assert.deepEqual(warnings, []);
  });

  test('uses the last body family and reports mixed data and multipart input', () => {
    const formLast = new CurlParser().parseWithWarnings(
      'curl -d a=1 -F name=value https://fixture.test/upload'
    );
    assert.equal(formLast.request.body.type, 'form-data');
    assert.deepEqual(
      formLast.request.body.formData?.map(({ key, value }) => ({ key, value })),
      [{ key: 'name', value: 'value' }]
    );
    assert.ok(formLast.warnings.some(warning => warning.code === 'CONFLICTING_BODY_OPTIONS'));

    const dataLast = new CurlParser().parseWithWarnings(
      'curl -F name=value -d a=1 https://fixture.test/upload'
    );
    assert.equal(dataLast.request.body.type, 'text');
    assert.equal(dataLast.request.body.content, 'a=1');
  });

  test('preserves local file references without reading them and emits token warnings', () => {
    const result = new CurlParser().parseWithWarnings(
      'curl --data-binary @/definitely/not/read.json -F file=@/also/not/read.bin '
      + '-b @/cookies/not/read.txt https://fixture.test/upload'
    );

    assert.equal(result.request.body.type, 'form-data');
    assert.equal(result.request.body.formData?.[0].value, '@/also/not/read.bin');
    assert.equal(
      result.request.headers.find(header => header.key === 'Cookie')?.value,
      '@/cookies/not/read.txt'
    );
    assert.equal(result.warnings.filter(warning => warning.code === 'LOCAL_FILE_REFERENCE').length, 3);
    assert.ok(result.warnings
      .filter(warning => warning.code === 'LOCAL_FILE_REFERENCE')
      .every(warning => warning.token.startsWith('-')));
  });

  test('reports unsupported, missing-value, ambiguous, and dangerous options structurally', () => {
    const result = new CurlParser().parseWithWarnings(
      'curl --connect-timeout 2 --mystery value -H -K./curlrc https://fixture.test'
    );

    assert.equal(result.request.url, 'https://fixture.test');
    assert.ok(result.warnings.some(warning => warning.code === 'UNSUPPORTED_OPTION'
      && warning.token === '--connect-timeout'));
    assert.ok(result.warnings.some(warning => warning.code === 'AMBIGUOUS_OPTION'
      && warning.token === '--mystery'));
    assert.ok(result.warnings.some(warning => warning.code === 'MISSING_OPTION_VALUE'
      && warning.token === '-H'));
    assert.ok(result.warnings.some(warning => warning.code === 'DANGEROUS_OPTION'
      && warning.token === '-K'));
  });

  test('normalizes URL, cookie, auth, TLS, and header precedence deterministically', () => {
    const basicLast = new CurlParser().parseWithWarnings(
      "curl -H 'Authorization: Bearer old' -u user:pass -b a=1 -b b=2 "
      + "-H 'Cookie: header=old' -k --url https://fixture.test/final https://fixture.test/ignored"
    );
    assert.equal(basicLast.request.url, 'https://fixture.test/final');
    assert.equal(basicLast.request.settings.verifySSL, false);
    assert.equal(
      basicLast.request.headers.find(header => header.key === 'Authorization')?.value,
      'Basic dXNlcjpwYXNz'
    );
    assert.equal(
      basicLast.request.headers.find(header => header.key === 'Cookie')?.value,
      'header=old'
    );
    assert.ok(basicLast.warnings.some(warning => warning.code === 'MULTIPLE_URLS'));

    const explicitHeadersLast = new CurlParser().parseWithWarnings(
      "curl -u user:pass -b a=1 -H 'Authorization: Bearer final' "
      + "-H 'Cookie: header=final' https://fixture.test"
    );
    assert.equal(
      explicitHeadersLast.request.headers.find(header => header.key === 'Authorization')?.value,
      'Bearer final'
    );
    assert.equal(
      explicitHeadersLast.request.headers.find(header => header.key === 'Cookie')?.value,
      'header=final'
    );
  });

  test('rejects malformed quoting and falls back safely for an unsupported method', () => {
    assert.throws(
      () => new CurlParser().parse("curl 'https://fixture.test"),
      (error: unknown) => error instanceof CurlParseError && error.code === 'MALFORMED_QUOTING'
    );

    const result = new CurlParser().parseWithWarnings(
      'curl -X TRACE -d fixture https://fixture.test'
    );
    assert.equal(result.request.method, 'POST');
    assert.ok(result.warnings.some(warning => warning.code === 'MALFORMED_VALUE'));
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

  test('round-trips a normalized request through generated cURL', () => {
    const source = createRequestFixture({
      method: 'PATCH',
      url: 'https://fixture.test/round-trip',
      headers: [{ id: 'round-trip-header', key: 'X-Fixture', value: "O'Reilly", enabled: true }],
      body: { type: 'json', content: '{"name":"O\'Reilly"}' },
      settings: {
        ...createRequestFixture().settings,
        verifySSL: false,
      },
    });

    const generated = new CodeGenerator().generate(source, 'curl');
    const { request, warnings } = new CurlParser().parseWithWarnings(generated);

    assert.equal(request.method, source.method);
    assert.equal(request.url, source.url);
    const effective = normalizeEffectiveRequest(source);
    assert.deepEqual(
      request.headers.map(({ key, value }) => ({ key, value })),
      effective.headers.map(({ name: key, value }) => ({ key, value }))
    );
    assert.deepEqual(request.body, source.body);
    assert.equal(request.settings.verifySSL, false);
    assert.deepEqual(warnings, []);
  });

  test('returns a stable message for unsupported languages', () => {
    const code = new CodeGenerator().generate(createRequestFixture(), 'fixture-language');
    assert.equal(code, '// Unsupported language: fixture-language');
  });
});
