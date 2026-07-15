import * as assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { HttpClient } from '../../engine/http/HttpClient';
import { createRequestFixture } from '../fixtures/requestFixtures';
import { HttpFixtureServer, startHttpFixtureServer } from '../support/httpFixtureServer';
import { AuthService, SecretStorageLike } from '../../engine/auth/AuthService';
import { fixtureSecret } from '../fixtures/securityFixtures';

class IntegrationSecretStorage implements SecretStorageLike {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | undefined> { return this.values.get(key); }
  async store(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

describe('HttpClient with a deterministic localhost server', () => {
  let fixtureServer: HttpFixtureServer;

  before(async () => {
    fixtureServer = await startHttpFixtureServer();
  });

  after(async () => {
    await fixtureServer.close();
  });

  test('sends methods, query values, headers, and reads response cookies', async () => {
    const response = await new HttpClient().execute(createRequestFixture({
      method: 'PATCH',
      url: `${fixtureServer.baseUrl}/echo`,
      headers: [{ id: 'header', key: 'X-Fixture', value: 'enabled', enabled: true }],
      queryParams: [{ id: 'query', key: 'spaced value', value: 'one & two', enabled: true }],
    }));

    const body = JSON.parse(response.body) as {
      method: string;
      query: Record<string, string>;
      headers: Record<string, string>;
    };
    assert.equal(response.statusCode, 200);
    assert.equal(response.bodyType, 'json');
    assert.equal(body.method, 'PATCH');
    assert.equal(body.query['spaced value'], 'one & two');
    assert.equal(body.headers['x-fixture'], 'enabled');
    assert.deepEqual(response.cookies, [{ name: 'fixture', value: 'value', path: '/', httpOnly: true }]);
  });

  test('sends SecretStorage-backed bearer and query API-key credentials only after preflight', async () => {
    const authService = new AuthService(new IntegrationSecretStorage());
    const bearer = createRequestFixture({ url: `${fixtureServer.baseUrl}/echo` });
    bearer.auth = await authService.configure(bearer.id, {
      type: 'bearer',
      token: fixtureSecret,
    });
    const bearerResponse = await new HttpClient().execute(
      await authService.resolveForTransport(bearer)
    );
    const bearerEcho = JSON.parse(bearerResponse.body) as { headers: Record<string, string> };
    assert.equal(bearerEcho.headers.authorization, `Bearer ${fixtureSecret}`);
    assert.equal(JSON.stringify(bearer).includes(fixtureSecret), false);

    const apiKey = createRequestFixture({ url: `${fixtureServer.baseUrl}/echo` });
    apiKey.auth = await authService.configure(apiKey.id, {
      type: 'apiKey',
      name: 'fixture_key',
      in: 'query',
      value: fixtureSecret,
    });
    const apiKeyResponse = await new HttpClient().execute(
      await authService.resolveForTransport(apiKey)
    );
    const apiKeyEcho = JSON.parse(apiKeyResponse.body) as { query: Record<string, string> };
    assert.equal(apiKeyEcho.query.fixture_key, fixtureSecret);
  });

  test('serializes JSON, URL-encoded, and multipart body fixtures', async () => {
    const jsonResponse = await new HttpClient().execute(createRequestFixture({
      method: 'POST',
      url: `${fixtureServer.baseUrl}/echo`,
      body: { type: 'json', content: '{"fixture":true}' },
    }));
    const jsonEcho = JSON.parse(jsonResponse.body) as { body: string; headers: Record<string, string> };
    assert.equal(jsonEcho.body, '{"fixture":true}');
    assert.equal(jsonEcho.headers['content-type'], 'application/json');

    const formData = [{ id: 'field', key: 'fixture key', value: 'fixture value', enabled: true }];
    const urlEncodedResponse = await new HttpClient().execute(createRequestFixture({
      method: 'POST',
      url: `${fixtureServer.baseUrl}/echo`,
      body: { type: 'x-www-form-urlencoded', content: 'fixture', formData },
    }));
    const urlEncodedEcho = JSON.parse(urlEncodedResponse.body) as { body: string };
    assert.equal(urlEncodedEcho.body, 'fixture%20key=fixture%20value');

    const multipartResponse = await new HttpClient().execute(createRequestFixture({
      method: 'POST',
      url: `${fixtureServer.baseUrl}/echo`,
      body: { type: 'form-data', content: 'fixture', formData },
    }));
    const multipartEcho = JSON.parse(multipartResponse.body) as { body: string };
    assert.match(multipartEcho.body, /Content-Disposition: form-data; name="fixture key"/);
    assert.match(multipartEcho.body, /fixture value/);
  });

  test('follows a relative redirect', async () => {
    const response = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/redirect`,
    }));
    const body = JSON.parse(response.body) as { path: string; query: Record<string, string> };

    assert.equal(response.statusCode, 200);
    assert.equal(body.path, '/echo');
    assert.equal(body.query.redirected, '1');
  });

  test('captures compressed and bounded response metadata plus timing', async () => {
    const compressed = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/gzip`,
    }));
    assert.equal(compressed.headers['content-encoding'], 'gzip');
    assert.ok(compressed.size > 0);

    const large = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/large?bytes=65536`,
    }));
    assert.equal(large.size, 65_536);

    const delayed = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/delay?ms=35`,
    }));
    assert.ok(delayed.duration >= 20);
  });

  test('classifies a request timeout', async () => {
    const response = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/delay?ms=150`,
      settings: { timeout: 25, followRedirects: true, verifySSL: true },
    }));

    assert.equal(response.statusCode, 0);
    assert.equal(response.error?.type, 'timeout');
  });

  test('settles an in-flight request after cancellation', async () => {
    const client = new HttpClient();
    const pendingResponse = client.execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/delay?ms=500`,
    }));
    setTimeout(() => client.cancel(), 20);

    const response = await pendingResponse;
    assert.equal(response.statusCode, 0);
    assert.ok(response.error);
  });
});
