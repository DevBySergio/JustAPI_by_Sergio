import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { VariableEngine, ResolutionContext } from '../../engine/variables/VariableEngine';
import { JustRequest } from '../../models/Request';
import { Variable, VariableScope } from '../../models/Variable';

const emptyContext: ResolutionContext = {
  requestVars: [],
  collectionVars: [],
  setsVars: [],
  globalVars: [],
};

function variable(
  id: string,
  key: string,
  value: string,
  enabled = true,
  scope: VariableScope = 'global'
): Variable {
  return { id, key, value, enabled, scope };
}

function request(overrides: Partial<JustRequest> = {}): JustRequest {
  return {
    id: 'request-id',
    name: 'Fixture',
    method: 'POST',
    url: 'https://example.test',
    headers: [],
    queryParams: [],
    auth: { type: 'none' },
    pathParams: [],
    body: { type: 'none', content: '' },
    settings: { timeout: 30_000, followRedirects: true, verifySSL: true },
    variables: [],
    created: 1,
    updated: 1,
    ...overrides,
  };
}

describe('VariableEngine', () => {
  test('applies global, set, collection, request, and explicit precedence deterministically', () => {
    const engine = new VariableEngine();
    const context: ResolutionContext = {
      globalVars: [variable('global', 'shared', 'global')],
      setsVars: [variable('set', 'shared', 'set')],
      collectionVars: [variable('collection', 'shared', 'collection', true, 'collection')],
      requestVars: [variable('request', 'shared', 'request', true, 'request')],
    };

    assert.equal(engine.resolve('{{shared}}', context), 'request');
    assert.equal(engine.resolve('{{shared}}', context, { shared: 'explicit' }), 'explicit');
  });

  test('chooses same-scope duplicates by stable ID and reports the ambiguity', () => {
    const engine = new VariableEngine();
    const result = engine.resolveDetailed('{{duplicate}}', {
      ...emptyContext,
      setsVars: [
        variable('z-variable', 'duplicate', 'second'),
        variable('a-variable', 'duplicate', 'first'),
      ],
    });

    assert.equal(result.value, 'first');
    assert.deepEqual(result.diagnostics, [{
      code: 'DUPLICATE_VARIABLE',
      variable: 'duplicate',
      location: 'value',
    }]);
  });

  test('does not let disabled higher-precedence values shadow enabled lower values', () => {
    const engine = new VariableEngine();
    const context: ResolutionContext = {
      ...emptyContext,
      globalVars: [variable('global', 'host', 'enabled.example')],
      requestVars: [variable('request', 'host', 'disabled.example', false, 'request')],
    };

    assert.deepEqual(engine.resolveDetailed('{{host}}', context), {
      value: 'enabled.example',
      diagnostics: [],
    });
    assert.deepEqual(engine.resolveDetailed('{{onlyDisabled}}', {
      ...emptyContext,
      requestVars: [variable('disabled', 'onlyDisabled', 'secret', false, 'request')],
    }).diagnostics, [{
      code: 'DISABLED_VARIABLE',
      variable: 'onlyDisabled',
      location: 'value',
    }]);
  });

  test('preserves empty and zero-like values instead of treating them as absent', () => {
    const engine = new VariableEngine();
    const context = {
      ...emptyContext,
      globalVars: [
        variable('empty', 'empty', ''),
        variable('zero', 'zero', '0'),
      ],
    };

    assert.equal(engine.resolve('a{{empty}}b/{{zero}}', context), 'ab/0');
  });

  test('resolves nested variables and detects direct and indirect cycles with paths', () => {
    const engine = new VariableEngine();
    const nested = {
      ...emptyContext,
      globalVars: [
        variable('origin', 'origin', 'https://{{host}}'),
        variable('host', 'host', '{{subdomain}}.example.test'),
        variable('subdomain', 'subdomain', 'api'),
      ],
    };
    assert.equal(engine.resolve('{{origin}}/items', nested), 'https://api.example.test/items');

    const direct = engine.resolveDetailed('{{self}}', {
      ...emptyContext,
      globalVars: [variable('self', 'self', '{{self}}')],
    });
    assert.equal(direct.value, '{{self}}');
    assert.deepEqual(direct.diagnostics[0].path, ['self', 'self']);

    const indirect = engine.resolveDetailed('{{a}}', {
      ...emptyContext,
      globalVars: [
        variable('a', 'a', '{{b}}'),
        variable('b', 'b', '{{c}}'),
        variable('c', 'c', '{{a}}'),
      ],
    });
    assert.equal(indirect.diagnostics[0].code, 'CYCLIC_VARIABLE');
    assert.deepEqual(indirect.diagnostics[0].path, ['a', 'b', 'c', 'a']);
  });

  test('bounds nesting depth, input length, and expanded output length', () => {
    const depthEngine = new VariableEngine({ maximumDepth: 2 });
    const depthResult = depthEngine.resolveDetailed('{{a}}', {
      ...emptyContext,
      globalVars: [
        variable('a', 'a', '{{b}}'),
        variable('b', 'b', '{{c}}'),
        variable('c', 'c', 'done'),
      ],
    });
    assert.equal(depthResult.diagnostics[0].code, 'MAX_DEPTH_EXCEEDED');
    assert.deepEqual(depthResult.diagnostics[0].path, ['a', 'b', 'c']);

    const inputResult = new VariableEngine({
      maximumInputLength: 4,
      maximumOutputLength: 4,
    }).resolveDetailed('12345', emptyContext);
    assert.equal(inputResult.value, '1234');
    assert.equal(inputResult.diagnostics[0].code, 'INPUT_LIMIT_EXCEEDED');

    const outputResult = new VariableEngine({ maximumOutputLength: 4 }).resolveDetailed('{{long}}', {
      ...emptyContext,
      globalVars: [variable('long', 'long', '12345')],
    });
    assert.equal(outputResult.value, '1234');
    assert.equal(outputResult.diagnostics[0].code, 'OUTPUT_LIMIT_EXCEEDED');
  });

  test('treats escaped braces as literals and diagnoses malformed templates and names', () => {
    const engine = new VariableEngine();
    const context = {
      ...emptyContext,
      globalVars: [variable('host', 'host', 'api.example.test')],
    };

    assert.deepEqual(engine.resolveDetailed(String.raw`\{{host}}/{{host}}`, context), {
      value: '{{host}}/api.example.test',
      diagnostics: [],
    });
    assert.equal(engine.resolveDetailed('{{bad name}}', context).diagnostics[0].code, 'INVALID_VARIABLE');
    assert.equal(engine.resolveDetailed('before {{host', context).diagnostics[0].code, 'INVALID_TEMPLATE');
  });

  test('resolves URL, query, headers, path params, raw body, form fields, and API key name', () => {
    const engine = new VariableEngine();
    const context = {
      ...emptyContext,
      requestVars: [
        variable('host', 'host', 'api.example.test', true, 'request'),
        variable('key', 'key', 'X-Tenant', true, 'request'),
        variable('tenant', 'tenant', 'acme', true, 'request'),
        variable('payload', 'payload', 'hello', true, 'request'),
      ],
    };
    const source = request({
      url: 'https://{{host}}/:tenant',
      headers: [
        { id: 'header', key: '{{key}}', value: '{{tenant}}', enabled: true },
        { id: 'disabled-header', key: '{{missing}}', value: '{{missing}}', enabled: false },
      ],
      queryParams: [{ id: 'query', key: '{{tenant}}', value: '{{payload}}', enabled: true }],
      pathParams: [{ id: 'path', name: '{{tenant}}', value: '{{payload}}' }],
      auth: { type: 'apiKey', name: '{{key}}', in: 'header', configured: true },
      body: {
        type: 'form-data',
        content: '{{payload}}',
        formData: [
          { id: 'form', key: '{{tenant}}', value: '{{payload}}', enabled: true },
          { id: 'disabled-form', key: '{{missing}}', value: '{{missing}}', enabled: false },
        ],
      },
    });

    const result = engine.resolveRequest(source, context);
    assert.equal(result.ok, true);
    assert.equal(result.request.url, 'https://api.example.test/:tenant');
    assert.deepEqual(result.request.headers[0], {
      id: 'header', key: 'X-Tenant', value: 'acme', enabled: true,
    });
    assert.equal(result.request.headers[1].key, '{{missing}}');
    assert.deepEqual(result.request.queryParams[0], {
      id: 'query', key: 'acme', value: 'hello', enabled: true,
    });
    assert.deepEqual(result.request.pathParams[0], { id: 'path', name: 'acme', value: 'hello' });
    assert.equal(result.request.body.content, 'hello');
    assert.deepEqual(result.request.body.formData?.[0], {
      id: 'form', key: 'acme', value: 'hello', enabled: true,
    });
    assert.equal(result.request.body.formData?.[1].key, '{{missing}}');
    assert.deepEqual(result.request.auth, {
      type: 'apiKey', name: 'X-Tenant', in: 'header', configured: true,
    });
    assert.equal(source.url, 'https://{{host}}/:tenant', 'preflight must not mutate the editor request');

    const raw = engine.resolveRequest(request({
      body: { type: 'json', content: '{"message":"{{payload}}"}' },
    }), context);
    assert.equal(raw.request.body.content, '{"message":"hello"}');
  });

  test('leaves encoding to the transport boundary and never double-encodes values', () => {
    const engine = new VariableEngine();
    const context = {
      ...emptyContext,
      globalVars: [
        variable('encoded', 'encoded', 'already%20encoded'),
        variable('raw', 'raw', 'a b&c/ü'),
      ],
    };
    const result = engine.resolveRequest(request({
      url: 'https://example.test/{{encoded}}/{{raw}}',
      queryParams: [{ id: 'query', key: '{{raw}}', value: '{{encoded}}', enabled: true }],
      body: { type: 'text', content: '{{raw}}' },
    }), context);

    assert.equal(result.request.url, 'https://example.test/already%20encoded/a b&c/ü');
    assert.deepEqual(result.request.queryParams[0], {
      id: 'query', key: 'a b&c/ü', value: 'already%20encoded', enabled: true,
    });
    assert.equal(result.request.body.content, 'a b&c/ü');
  });

  test('returns structured secret-safe diagnostics and a blocking preflight result', () => {
    const engine = new VariableEngine();
    const source = request({ url: 'https://{{missing}}/{{duplicate}}' });
    const result = engine.resolveRequest(source, {
      ...emptyContext,
      globalVars: [
        variable('z', 'duplicate', 'do-not-leak-second'),
        variable('a', 'duplicate', 'do-not-leak-first'),
      ],
    });
    let transportCalls = 0;
    if (result.ok) {
      transportCalls += 1;
    }

    assert.equal(result.ok, false);
    assert.equal(transportCalls, 0);
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), [
      'MISSING_VARIABLE',
      'DUPLICATE_VARIABLE',
    ]);
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /do-not-leak/);
  });

  test('produces identical request and diagnostics for repeated preview and execution preflight', () => {
    const engine = new VariableEngine();
    const source = request({
      url: 'https://{{host}}/{{missing}}',
      headers: [{ id: 'header', key: 'X-Test', value: '{{host}}', enabled: true }],
    });
    const context = {
      ...emptyContext,
      globalVars: [variable('host', 'host', 'api.example.test')],
    };

    const preview = engine.resolveRequest(source, context);
    const execution = engine.resolveRequest(source, context);
    assert.deepEqual(preview, execution);
  });

  test('extracts placeholders and reports every unavailable variable', () => {
    const engine = new VariableEngine();
    const context: ResolutionContext = {
      ...emptyContext,
      globalVars: [variable('known-var', 'known', 'value')],
    };

    assert.deepEqual(engine.extractVariables('{{known}}/{{ missing }}/{{$timestamp}}'), [
      'known',
      'missing',
      '$timestamp',
    ]);
    assert.deepEqual(engine.findUnresolved('{{known}}/{{missing}}/{{$timestamp}}', context), [
      'missing',
      '$timestamp',
    ]);
  });

  test('deduplicates completion keys across scopes in precedence order', () => {
    const engine = new VariableEngine();
    const context: ResolutionContext = {
      requestVars: [variable('one', 'shared', 'request', true, 'request')],
      collectionVars: [variable('two', 'shared', 'collection', true, 'collection')],
      setsVars: [],
      globalVars: [variable('three', 'global', 'global')],
    };

    assert.deepEqual(engine.getCompletions(context), ['shared', 'global']);
  });
});
