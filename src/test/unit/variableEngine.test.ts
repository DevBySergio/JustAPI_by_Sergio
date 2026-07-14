import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { VariableEngine, ResolutionContext } from '../../engine/variables/VariableEngine';

const emptyContext: ResolutionContext = {
  requestVars: [],
  collectionVars: [],
  setsVars: [],
  globalVars: [],
};

describe('VariableEngine', () => {
  test('resolves enabled variables and explicit extra values', () => {
    const engine = new VariableEngine();
    const context: ResolutionContext = {
      ...emptyContext,
      requestVars: [{ id: 'request-var', key: 'host', value: 'api.fixture.test', enabled: true, scope: 'request' }],
      globalVars: [{ id: 'disabled-var', key: 'disabled', value: 'hidden', enabled: false, scope: 'global' }],
    };

    const result = engine.resolve('https://{{host}}/{{path}}/{{disabled}}', context, { path: 'items' });

    assert.equal(result, 'https://api.fixture.test/items/{{disabled}}');
  });

  test('extracts placeholders and reports only unavailable user variables', () => {
    const engine = new VariableEngine();
    const context: ResolutionContext = {
      ...emptyContext,
      globalVars: [{ id: 'known-var', key: 'known', value: 'value', enabled: true, scope: 'global' }],
    };

    assert.deepEqual(engine.extractVariables('{{known}}/{{ missing }}/{{$timestamp}}'), ['known', 'missing', '$timestamp']);
    assert.deepEqual(engine.findUnresolved('{{known}}/{{missing}}/{{$timestamp}}', context), ['missing']);
  });

  test('deduplicates completion keys across scopes', () => {
    const engine = new VariableEngine();
    const variable = { id: 'one', key: 'shared', value: 'value', enabled: true, scope: 'request' } as const;
    const context: ResolutionContext = {
      requestVars: [variable],
      collectionVars: [{ ...variable, id: 'two', scope: 'collection' }],
      setsVars: [],
      globalVars: [{ ...variable, id: 'three', key: 'global', scope: 'global' }],
    };

    assert.deepEqual(engine.getCompletions(context), ['shared', 'global']);
  });
});
