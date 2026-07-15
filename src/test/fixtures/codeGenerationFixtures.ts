import type { CodeTargetLanguage } from '../../models/MessageProtocol';
import type { HttpMethod, JustRequest, RequestBody } from '../../models/Request';
import { createRequestFixture } from './requestFixtures';

export const codeTargetLanguages: readonly CodeTargetLanguage[] = [
  'javascript',
  'typescript',
  'python',
  'curl',
  'csharp',
  'java',
  'go',
];

export const codeGenerationMethods: readonly HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
];

const specialValue = `O'Reilly "quoted" \\ path\n東京 😀 $HOME $(touch nope);`;
const headerSpecialValue = `O'Reilly "quoted" \\ path $HOME $(touch nope);`;

export const codeGenerationGoldenRequest: JustRequest = createRequestFixture({
  id: 'code-generation-golden',
  name: 'Resolved {{fixture}}',
  method: 'PATCH',
  url: 'https://fixture.test/a path?existing=first#ignored',
  queryParams: [
    { id: 'query-enabled', key: 'search term', value: specialValue, enabled: true },
    { id: 'query-disabled', key: 'disabled', value: 'not-rendered', enabled: false },
  ],
  headers: [
    { id: 'header-first', key: 'X-Duplicate', value: 'first', enabled: true },
    { id: 'header-last', key: 'x-duplicate', value: headerSpecialValue, enabled: true },
    { id: 'header-length', key: 'Content-Length', value: '999', enabled: true },
    { id: 'header-disabled', key: 'X-Disabled', value: 'not-rendered', enabled: false },
  ],
  auth: { type: 'bearer', configured: true },
  body: {
    type: 'json',
    content: JSON.stringify({ message: specialValue, enabled: true }),
  },
  settings: {
    timeout: 12_345,
    followRedirects: false,
    verifySSL: false,
    maxResponseBytes: 2 * 1024 * 1024,
  },
});

export const codeGenerationGoldenHashes: Readonly<Record<CodeTargetLanguage, string>> = {
  javascript: 'da650b3a89a1f6311489cd44dab2ac5e36ac8d56fade60837c3b614022dd65d8',
  typescript: 'd89b9787cc786e18c5bfbac4929a8de4a02e6b1ea86fc128bf04b75b74f1ffe2',
  python: '5f123da97fe386a4a50b9f7e057ebfa13c4ca420a6a705f6a48b0e66d2477c01',
  curl: '6f0ef388fba7ccd0f2d309241cd9b608dc38acaf4fbf5c1e41ba72621a56902f',
  csharp: 'dd9a16f1343a8c6279e50684aaa4ec4f5b983722d28bb1af43014a0606226c48',
  java: '9678987fdff1b52a34d1aff95fc260bf10d2c31eb127846c177e0949818c5e87',
  go: '22a2c9809b6cb418b706e684301ce126d408672de56f7cd52ca8cf267e07e39a',
};

export interface CodeGenerationBodyFixture {
  id: RequestBody['type'];
  body: RequestBody;
}

export const codeGenerationBodyFixtures: readonly CodeGenerationBodyFixture[] = [
  { id: 'none', body: { type: 'none', content: '' } },
  {
    id: 'json',
    body: { type: 'json', content: JSON.stringify({ message: specialValue, count: 0 }) },
  },
  { id: 'text', body: { type: 'text', content: specialValue } },
  { id: 'xml', body: { type: 'xml', content: `<message>${specialValue}</message>` } },
  { id: 'binary', body: { type: 'binary', content: `binary-${specialValue}-\u0001` } },
  {
    id: 'x-www-form-urlencoded',
    body: {
      type: 'x-www-form-urlencoded',
      content: 'ignored-editor-content',
      formData: [
        { id: 'urlencoded-one', key: 'message', value: specialValue, enabled: true },
        { id: 'urlencoded-two', key: 'empty', value: '', enabled: true },
        { id: 'urlencoded-disabled', key: 'disabled', value: 'not-rendered', enabled: false },
      ],
    },
  },
  {
    id: 'form-data',
    body: {
      type: 'form-data',
      content: 'ignored-editor-content',
      formData: [
        { id: 'multipart-one', key: 'message', value: specialValue, enabled: true },
        { id: 'multipart-two', key: 'literal-file-value', value: '@/not/a/file.bin', enabled: true },
        { id: 'multipart-disabled', key: 'disabled', value: 'not-rendered', enabled: false },
      ],
    },
  },
];
