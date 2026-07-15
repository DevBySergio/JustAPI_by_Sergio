import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import * as ts from 'typescript';
import { CodeGenerator } from '../../commands/CodeGenerator';
import { normalizeEffectiveRequest } from '../../engine/http/EffectiveRequest';
import { ResolutionContext, VariableEngine } from '../../engine/variables/VariableEngine';
import type { CodeTargetLanguage } from '../../models/MessageProtocol';
import type { JustRequest } from '../../models/Request';
import {
  codeGenerationBodyFixtures,
  codeGenerationGoldenHashes,
  codeGenerationGoldenRequest,
  codeGenerationMethods,
  codeTargetLanguages,
} from '../fixtures/codeGenerationFixtures';

const syntheticSecret = 'CODEGEN_SECRET_MUST_NOT_LEAK';

function requestWithBody(body: JustRequest['body']): JustRequest {
  return {
    ...codeGenerationGoldenRequest,
    body,
    headers: codeGenerationGoldenRequest.headers.map(header => ({ ...header })),
    queryParams: codeGenerationGoldenRequest.queryParams.map(parameter => ({ ...parameter })),
  };
}

function assertCommandParses(command: string, args: string[], input?: string): boolean {
  const result = spawnSync(command, args, { input, encoding: 'utf8' });
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
  if (errorCode === 'ENOENT') {
    return false;
  }
  assert.equal(
    result.status,
    0,
    `${command} rejected generated code:\n${result.stderr || result.stdout}`
  );
  return true;
}

function assertBalancedSource(source: string): void {
  const opening = new Map([['(', ')'], ['[', ']'], ['{', '}']]);
  const closing = new Set(opening.values());
  const stack: string[] = [];
  let quote: '"' | "'" | '`' | undefined;
  let escaped = false;
  let lineComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    const expected = opening.get(character);
    if (expected) {
      stack.push(expected);
    } else if (closing.has(character)) {
      assert.equal(character, stack.pop(), `Unbalanced ${character} in generated source.`);
    }
  }
  assert.equal(quote, undefined, 'Generated source contains an unclosed string literal.');
  assert.deepEqual(stack, [], 'Generated source contains unclosed delimiters.');
}

function assertTargetParses(language: CodeTargetLanguage, source: string): void {
  switch (language) {
    case 'javascript':
      assert.doesNotThrow(() => new Function(source));
      return;
    case 'typescript': {
      const result = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        reportDiagnostics: true,
      });
      const errors = result.diagnostics?.filter(
        diagnostic => diagnostic.category === ts.DiagnosticCategory.Error
      ) ?? [];
      assert.deepEqual(errors, []);
      return;
    }
    case 'python':
      assert.equal(assertCommandParses(
        'python3',
        ['-c', 'import sys; compile(sys.stdin.read(), "<justapi>", "exec")'],
        source
      ), true, 'Python 3 is required by the code-generation parser fixture.');
      return;
    case 'curl':
      assert.equal(
        assertCommandParses('bash', ['-n'], source),
        true,
        'Bash is required by the cURL parser fixture.'
      );
      return;
    case 'java': {
      const directory = mkdtempSync(join(tmpdir(), 'justapi-java-'));
      try {
        const sourceFile = join(directory, 'ApiRequest.java');
        writeFileSync(sourceFile, source, 'utf8');
        assert.equal(
          assertCommandParses('javac', ['-encoding', 'UTF-8', '-d', directory, sourceFile]),
          true,
          'javac is required by the Java code-generation fixture.'
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
      return;
    }
    case 'go': {
      assertBalancedSource(source);
      const directory = mkdtempSync(join(tmpdir(), 'justapi-go-'));
      try {
        const sourceFile = join(directory, 'main.go');
        writeFileSync(sourceFile, source, 'utf8');
        assertCommandParses('go', ['build', '-o', join(directory, 'fixture'), sourceFile]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
      return;
    }
    case 'csharp': {
      assertBalancedSource(source);
      assert.doesNotMatch(source, /StringContent\('/);
      const directory = mkdtempSync(join(tmpdir(), 'justapi-csharp-'));
      try {
        const sourceFile = join(directory, 'ApiRequest.cs');
        writeFileSync(sourceFile, source, 'utf8');
        assertCommandParses('csc', ['/nologo', '/target:library', `/out:${join(directory, 'fixture.dll')}`, sourceFile]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }
}

describe('normalized code generation', () => {
  test('builds one effective request with final URL, headers, body fields, settings, and auth state', () => {
    const effective = normalizeEffectiveRequest(codeGenerationGoldenRequest, {
      credentialRepresentation: 'placeholder',
    });

    assert.equal(effective.method, 'PATCH');
    assert.match(effective.url, /^https:\/\/fixture\.test\/a%20path\?existing=first&search\+term=/);
    assert.equal(effective.url.includes('#ignored'), false);
    assert.deepEqual(effective.headers.map(header => header.name), [
      'x-duplicate',
      'Content-Type',
    ]);
    assert.equal(effective.body.type, 'json');
    assert.equal(effective.settings.followRedirects, false);
    assert.equal(effective.settings.verifySSL, false);
    assert.deepEqual(effective.auth, { type: 'bearer', representation: 'placeholder' });

    const form = normalizeEffectiveRequest(requestWithBody(
      codeGenerationBodyFixtures.find(fixture => fixture.id === 'form-data')!.body
    ));
    assert.equal(form.body.type, 'form-data');
    assert.deepEqual(form.body.fields.map(field => field.name), ['message', 'literal-file-value']);
    assert.equal(form.headers.some(header => header.name.toLowerCase() === 'content-type'), false);
  });

  test('matches stable golden output for every target', () => {
    const generator = new CodeGenerator();
    for (const language of codeTargetLanguages) {
      const source = generator.generate(codeGenerationGoldenRequest, language);
      const digest = createHash('sha256').update(source).digest('hex');
      assert.equal(digest, codeGenerationGoldenHashes[language], language);
    }
  });

  test('renders every supported method in every target', () => {
    const generator = new CodeGenerator();
    for (const method of codeGenerationMethods) {
      const request = { ...codeGenerationGoldenRequest, method, body: { type: 'none', content: '' } as const };
      for (const language of codeTargetLanguages) {
        const source = generator.generate(request, language);
        const marker = language === 'curl' ? `-X ${method}` : `"${method}"`;
        assert.ok(source.includes(marker), `${language}/${method}`);
      }
    }
  });

  test('renders every body mode in every target without disabled or invented file input', () => {
    const bodyMarkers: Record<CodeTargetLanguage, Record<'form-data' | 'x-www-form-urlencoded', string>> = {
      javascript: { 'form-data': 'new FormData()', 'x-www-form-urlencoded': 'new URLSearchParams()' },
      typescript: { 'form-data': 'new FormData()', 'x-www-form-urlencoded': 'new URLSearchParams()' },
      python: { 'form-data': 'files = [', 'x-www-form-urlencoded': 'data = [' },
      curl: { 'form-data': '--form-string', 'x-www-form-urlencoded': '--data-raw' },
      csharp: { 'form-data': 'new MultipartFormDataContent()', 'x-www-form-urlencoded': 'new FormUrlEncodedContent' },
      java: { 'form-data': 'multipart/form-data; boundary=', 'x-www-form-urlencoded': 'application/x-www-form-urlencoded' },
      go: { 'form-data': 'multipart.NewWriter', 'x-www-form-urlencoded': 'application/x-www-form-urlencoded' },
    };
    const generator = new CodeGenerator();
    for (const fixture of codeGenerationBodyFixtures) {
      for (const language of codeTargetLanguages) {
        const source = generator.generate(requestWithBody(fixture.body), language);
        assert.equal(source.includes('not-rendered'), false, `${language}/${fixture.id}`);
        assert.equal(source.includes('ignored-editor-content'), false, `${language}/${fixture.id}`);
        if (fixture.id === 'form-data' || fixture.id === 'x-www-form-urlencoded') {
          assert.ok(source.includes(bodyMarkers[language][fixture.id]), `${language}/${fixture.id}`);
        }
        if (fixture.id === 'form-data' && language === 'curl') {
          assert.ok(source.includes("--form-string 'literal-file-value=@/not/a/file.bin'"));
        }
      }
    }
  });

  test('uses placeholders by default and includes a resolved credential only when explicitly requested', () => {
    const request: JustRequest = {
      ...codeGenerationGoldenRequest,
      auth: { type: 'none' },
      headers: [
        ...codeGenerationGoldenRequest.headers,
        { id: 'secret-header', key: 'Authorization', value: `Bearer ${syntheticSecret}`, enabled: true },
      ],
    };
    const generator = new CodeGenerator();

    for (const language of codeTargetLanguages) {
      const redacted = generator.generate(request, language);
      assert.equal(redacted.includes(syntheticSecret), false, language);
      assert.ok(redacted.includes('<REDACTED>'), language);

      const disclosed = generator.generate(request, language, {
        credentialRepresentation: 'resolved',
      });
      assert.ok(disclosed.includes(syntheticSecret), language);
    }
  });

  test('renders only variable-resolved values', () => {
    const source = requestWithBody({ type: 'text', content: '{{message}}' });
    source.url = 'https://fixture.test/{{segment}}';
    source.queryParams = [{ id: 'variable-query', key: 'q', value: '{{message}}', enabled: true }];
    source.headers = [{ id: 'variable-header', key: 'X-Value', value: '{{ascii}}', enabled: true }];
    const context: ResolutionContext = {
      requestVars: [
        { id: 'segment', key: 'segment', value: 'resolved path', enabled: true, scope: 'request' },
        { id: 'message', key: 'message', value: 'résolu 東京', enabled: true, scope: 'request' },
        { id: 'ascii', key: 'ascii', value: 'resolved-header', enabled: true, scope: 'request' },
      ],
      collectionVars: [],
      globalVars: [],
    };
    const resolved = new VariableEngine().resolveRequest(source, context);
    assert.equal(resolved.ok, true);

    for (const language of codeTargetLanguages) {
      const code = new CodeGenerator().generate(resolved.request, language);
      assert.equal(code.includes('{{'), false, language);
      assert.equal(code.includes('resolved-header'), true, language);
    }
  });

  test('passes an available parser or compiler check for every target and body mode', () => {
    const generator = new CodeGenerator();
    for (const fixture of codeGenerationBodyFixtures) {
      const request = requestWithBody(fixture.body);
      for (const language of codeTargetLanguages) {
        assertTargetParses(language, generator.generate(request, language));
      }
    }
  });
});
