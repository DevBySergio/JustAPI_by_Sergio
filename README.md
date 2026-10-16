# JustAPI

JustAPI is a local-first HTTP client for VS Code. Its editor, collections, settings, variables, and history are stored locally; it has no account, cloud-sync, or telemetry integration. A request leaves the machine only when you explicitly send it to its configured HTTP(S) destination.

## Supported capabilities

### HTTP requests

IPv4 and IPv6 literal destinations are supported. HEAD and bodyless status responses retain their metadata without attempting to decompress nonexistent content or imposing a body limit on metadata-only Content-Length values.

- Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, and `HEAD` over HTTP or HTTPS.
- Body modes: JSON, text, XML, literal binary text, URL-encoded fields, and text-only multipart form fields.
- Per-request redirect following, TLS verification, timeout, and response-size settings.
- Method-aware redirects (10 hops maximum), with credentials and cookies stripped on cross-origin redirects.
- gzip, deflate, and Brotli decoding; declared text charsets; exact base64 transport for binary and allowlisted raster-image responses.
- Typed errors and observable DNS, connection, TLS, first-byte, download, and total timings. Timing phases are omitted when Node cannot observe them.

The response limit defaults to 10 MiB and accepts values from 1 KiB through 100 MiB. Timeouts accept 1 through 600,000 milliseconds. Request URLs are limited to 16 KiB. See the [HTTP implementation](src/engine/http/HttpClient.ts) and [localhost integration matrix](src/test/integration/httpClient.integration.test.ts).

### Collections and import/export

The collection panel can create, rename, duplicate, and delete collections; save and delete requests; and open nested requests. Schema-v2 JSON import/export validates the entire tree, preserves nested folders, rejects ID collisions and orphaned requests, and exports credentials as placeholders by default. Each import contains one collection and is limited to 10 MiB, 10,000 requests/items, and 50 folder levels. See the [collection service](src/services/CollectionService.ts) and [collection tests](src/test/unit/storageAndCollections.test.ts).

Saving an existing request preserves its folder and position. Concurrent collection/history mutations serialize their complete read-modify-commit transactions. Use **+ New folder** at collection level or **Organize (⋯)** beside a folder/request to create subfolders, rename folders, move items, choose their destination position, reorder siblings, or confirm deletion. All controls support keyboard and pointer input. Deleting a folder removes its entire subtree and its credentials after persistence succeeds; unsaved edits in the current descendant request require a separate discard confirmation. Moving the current request between collections updates its active variable scope.

### cURL import

cURL import parses commands without executing a shell. It supports request method, headers, data variants, text form fields, URL, Basic credentials, cookies, redirect following, and the insecure-TLS flag. Unsupported, ambiguous, and potentially dangerous options produce warnings that must be acknowledged before import.

Imported data preserves its encoded bytes and explicit Content-Type. Without an explicit Content-Type, cURL data uses `application/x-www-form-urlencoded`; redirects are followed only when `-L`/`--location` is supplied. Imported encoded bodies without structured fields remain editable as raw content.

Shell expansion is never evaluated. `@file`, cookie-file, and file-valued form references are preserved as unresolved text and no local file is read. Proxy and cookie-jar options are reported as unsupported. See the [parser](src/engine/http/CurlParser.ts) and [parser tests](src/test/unit/parsingAndGeneration.test.ts).

### Variables

Interpolation uses deterministic precedence: Global < Variable Set < Collection < Request. It covers URLs, header/query/path names and values, body content and fields, and API-key names. Disabled, missing, duplicate, cyclic, oversized, or excessively nested variables produce preflight diagnostics; invalid required values block execution and code generation. Use `\{{name}}` for a literal `{{name}}`.

Global variables, collection variables, and reusable variable sets are editable in the UI. Global/collection autosaves are scheduled only by local edits, survive panel changes, and wait for host acknowledgement before navigation, execution, or code generation; failed saves remain pending for retry. The request **Vars** tab edits request-scoped variables as draft changes; **Save** persists them with the request. Request values override lower scopes; disabling an override allows lower scopes to apply. Resolved previews wait for pending scope/authentication changes and clear when inputs change. See the [variable engine](src/engine/variables/VariableEngine.ts) and [variable tests](src/test/unit/variableEngine.test.ts).

The request **Params** tab also edits path parameters. A URL such as `https://example.test/users/:id` uses the parameter `id`; its value can contain `{{variables}}`. Substitution applies only to a complete `/:name` path segment, never to the host, port, query or fragment. Names use letters/underscores followed by letters, digits, underscores or hyphens (128 characters maximum). Values are encoded as one segment, so `/`, `?`, `#`, `%` and Unicode cannot change URL structure. Missing/empty values, duplicate or invalid names, malformed Unicode, and dot-only `.`/`..` values block preflight. Use `%3Aname` for a literal colon-prefixed segment. Unused valid parameters are retained in the editor.

### Authentication and derivative data

The Auth Builder supports Bearer, Basic, and API-key credentials in headers or query parameters. **Apply** stages credentials for trying the current draft; **Save** commits them with the request. Replacing a token marks the request dirty even if its public metadata is unchanged. Discard restores saved authentication; recreating the webview drops pending credentials and warns before they must be re-entered. Saved collection exports always use saved credentials, including while another credential is staged for that request. Recognized Auth Builder secrets are stored in VS Code `SecretStorage`; ordinary JSON stores retain only public auth metadata and an opaque secret reference. Existing recognized literal credentials migrate conservatively on load.

History stores redacted summaries, not request/response bodies, headers, cookies, or credential values. Collection exports and generated code use placeholders by default, including recognized credentials embedded in URL user information. Explicit credential-bearing native exports import into the destination SecretStorage; redacted placeholders are not imported as real credentials. Including credentials is a one-time operation behind an explicit modal confirmation and is not persisted by that operation. Manually entered secrets outside the Auth Builder—for example in ordinary variables, URL values, or body text—remain ordinary user data and should not be treated as SecretStorage-backed. See the [authentication service](src/engine/auth/AuthService.ts), [history summary](src/storage/HistorySummary.ts), and [security tests](src/test/unit/auth.test.ts).

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

`New Request` uses `Ctrl+Alt+N` (`Cmd+Alt+N` on macOS); cURL import uses `Ctrl+Alt+V` (`Cmd+Alt+V` on macOS). Startup sends collections, history, global variables, variable sets, and settings separately, then confirms initialization. Commands wait for a `webviewReady` handshake, are delivered once with an operation ID, and report cancellation or failure instead of silently dropping a cold-start action. See the [command controller](src/commands/CommandController.ts) and [command tests](src/test/unit/commands.test.ts).

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

- workspace-scoped storage or multi-workspace synchronization;
- a persistent cookie jar (response `Set-Cookie` values are inspection-only);
- proxy configuration, client certificates, or OAuth flows;
- local-file, file-valued multipart, or streaming upload bodies;
- shell-compatible cURL execution or automatic `@file` expansion;
- pre-request scripts, post-response tests, runners, scheduling, or collaboration.

These are explicit product gaps, not implicit promises. The ordered proposal for adding them is in [the local-client roadmap](docs/roadmap.md). Folder organization and request variables/path parameters now ship in 1.2.0; the remaining rows are proposed. The complete stabilization rationale is in the [audit remediation ledger](docs/audits/remediation-plan.md).

## Development and verification

Install the lockfile exactly and run the release gate:

```sh
npm ci
npm run validate
```

The gate runs policy checks, zero-warning lint, both strict type checks, unit and localhost integration suites, a real VS Code 1.80 extension-host suite, dependency audits, production builds, VSIX creation, and package allowlist validation. See [validation and testing](docs/testing.md) and [architecture](docs/architecture.md).

## License

MIT

## October 2026 corrective release

Version 1.1.1 closes cancellation-during-preparation, concurrent mutation loss, variable autosave, pending authentication, native credential round-trip, cURL form, IPv6, bodyless HTTP, and stale-save/result regressions. The full evidence and remaining limitations are in [the corrective audit](docs/audits/2026-10-16-corrections.md). JSON storage and native collection transfers retain schema v2.

Control protocol messages remain limited to 1 MiB. Request-bearing messages and individual data domains have a 16 MiB data budget plus a 64 KiB envelope allowance; each stored JSON document still has its 16 MiB limit and native import files retain their 10 MiB limit. Per-field and structural limits also apply. Invalid inputs produce diagnostics before preview, execution, and generation; a failed save never declares the current draft clean.

Version 1.2.0 completes folder organization and request variables/path parameters, and loads secondary panels on demand. See the [daily-workflow validation report](docs/audits/2026-10-16-daily-workflows.md). No account, backend, telemetry or cloud service was added.
