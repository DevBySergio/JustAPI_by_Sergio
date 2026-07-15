import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AuthService,
  AuthServiceError,
  normalizePersistedRequest,
  SecretStorageLike,
} from '../../engine/auth/AuthService';
import { PersistedJustRequest } from '../../models/Request';
import { createRequestFixture } from '../fixtures/requestFixtures';
import { fixtureSecret } from '../fixtures/securityFixtures';
import { CodeGenerator } from '../../commands/CodeGenerator';

class MemorySecretStorage implements SecretStorageLike {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function secretRef(request: PersistedJustRequest): string {
  assert.notEqual(request.auth.type, 'none');
  return (request.auth as Exclude<PersistedJustRequest['auth'], { type: 'none' }>).secretRef;
}

function isAuthError(error: unknown, code: AuthServiceError['code']): boolean {
  return error instanceof AuthServiceError && error.code === code;
}

describe('AuthService', () => {
  test('normalizes legacy request settings to the bounded response default', () => {
    const request = createRequestFixture();
    const { maxResponseBytes: _legacyLimit, ...legacySettings } = request.settings;
    const normalized = normalizePersistedRequest({
      ...request,
      settings: legacySettings,
    } as unknown as PersistedJustRequest);

    assert.equal(normalized.settings.maxResponseBytes, 10 * 1024 * 1024);
  });

  test('keeps bearer credentials out of request state and derivative artifacts', async () => {
    const secrets = new MemorySecretStorage();
    const service = new AuthService(secrets);
    const request = createRequestFixture({ url: 'https://fixture.test/private' });
    request.auth = await service.configure(request.id, {
      type: 'bearer',
      token: fixtureSecret,
    });

    const persisted = service.prepareForSave(request);
    const ref = secretRef(persisted);
    assert.equal(JSON.stringify(request).includes(fixtureSecret), false);
    assert.equal(JSON.stringify(request).includes(ref), false);
    assert.equal(JSON.stringify(persisted).includes(fixtureSecret), false);
    assert.equal((secrets.values.get(ref) ?? '').includes(fixtureSecret), true);

    const redacted = service.redactForDerivative(request);
    assert.equal(redacted.headers.at(-1)?.value, 'Bearer <BEARER_TOKEN>');
    assert.equal(JSON.stringify(redacted).includes(fixtureSecret), false);

    const transport = await service.resolveForTransport(request);
    assert.equal(transport.headers.at(-1)?.value, `Bearer ${fixtureSecret}`);
    assert.equal(request.headers.length, 0);

    const imported = service.prepareForImport(redacted);
    assert.deepEqual(imported.auth, { type: 'none' });
    assert.equal(imported.headers.some(header => header.key === 'Authorization'), false);
  });

  test('requires a fresh, destination-scoped confirmation for each disclosure', async () => {
    const service = new AuthService(new MemorySecretStorage());
    const destinations: string[] = [];
    const confirm = async (disclosure: { destination: string; warning: string }) => {
      destinations.push(disclosure.destination);
      assert.match(disclosure.warning, /may expose secrets/i);
      return destinations.length === 2;
    };

    assert.equal(await service.confirmDisclosure('collection export', confirm), false);
    assert.equal(await service.confirmDisclosure('code sample', confirm), true);
    assert.deepEqual(destinations, ['collection export', 'code sample']);
  });

  test('encodes UTF-8 Basic auth immediately before transport', async () => {
    const secrets = new MemorySecretStorage();
    const service = new AuthService(secrets);
    const request = createRequestFixture();
    const username = 'sørën';
    const password = 'pässwörd';
    request.auth = await service.configure(request.id, {
      type: 'basic',
      username,
      password,
    });

    const transport = await service.resolveForTransport(request);
    const expected = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    assert.equal(transport.headers.at(-1)?.value, `Basic ${expected}`);
  });

  test('injects API keys in the selected location and blocks enabled conflicts', async () => {
    const secrets = new MemorySecretStorage();
    const service = new AuthService(secrets);
    const request = createRequestFixture();
    const unicodeSecret = `${fixtureSecret}-密钥`;
    request.auth = await service.configure(request.id, {
      type: 'apiKey',
      name: 'api_key',
      in: 'query',
      value: unicodeSecret,
    });
    const configuredAuth = request.auth;
    if (configuredAuth.type !== 'apiKey') {
      assert.fail('API-key fixture was not configured.');
    }

    const transport = await service.resolveForTransport(request);
    assert.equal(transport.queryParams.at(-1)?.key, 'api_key');
    assert.equal(transport.queryParams.at(-1)?.value, unicodeSecret);

    request.queryParams.push({ id: 'query-conflict', key: 'API_KEY', value: 'ordinary', enabled: true });
    await assert.rejects(
      service.resolveForTransport(request),
      error => isAuthError(error, 'AUTH_CONFLICT')
    );

    request.queryParams[0].enabled = false;
    const disabledConflict = await service.resolveForTransport(request);
    assert.equal(disabledConflict.queryParams.at(-1)?.value, unicodeSecret);

    request.queryParams = [];
    const variableResolved = await service.resolveForTransport({
      ...request,
      auth: { ...configuredAuth, name: 'resolved_api_key' },
    }, undefined, configuredAuth);
    assert.equal(variableResolved.queryParams.at(-1)?.key, 'resolved_api_key');
    assert.equal(variableResolved.queryParams.at(-1)?.value, unicodeSecret);

    const headerRequest = createRequestFixture();
    headerRequest.auth = await service.configure(headerRequest.id, {
      type: 'apiKey',
      name: 'X-Fixture-Key',
      in: 'header',
      value: unicodeSecret,
    });
    const headerTransport = await service.resolveForTransport(headerRequest);
    assert.equal(headerTransport.headers.at(-1)?.value, unicodeSecret);

    const snippet = new CodeGenerator().generate(service.redactForDerivative(request), 'curl');
    assert.match(snippet, /api_key=.*API_KEY/);
    assert.equal(snippet.includes(fixtureSecret), false);
  });

  test('migrates only recognized legacy headers and rolls back secrets if persistence fails', async () => {
    const secrets = new MemorySecretStorage();
    const service = new AuthService(secrets);
    const basicValue = Buffer.from('usér:päss', 'utf8').toString('base64');
    const legacy = [
      createRequestFixture({
        id: 'legacy-bearer',
        headers: [{ id: 'legacy-bearer-header', key: 'Authorization', value: `Bearer ${fixtureSecret}`, enabled: true }],
      }),
      createRequestFixture({
        id: 'legacy-basic',
        headers: [{ id: 'legacy-basic-header', key: 'authorization', value: `Basic ${basicValue}`, enabled: true }],
      }),
      createRequestFixture({
        id: 'legacy-api-key',
        headers: [{ id: 'legacy-api-header', key: 'X-API-Key', value: fixtureSecret, enabled: true }],
      }),
      createRequestFixture({
        id: 'legacy-custom-header',
        headers: [{ id: 'legacy-custom', key: 'X-API-Custom', value: fixtureSecret, enabled: true }],
      }),
    ].map(request => ({ ...request, auth: { type: 'none' } as const }));
    let persisted: PersistedJustRequest[] = [];

    const staged = await service.stageRecognizedLegacyAuth(legacy[0]);
    assert.equal(staged.migrated, true);
    assert.equal(staged.request.headers.length, 0);
    assert.deepEqual(staged.request.auth, { type: 'bearer', configured: true });
    await service.rollbackSave(staged.request.id);

    const count = await service.migrateLegacyRequests(legacy, async requests => {
      persisted = requests;
    });
    assert.equal(count, 3);
    assert.equal(secrets.values.size, 3);
    assert.equal(persisted[0].headers.length, 0);
    assert.equal(persisted[1].headers.length, 0);
    assert.equal(persisted[2].headers.length, 0);
    assert.equal(persisted[3].headers[0].key, 'X-API-Custom');
    assert.equal(JSON.stringify(persisted.slice(0, 3)).includes(fixtureSecret), false);

    const rollbackSecrets = new MemorySecretStorage();
    const rollbackService = new AuthService(rollbackSecrets);
    await assert.rejects(
      rollbackService.migrateLegacyRequests([legacy[0]], async () => {
        throw new Error('fixture persistence failure');
      })
    );
    assert.equal(rollbackSecrets.values.size, 0);
  });

  test('rotates, duplicates, and deletes secret references without breaking shared references', async () => {
    const secrets = new MemorySecretStorage();
    const service = new AuthService(secrets);
    const request = createRequestFixture({ id: 'request-secret-lifecycle' });
    request.auth = await service.configure(request.id, { type: 'bearer', token: fixtureSecret });
    const first = service.prepareForSave(request);
    const firstRef = secretRef(first);
    await service.commitSave(request.id, [first]);
    assert.throws(
      () => service.prepareForSave({ ...request, auth: { type: 'none' } }, first),
      error => isAuthError(error, 'AUTH_SECRET_NOT_FOUND')
    );

    request.auth = await service.configure(
      request.id,
      { type: 'bearer', token: `${fixtureSecret}-rotated` },
      first
    );
    const rotated = service.prepareForSave(request, first);
    const rotatedRef = secretRef(rotated);
    await service.commitSave(request.id, [rotated]);
    assert.equal(secrets.values.has(firstRef), false);
    assert.equal(secrets.values.has(rotatedRef), true);

    const duplicate = await service.duplicateRequest(rotated, 'request-secret-copy');
    assert.notEqual(secretRef(duplicate), rotatedRef);
    assert.equal(secrets.values.has(secretRef(duplicate)), true);

    const shared = { ...duplicate, id: 'request-secret-shared', auth: rotated.auth };
    await service.cleanupRemovedRequests([rotated], [shared, duplicate]);
    assert.equal(secrets.values.has(rotatedRef), true);
    await service.cleanupRemovedRequests([shared], [duplicate]);
    assert.equal(secrets.values.has(rotatedRef), false);
  });
});
