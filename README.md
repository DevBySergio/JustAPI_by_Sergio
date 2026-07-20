# JustAPI

JustAPI is a local-first HTTP client for VS Code. Its editor, collections, settings, variables, and history are stored locally; it has no account, cloud-sync, or telemetry integration. A request leaves the machine only when you explicitly send it to its configured HTTP(S) destination.

## Supported capabilities

### HTTP requests

- Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, and `HEAD` over HTTP or HTTPS.
- Body modes: JSON, text, XML, literal binary text, URL-encoded fields, and text-only multipart form fields.
- Per-request redirect following, TLS verification, timeout, and response-size settings.
- Method-aware redirects (10 hops maximum), with credentials and cookies stripped on cross-origin redirects.
- gzip, deflate, and Brotli decoding; declared text charsets; exact base64 transport for binary and allowlisted raster-image responses.
- Typed errors and observable DNS, connection, TLS, first-byte, download, and total timings. Timing phases are omitted when Node cannot observe them.

The response limit defaults to 10 MiB and accepts values from 1 KiB through 100 MiB. Timeouts accept 1 through 600,000 milliseconds. Request URLs are limited to 16 KiB. See the [HTTP implementation](src/engine/http/HttpClient.ts) and [localhost integration matrix](src/test/integration/httpClient.integration.test.ts).

### Collections and import/export

The collection panel can create, rename, duplicate, and delete collections; save and delete requests; and open nested requests. Schema-v2 JSON import/export validates the entire tree, preserves nested folders, rejects ID collisions and orphaned requests, and exports credentials as placeholders by default. Each import contains one collection and is limited to 10 MiB, 10,000 requests/items, and 50 folder levels. See the [collection service](src/services/CollectionService.ts) and [collection tests](src/test/unit/storageAndCollections.test.ts).

Imported folder trees can be displayed, searched, and round-tripped. The current UI does not create, rename, delete, move, or reorder folders, and it does not expose request moves. These remain deferred capabilities.

### cURL import

cURL import parses commands without executing a shell. It supports request method, headers, data variants, text form fields, URL, Basic credentials, cookies, redirect following, and the insecure-TLS flag. Unsupported, ambiguous, and potentially dangerous options produce warnings that must be acknowledged before import.

Shell expansion is never evaluated. `@file`, cookie-file, and file-valued form references are preserved as unresolved text and no local file is read. Proxy and cookie-jar options are reported as unsupported. See the [parser](src/engine/http/CurlParser.ts) and [parser tests](src/test/unit/parsingAndGeneration.test.ts).

### Variables

Interpolation uses deterministic precedence: Global < Variable Set < Collection < Request. It covers URLs, header/query/path names and values, body content and fields, and API-key names. Disabled, missing, duplicate, cyclic, oversized, or excessively nested variables produce preflight diagnostics; invalid required values block execution and code generation. Use `\{{name}}` for a literal `{{name}}`.

Global variables, collection variables, and reusable variable sets are editable in the UI. Request-scoped variables are supported by the request model and resolver, but the UI does not currently provide a request-variable editor. See the [variable engine](src/engine/variables/VariableEngine.ts) and [variable tests](src/test/unit/variableEngine.test.ts).

### Authentication and derivative data

The Auth Builder supports Bearer, Basic, and API-key credentials in headers or query parameters. Recognized Auth Builder secrets are stored in VS Code `SecretStorage`; ordinary JSON stores retain only public auth metadata and an opaque secret reference. Existing recognized literal credentials migrate conservatively on load.

History stores redacted summaries, not request/response bodies, headers, cookies, or credential values. Collection exports and generated code use placeholders by default. Including credentials is a one-time operation behind an explicit modal confirmation and is not persisted by that operation. Manually entered secrets outside the Auth Builder—for example in ordinary variables or body text—remain ordinary user data and should not be treated as SecretStorage-backed. See the [authentication service](src/engine/auth/AuthService.ts), [history summary](src/storage/HistorySummary.ts), and [security tests](src/test/unit/auth.test.ts).

### History, search, and responses

History is newest-first, filterable, and limited to 200 summary entries and a 2 MiB storage envelope. Saved requests can be replayed exactly; unsaved history entries replay as a redacted skeleton. Global search covers collections, imported folders, saved requests, and history and navigates to the selected result.

Text previews are capped at 200,000 characters and JSON parsing at 500,000 characters. JSON tree depth is limited to 24 and each node to 500 children. Inline image previews accept canonical base64 AVIF, GIF, JPEG, PNG, or WebP data up to 25 MiB. See the [webview resilience tests](src/test/unit/webviewResilience.test.ts).

### Code generation

JustAPI generates reviewed starter snippets for:

- JavaScript and TypeScript using Fetch (`Headers`, `FormData`, and `URLSearchParams` must exist in the chosen browser or Node runtime). Browser Fetch cannot disable TLS verification.
- Python using the third-party `requests` package.
- cURL for a POSIX-style shell.
- C# using .NET `HttpClient`.
- Java using `java.net.http` from Java 11 or newer. Per-request TLS bypass is not represented.
- Go using the standard `net/http` packages.

Snippets reflect the normalized request and use credential placeholders by default, but they are examples to review and adapt—not deployment, retry, streaming, observability, or production-hardening guarantees. See the [generator](src/commands/CodeGenerator.ts) and [golden/compile checks](src/test/unit/codeGeneration.test.ts).

## Commands and startup behavior

Open the JustAPI activity-bar view or use the Command Palette:

| Command | Behavior |
| --- | --- |
| `JustAPI: New Request` | Opens the view and creates a blank draft. |
| `JustAPI: Import from cURL` | Reads the clipboard and opens a parsed preview with warnings. |
| `JustAPI: Export Collection` | Selects a collection and writes a validated, redacted `.justapi.json` file. |
| `JustAPI: Import Collection` | Reads and validates a selected JSON file before committing it. |
| `JustAPI: Open History` | Opens the History section. |
| `JustAPI: Create Variable` | Opens the variable editor. |
| `JustAPI: Generate Code Snippet` | Opens code generation for the current request. |

`New Request` uses `Ctrl+Alt+N` (`Cmd+Alt+N` on macOS); cURL import uses `Ctrl+Alt+V` (`Cmd+Alt+V` on macOS). Commands wait for a `webviewReady` handshake, are delivered once with an operation ID, and report cancellation or failure instead of silently dropping a cold-start action. See the [command controller](src/commands/CommandController.ts) and [command tests](src/test/unit/commands.test.ts).

## Storage, migration, and recovery

Production wiring uses VS Code's extension-global storage directory. It does not use workspace storage, so collections and history are shared across workspaces for the same VS Code profile and extension installation.

| Domain | Local data |
| --- | --- |
| `collections.json` | Collection trees and saved requests with public auth metadata. |
| `variableSets.json` | Reusable variable sets and collection links. |
| `history.json` | Bounded, redacted execution summaries. |
| `globalVariables.json` | Global variables. |
| `settings.json` | JustAPI settings. |
| VS Code `SecretStorage` | Auth Builder credential payloads. |

JSON domains use a schema-v2 envelope containing `schemaVersion`, `revision`, `updatedAt`, and `data`. Legacy unversioned documents migrate on first read. Writes are serialized, locked, written to a mode-`0600` temporary file, fsynced, atomically renamed, and verified before success is acknowledged. The store keeps up to five runtime backups per domain and records migration/backup checksums in `migration-journal.json`.

On corrupt data, JustAPI preserves the original, attempts recovery from the newest verified backup, and reports the result. If recovery is impossible—or a newer unsupported schema or revision conflict is found—the affected domain becomes read-only rather than being overwritten. Storage documents are limited to 16 MiB. See the [storage implementation](src/storage/JsonFileStore.ts) and [recovery tests](src/test/unit/storageAndCollections.test.ts).

## Deferred capabilities

The current release does not provide:

- folder creation, rename, deletion, moving, or reordering in the UI;
- a request-scoped variable editor;
- workspace-scoped storage or multi-workspace synchronization;
- a persistent cookie jar (response `Set-Cookie` values are inspection-only);
- proxy configuration, client certificates, or OAuth flows;
- local-file, file-valued multipart, or streaming upload bodies;
- shell-compatible cURL execution or automatic `@file` expansion;
- pre-request scripts, post-response tests, runners, scheduling, or collaboration.

These are explicit product gaps, not implicit promises. The complete stabilization rationale is in the [audit remediation ledger](docs/audits/remediation-plan.md).

## Development and verification

Install the lockfile exactly and run the release gate:

```sh
npm ci
npm run validate
```

The gate runs policy checks, zero-warning lint, both strict type checks, unit and localhost integration suites, a real VS Code 1.80 extension-host suite, dependency audits, production builds, VSIX creation, and package allowlist validation. See [validation and testing](docs/testing.md) and [architecture](docs/architecture.md).

## License

MIT
