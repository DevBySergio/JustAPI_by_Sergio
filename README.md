# JustAPI

JustAPI is a local-first HTTP client for VS Code. Its editor, collections, settings, variables, and history are stored locally; it has no account, cloud-sync, or telemetry integration. A request leaves the machine only when you explicitly send it to its configured HTTP(S) destination.

## Supported capabilities

### HTTP requests

IPv4 and IPv6 literal destinations are supported. HEAD and bodyless status responses retain their metadata without attempting to decompress nonexistent content or imposing a body limit on metadata-only Content-Length values.

- Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, and `HEAD` over HTTP or HTTPS.
- Body modes: JSON, text, XML, local binary files, URL-encoded fields, and multipart text/file fields (existing literal binary bodies remain compatible).
- Per-request redirect following, TLS verification, timeout, and response-size settings.
- Method-aware redirects (10 hops maximum), with credentials and cookies stripped on cross-origin redirects.
- gzip, deflate, and Brotli decoding; declared text charsets; exact base64 transport for binary and allowlisted raster-image responses.
- Typed errors and observable DNS, connection, TLS, first-byte, download, and total timings. Timing phases are omitted when Node cannot observe them.

The response limit defaults to 10 MiB and accepts values from 1 KiB through 100 MiB. Timeouts accept 1 through 600,000 milliseconds. Request URLs are limited to 16 KiB. See the [HTTP implementation](src/engine/http/HttpClient.ts) and [localhost integration matrix](src/test/integration/httpClient.integration.test.ts).

### Request tabs

Use **+** beside the request tabs or **+ New** to open another draft. Opening a saved request selects its existing tab and preserves unsaved edits. cURL imports and unsaved history replays open new tabs. Each tab owns its collection selection, draft, pending Auth Builder state, response, generated code, execution and errors. Browsing another collection does not change a request's execution scope. Requests in different tabs can run concurrently.

Tabs marked **●** have unsaved changes. Closing offers **Keep editing**, **Discard and close**, and, when a collection is selected, **Save and close**. A rejected save keeps the tab open. Closing a tab stops its execution and clears its pending credentials; other tabs continue. Deleting a folder/collection also protects dirty inactive descendants. Use arrow keys/Home/End in the request tab strip and Delete to close the focused tab.

The local webview cache restores at most 20 request drafts and their collection scopes, with a 4 MiB total budget. It migrates the previous single-editor cache. Sensitive/oversized values may be omitted with a notice; large inactive draft fields are omitted first. Response bodies, generated code, running connections and pending authentication credentials are session-only. Apply authentication before leaving its editor; unapplied credential fields are cleared when the request editor unmounts. Collection JSON and SecretStorage remain the durable saved source. Closing the last tab opens an empty draft.

Version 1.3.0 is prepared in the working tree; its VSIX and installed-package checks await final packaging. See [request-tab implementation evidence](docs/audits/2026-10-16-request-tabs.md).

### Collections and import/export

The collection panel can create, rename, duplicate, and delete collections; save and delete requests; and open nested requests. Schema-v2 JSON import/export validates the entire tree, preserves nested folders, rejects ID collisions and orphaned requests, and exports credentials as placeholders by default. Each import contains one collection and is limited to 10 MiB, 10,000 requests/items, and 50 folder levels. See the [collection service](src/services/CollectionService.ts) and [collection tests](src/test/unit/storageAndCollections.test.ts).

Saving an existing request preserves its folder and position. Concurrent collection/history mutations serialize their complete read-modify-commit transactions. Use **+ New folder** at collection level or **Organize (⋯)** beside a folder/request to create subfolders, rename folders, move items, choose their destination position, reorder siblings, or confirm deletion. All controls support keyboard and pointer input. Deleting a folder removes its entire subtree and its credentials after persistence succeeds; unsaved edits in any open descendant request require a separate discard confirmation. Moving a request between collections updates the execution scope of its open tab.

### cURL import

cURL import parses commands without executing a shell. It supports request method, headers, data variants, text form fields, URL, Basic credentials, cookies, redirect following, and the insecure-TLS flag. Unsupported, ambiguous, and potentially dangerous options produce warnings that must be acknowledged before import.

Imported data preserves its encoded bytes and explicit Content-Type. Without an explicit Content-Type, cURL data uses `application/x-www-form-urlencoded`; redirects are followed only when `-L`/`--location` is supplied. Imported encoded bodies without structured fields remain editable as raw content.

Shell expansion is never evaluated. `@file`, cookie-file, and file-valued form references are preserved as unresolved text and no local file is read. Proxy and cookie-jar options are reported as unsupported. See the [parser](src/engine/http/CurlParser.ts) and [parser tests](src/test/unit/parsingAndGeneration.test.ts).

### Variables

Interpolation uses deterministic precedence: Global < linked shared Variable Sets < active Environment < Collection < Request. It covers URLs, header/query/path names and values, body content and fields, and API-key names. Disabled, missing, duplicate, cyclic, oversized, or excessively nested variables produce preflight diagnostics; invalid required values block execution and code generation. Use `\{{name}}` for a literal `{{name}}`.

Global variables, collection variables, and reusable variable sets are editable in the UI. Global/collection autosaves are scheduled only by local edits, survive panel changes, and wait for host acknowledgement before navigation, execution, or code generation; failed saves remain pending for retry. The request **Vars** tab edits request-scoped variables as draft changes; **Save** persists them with the request. Request values override lower scopes; disabling an override allows lower scopes to apply. Resolved previews wait for pending scope/authentication changes and clear when inputs change. See the [variable engine](src/engine/variables/VariableEngine.ts) and [variable tests](src/test/unit/variableEngine.test.ts).

The request **Params** tab also edits path parameters. A URL such as `https://example.test/users/:id` uses the parameter `id`; its value can contain `{{variables}}`. Substitution applies only to a complete `/:name` path segment, never to the host, port, query or fragment. Names use letters/underscores followed by letters, digits, underscores or hyphens (128 characters maximum). Values are encoded as one segment, so `/`, `?`, `#`, `%` and Unicode cannot change URL structure. Missing/empty values, duplicate or invalid names, malformed Unicode, and dot-only `.`/`..` values block preflight. Use `%3Aname` for a literal colon-prefixed segment. Unused valid parameters are retained in the editor.

### Environments and `.env` import

The **Environment** selector applies to all request tabs in the current VS Code profile. **No environment** keeps global, linked shared sets, collection and request variables active. Environments use the existing `variableSets.json` domain with additive metadata; existing sets are not automatically converted or disabled. Selection commits locally before dependent sending, previews or code generation continue. A rejected selection keeps the previous environment; requests already preparing or running keep their captured values.

Use **Manage** or **Variables → Environments** to create, edit, rename or delete environments. **Save environment** commits name/variable changes; **Discard edits** restores saved values. Unsaved drafts survive panel navigation within the session, are excluded from the webview cache, and trigger a warning after reload. Concurrent changes reject stale saves instead of overwriting them. Deleting the active environment selects no environment.

**Import .env…** opens the native local file picker and shows a masked preview. Show values explicitly, choose a name, then confirm or cancel. Imports create an inactive environment; **Replace from .env…** explicitly replaces a saved environment's entire variable list, retaining its name by default. The reviewed file must remain unchanged until confirmation. Empty files can be explicitly confirmed as empty environments. Files are never modified, and environment values or source paths are not automatically added to native collection exports.

Supported syntax: UTF-8/BOM, LF/CRLF, comments, `NAME=value`, optional `export`, empty values and single/double-quoted multiline values. Double quotes decode `\n`, `\r`, `\"` and `\\`; unquoted `#` starts a comment. Names use letters/underscores followed by letters/digits/underscores (128 characters maximum). Duplicate names, malformed assignments and unclosed quotes block confirmation with line/code diagnostics that omit values. Files are limited to 1 MiB, 1,000 variables and 65,536 characters per value. Shell commands, `$VAR` and `${VAR}` are literal text; the importer never evaluates them or reads process environment variables. Normal JustAPI `{{variable}}` resolution still applies when requests run.

**Watch this file during this session** is opt-in. File changes, including atomic replacements, produce a fresh preview and require confirmation. They never apply values, write files or execute requests automatically. **Stop watching**, environment deletion or webview recreation releases the watcher and staged previews. To watch again after reload, use **Replace from .env…** and enable watching again. Errors retain saved values; unsaved environment edits must be saved/discarded before replacing them from a file.

Environment values are ordinary local JSON data, including imported values. Masking is a display choice; it does not move values into SecretStorage. Use Auth Builder for securely stored credentials. Code samples and previews resolve ordinary environment data using the same rules as other variables, with the existing recognized-credential redaction.

### Import from Postman

Choose **Collections → Import Postman…** or **Variables → Environments → Import Postman…**, then select a local Postman v2.1 collection JSON or environment JSON export. Review the counts and limitations, choose a name and confirm. If anything is omitted or behaves differently, acknowledgement is required. This creates a new collection/environment; existing requests, drafts and environment selection are preserved. Imported environments start inactive.

Nested folder order, collection/folder variables, supported HTTP methods, raw text/JSON/XML, URL-encoded fields and text-only multipart bodies are supported. Disabled fields, query lists, path variables and inherited Bearer/Basic/API key authentication are preserved. Recognized authentication headers and URL user information move to SecretStorage; credential templates such as `{{TOKEN}}` resolve when sending. Source values remain in the extension host during preview, and the file must still match the reviewed bytes at confirmation.

Scripts, response examples, request descriptions and Postman-specific settings are reported as omissions. Requests containing unsupported auth, methods, file uploads, GraphQL bodies, invalid data or ambiguous credentials are excluded as a whole. Environment variables marked `secret` are excluded and reported; configure those credentials in Auth Builder. Other variables/body values remain ordinary local JSON. JustAPI collection/request variables take priority over the environment, unlike Postman collection variables; review overlapping names. No scripts, linked files or remote references are executed or fetched.

Imports are limited to UTF-8 regular files of 10 MiB, 10,000 collection items, 50 folder levels and 10,000 expanded variable entries. Converted request/credential data also has a 10 MiB budget, alongside the existing structural, field and storage limits. Confirmation is single-use; changed files require a new preview. Cancel or webview recreation drops staged data. The existing **JustAPI: Import Collection** command still handles the native JustAPI format. See the [migration evidence and limitations](docs/audits/2026-10-16-postman-import.md).

## Authentication and derivative data

The Auth Builder supports Bearer, Basic, and API-key credentials in headers or query parameters. **Apply** stages credentials for trying the current draft; **Save** commits them with the request. Replacing a token marks the request dirty even if its public metadata is unchanged. Discard restores saved authentication; recreating the webview drops pending credentials and warns before they must be re-entered. Saved collection exports always use saved credentials, including while another credential is staged for that request. Recognized Auth Builder secrets are stored in VS Code `SecretStorage`; ordinary JSON stores retain only public auth metadata and an opaque secret reference. Existing recognized literal credentials migrate conservatively on load.

History stores redacted summaries, not request/response bodies, headers, cookies, or credential values. Collection exports and generated code use placeholders by default, including recognized credentials embedded in URL user information. Redaction also covers incomplete and variable-protocol URLs. Explicit credential-bearing native exports import into the destination SecretStorage; redacted placeholders are not imported as real credentials. Including credentials is a one-time operation behind an explicit modal confirmation and is not persisted by that operation. Manually entered secrets outside the Auth Builder—for example in ordinary variables, URL values, or body text—remain ordinary user data and should not be treated as SecretStorage-backed. See the [authentication service](src/engine/auth/AuthService.ts), [history summary](src/storage/HistorySummary.ts), and [security tests](src/test/unit/auth.test.ts).

### History, search, and responses

History is newest-first, filterable, and limited to 200 summary entries and a 2 MiB storage envelope. Saved requests can be replayed exactly; unsaved history entries replay as a redacted skeleton. Global search covers collections, imported folders, saved requests, and history and navigates to the selected result.

Text previews are capped at 200,000 characters and JSON parsing at 500,000 characters. JSON tree depth is limited to 24 and each node to 500 children. Inline image previews accept canonical base64 AVIF, GIF, JPEG, PNG, or WebP data up to 25 MiB. See the [webview resilience tests](src/test/unit/webviewResilience.test.ts).

### Save response bodies

After receiving a complete response, choose **Save response body…** and a local destination. This saves the full body already received; it does not resend the request. Text formatting, JSON pretty-printing and the 200,000-character preview limit do not change the file. Binary/image bytes, BOM, line endings and the original text encoding are preserved. HTTP gzip/deflate/Brotli compression is decoded first; this saves the entity body, not the compressed wire stream, headers or cookies. Binary previews are explicitly labelled as base64.

Complete 4xx/5xx and empty/HEAD/no-content responses can also be saved. Failed, cancelled, incomplete, over-limit or invalid compressed responses cannot be downloaded as if they were complete. The configured response limit still applies (10 MiB by default, up to 100 MiB); this is not a streaming/unlimited download feature.

The native dialog suggests a MIME-based `response.ext` name, which you can change. Server-provided filenames and URL paths are not used as destinations. Cancel writes nothing; the interface confirms success only after the file is saved. Writes use a private sibling temporary file and atomic replacement so a failed write preserves an existing destination. Failed saves can be retried. The chosen file contains the actual API response, including any sensitive data returned by that API; it is ordinary local file content.

Original bytes are kept only in memory, up to 100 MiB across 20 responses. Older bodies may expire when the budget is reached; closing/resending a request or recreating the view also releases them. An expired response shows a notice and cannot be downloaded until you explicitly send again. Navigation preserves an ongoing save's ownership and result. Closing/replacing a response while its dialog is open prevents the old body from being written. Bodies, save paths and download state are excluded from history, collection exports and restored drafts. See the [response download evidence](docs/audits/2026-10-16-response-downloads.md).

### Upload local files

In **Body → Binary**, choose a local file to send its original bytes. In **Body → Form Data**, keep the existing text fields and use **+ Add file** for file fields, including repeated field names. Each file has an enable switch, a field name and an optional MIME type (type/subtype, without parameters; default `application/octet-stream`). Multipart text fields precede file fields; JustAPI creates the boundary and Content-Type. An explicit request Content-Type still overrides the binary body's default.

Files are limited to 10 MiB each, 20 file rows and a 25 MiB complete multipart body. They are read into bounded memory before connecting; streaming is not included. Missing, deleted, changed or expired selections block the upload. Canceling while files are being prepared prevents a connection. Choosing another file is required after changing its contents.

Only the native local file chooser can grant access. Paths and file bytes never enter the webview, saved collections, exports or generated examples. A saved request can reuse its selection while its tab/session remains open; closing/reloading the view, importing a collection or duplicating a request requires choosing files again. Draft restoration also removes selection metadata and explains the need to reselect. Exported file fields retain their names, switches and MIME settings, with the file choice cleared.

All seven snippet targets provide file recipes: browser JavaScript/TypeScript ask for files through inputs; other targets use `<LOCAL_FILE_n>` placeholders you replace explicitly. They do not embed local paths, selection IDs or file contents. Existing binary bodies imported as literal text keep their UTF-8 behavior until a file is chosen. See the [upload implementation and evidence](docs/audits/2026-10-16-file-uploads.md).

## Code generation

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
| `variableSets.json` | Reusable shared sets, collection links, environments and the active environment selection. |
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
- streaming/unlimited uploads (selected files currently have bounded sizes);
- shell-compatible cURL execution or automatic `@file` expansion;
- pre-request scripts, post-response tests, runners, scheduling, or collaboration.

These are explicit product gaps, not implicit promises. The ordered proposal for adding them is in [the local-client roadmap](docs/roadmap.md). Folder organization and request variables/path parameters ship in 1.2.0; request tabs, environments, `.env` import, offline Postman migration, response downloads and local file uploads are prepared for 1.3.0. The remaining roadmap rows are proposed. The complete stabilization rationale is in the [audit remediation ledger](docs/audits/remediation-plan.md).

## Development and verification

Install the lockfile exactly and run the source gate:

```sh
npm ci
npm run validate:source
```

`validate:source` performs source, runtime, production-build and package-inventory checks without creating a VSIX. Use `npm run validate` only when preparing an authorized installable release; that gate also creates and tests the VSIX.

The source gate runs policy checks, zero-warning lint, both strict type checks, unit, webview and localhost integration suites, a real VS Code 1.80 extension-host suite, dependency audits, production builds and package inventory validation. See [validation and testing](docs/testing.md) and [architecture](docs/architecture.md).

## License

MIT

## October 2026 corrective release

Version 1.1.1 closes cancellation-during-preparation, concurrent mutation loss, variable autosave, pending authentication, native credential round-trip, cURL form, IPv6, bodyless HTTP, and stale-save/result regressions. The full evidence and remaining limitations are in [the corrective audit](docs/audits/2026-10-16-corrections.md). JSON storage and native collection transfers retain schema v2.

Control protocol messages remain limited to 1 MiB. Request-bearing messages and individual data domains have a 16 MiB data budget plus a 64 KiB envelope allowance; each stored JSON document still has its 16 MiB limit and native import files retain their 10 MiB limit. Per-field and structural limits also apply. Invalid inputs produce diagnostics before preview, execution, and generation; a failed save never declares the current draft clean.

Version 1.2.0 completes folder organization and request variables/path parameters, and loads secondary panels on demand. See the [daily-workflow validation report](docs/audits/2026-10-16-daily-workflows.md). No account, backend, telemetry or cloud service was added.

Version 1.3.0 adds independent request tabs and loads the request editor on demand. Its source validation is recorded in the [request-tab report](docs/audits/2026-10-16-request-tabs.md); installable packaging remains deferred.

The 1.3.0 candidate also includes environments, local `.env` import, offline Postman migration, complete response downloads and local file uploads. The latest source validation is in the [file upload report](docs/audits/2026-10-16-file-uploads.md); earlier audit reports preserve their implementation snapshots.
