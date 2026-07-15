import type { BodyType, HttpMethod } from '../../models/Request';

export interface CurlImportFixture {
  id: string;
  source: 'browser' | 'postman';
  command: string;
  expected: {
    method: HttpMethod;
    url: string;
    bodyType: BodyType;
    bodyContent: string;
    headers: Array<{ key: string; value: string }>;
    followRedirects: boolean;
  };
}

export const curlImportFixtures: readonly CurlImportFixture[] = [
  {
    id: 'browser-copy-as-curl',
    source: 'browser',
    command: [
      "curl 'https://fixture.test/browser/items?active=true' \\",
      "  -H 'accept: application/json' \\",
      "  -H 'content-type: application/json' \\",
      "  --data-raw '{\"name\":\"Ada Lovelace\"}'",
    ].join('\n'),
    expected: {
      method: 'POST',
      url: 'https://fixture.test/browser/items?active=true',
      bodyType: 'json',
      bodyContent: '{"name":"Ada Lovelace"}',
      headers: [
        { key: 'accept', value: 'application/json' },
        { key: 'content-type', value: 'application/json' },
      ],
      followRedirects: true,
    },
  },
  {
    id: 'postman-generated-curl',
    source: 'postman',
    command: [
      "curl --location --request PUT 'https://fixture.test/postman/items/42' \\",
      "  --header 'X-Client: Postman' \\",
      "  --data '{\"enabled\":true}'",
    ].join('\n'),
    expected: {
      method: 'PUT',
      url: 'https://fixture.test/postman/items/42',
      bodyType: 'json',
      bodyContent: '{"enabled":true}',
      headers: [{ key: 'X-Client', value: 'Postman' }],
      followRedirects: true,
    },
  },
];
