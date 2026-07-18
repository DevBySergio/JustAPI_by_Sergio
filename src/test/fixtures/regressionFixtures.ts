export type RegressionFixtureStatus = 'active' | 'contract';

export interface RegressionFixture {
  id: string;
  area: string;
  owner: string;
  status: RegressionFixtureStatus;
  purpose: string;
}

export const regressionFixtures: readonly RegressionFixture[] = [
  { id: 'transport-methods', area: 'transport', owner: 'HTTP', status: 'active', purpose: 'HTTP methods, query values, and headers' },
  { id: 'transport-bodies', area: 'transport', owner: 'HTTP', status: 'active', purpose: 'JSON, text, URL-encoded, and multipart request bodies' },
  { id: 'transport-redirects', area: 'transport', owner: 'HTTP', status: 'active', purpose: 'Relative localhost redirects' },
  { id: 'transport-compression', area: 'transport', owner: 'HTTP', status: 'contract', purpose: 'Compressed response decoding contract' },
  { id: 'transport-limits', area: 'transport', owner: 'HTTP', status: 'contract', purpose: 'Bounded response and redirect limits' },
  { id: 'transport-timing', area: 'transport', owner: 'HTTP', status: 'active', purpose: 'Duration metadata from a deterministic server' },
  { id: 'transport-timeout', area: 'transport', owner: 'HTTP', status: 'active', purpose: 'Request timeout classification' },
  { id: 'transport-cancellation', area: 'transport', owner: 'HTTP', status: 'active', purpose: 'In-flight request cancellation' },
  { id: 'variables-precedence-cycles', area: 'variables', owner: 'VARIABLES', status: 'contract', purpose: 'Precedence, cycles, and replacement bounds' },
  { id: 'storage-corruption', area: 'storage', owner: 'STORAGE', status: 'active', purpose: 'Corrupt JSON read behavior' },
  { id: 'storage-migration', area: 'storage', owner: 'STORAGE', status: 'contract', purpose: 'Legacy-to-v2 migration and recovery' },
  { id: 'storage-concurrency', area: 'storage', owner: 'STORAGE', status: 'active', purpose: 'Multiple writes before an explicit flush' },
  { id: 'collection-roundtrip', area: 'collections', owner: 'COLLECTIONS', status: 'active', purpose: 'Nested collection and request persistence' },
  { id: 'curl-import', area: 'curl', owner: 'CURL', status: 'active', purpose: 'cURL option and body parsing corpus' },
  { id: 'code-generation', area: 'codegen', owner: 'CODEGEN', status: 'active', purpose: 'Language renderer output contracts' },
  { id: 'protocol-validation', area: 'protocol', owner: 'PROTOCOL', status: 'active', purpose: 'Malformed, oversized, and unknown messages' },
  { id: 'protocol-errors', area: 'protocol', owner: 'PROTOCOL', status: 'active', purpose: 'Stable error envelopes and operation correlation' },
  { id: 'secret-storage', area: 'security', owner: 'AUTH', status: 'contract', purpose: 'SecretStorage migration and reference lifecycle' },
  { id: 'redaction', area: 'security', owner: 'AUTH', status: 'contract', purpose: 'Recursive artifact redaction' },
  { id: 'stale-responses', area: 'webview', owner: 'UI', status: 'active', purpose: 'Ignore results from superseded executions' },
  { id: 'extension-activation', area: 'extension', owner: 'TEST', status: 'active', purpose: 'Activation at the declared VS Code engine floor' },
  { id: 'command-startup-queue', area: 'extension', owner: 'COMMANDS', status: 'active', purpose: 'Deliver cold-start commands once the view is ready' },
  { id: 'webview-lifecycle', area: 'extension', owner: 'TEST', status: 'active', purpose: 'Open, reveal, and close the contributed view' },
];
