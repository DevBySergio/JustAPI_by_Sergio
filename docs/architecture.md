# JustAPI extension architecture

The extension host is split into composition, protocol, application-service, engine, and
storage layers. The webview provider owns VS Code lifecycle and dependency composition;
application behavior is testable without constructing a VS Code webview.

## Module boundaries

| Boundary | Responsibility | Must not own |
|---|---|---|
| `src/webview/JustAPIWebviewProvider.ts` | Compose dependencies, attach and dispose VS Code listeners, show host UI, and close long-lived resources | Request, collection, history, persistence, or code-generation rules |
| `src/protocol/WebviewProtocol.ts` | Validate inbound/outbound messages, claim operation IDs, correlate execution IDs, acknowledge success, and map failures to stable protocol errors | Product operations or VS Code UI |
| `src/webview/WebviewMessageHandler.ts` | Dispatch the validated message union to one application service and publish the service result | Payload validation, storage formats, HTTP transport, or secret values |
| `src/services/RequestService.ts` | Own one HTTP execution from registration through cancellation, response emission, history recording, and completion | Concrete transport construction outside its injected factory |
| `src/services/RequestPreparationService.ts` | Build variable scope, resolve requests, apply derivative redaction, and produce normalized previews | Persistence implementation or webview state |
| `src/services/CollectionService.ts` | Coordinate collection/request mutations, authentication staging, and validated import/export round trips | File dialogs or editor documents |
| `src/services/HistoryService.ts` | Query, order, create, bound, and delete redacted history summaries | VS Code APIs or request execution |
| `src/services/PersistenceService.ts` | Read and write global variables and settings through narrow data-store ports | Filesystem paths or storage recovery UI |
| `src/services/CodeGenerationService.ts` | Resolve, redact or explicitly disclose, normalize, and generate a selected target language | Credential storage or disclosure UI |
| `src/engine/**` | Deterministic domain logic for HTTP, auth, collections, variables, and parsing | Webview protocol routing |
| `src/storage/**` | Versioned atomic persistence, migration, locking, recovery, and retention transforms | UI workflows |

## Injected boundaries

- Filesystem-backed persistence is exposed to services as `DataStore`; `JsonFileStore` is
  selected only during provider composition.
- Secret access is isolated behind `SecretStorageLike` in `AuthService`.
- HTTP execution is isolated behind `RequestTransport` and an injected transport factory.
- History timestamps and identifiers are injected, so tests do not depend on wall-clock time
  or random UUIDs.
- Credential confirmation and JSON document display are injected functions; only the provider
  calls VS Code window and workspace APIs.

Protocol size limits remain centralized in `MessageValidator`, effective-request normalization
remains centralized in `EffectiveRequest`, and credential redaction remains centralized in
`AuthService` and its shared `CredentialRedaction` helper. Services compose those boundaries instead of reimplementing them.

## Lifecycle ownership

1. The provider creates stores, authentication, application services, the message handler, and
   the router once per extension activation.
2. Each resolved webview replaces and disposes only view-scoped event listeners. The startup
   queue is reset for the new target so pending commands can be redelivered once.
3. `RequestService` owns the execution registry and cancels all active transports on disposal.
4. `WebviewMessageHandler` disposes request execution and the startup queue exactly once from
   the provider's extension-level `dispose()` path.
5. Application queues close to new work and drain accepted transactions before the provider disposes staged secrets and every distinct store, allowing queued writes
   to flush before extension shutdown completes.

The unit suite checks the TypeScript source dependency graph and fails with the complete cycle
path if any relative-import cycle is introduced.

## Runtime and storage boundaries

- Production composes `JsonFileStore` from `ExtensionContext.globalStorageUri`. The optional
  workspace store constructor parameter exists for injected tests/alternate composition only;
  the shipped activation path does not enable workspace-scoped storage.
- Collections, variable sets, redacted history summaries, global variables, and settings use
  schema-v2 JSON envelopes. Auth Builder credential payloads live separately in VS Code
  `SecretStorage`; application services receive only public auth metadata and opaque references.
- HTTP transport accepts bounded HTTP(S) inputs only. It does not own a cookie jar, proxy
  configuration, or local-file reader. cURL import is a parser and never executes shell syntax.
- Folder graphs and request-scoped variables are exposed through the webview with targeted folder creation/rename/cascade deletion and request/folder moves, plus request-variable and path-parameter editors.

The exact user-facing support contract, runtime assumptions, and deferred capabilities are
maintained in [`README.md`](../README.md). Architectural support in an engine or protocol is not
treated as a public UI capability unless the command/webview path and regression coverage prove it.

## Corrective transaction and editor contracts (1.1.1)

- `SerialQueue` protects the entire read-modify-commit transaction in collections, history, and variable sets. CollectionService additionally serializes secret staging with collection mutations; variable-set getters return copies and failed commits never publish their candidate state. Disk locks and cross-window revision checks remain independent safeguards.
- `VariableAutosave`, owned by App, schedules only user edits and retains the latest snapshot until a host acknowledgement. `setCollectionVariables` patches only that domain. Navigation, execution, and code generation await pending saves.
- `requestSaved` acknowledges a submitted snapshot; it does not navigate or overwrite newer editor fields. Mutation acknowledgements/errors are never superseded by queries. Read operations still suppress outdated results.
- Auth Builder changes retain a session-only dirty marker and secret reference until Save. `discardRequestChanges` rolls back staging; webview replacement clears pending staging through the same service queue. No secret value is placed in React stores or persisted webview state.
- Initialization sends each domain followed by `initializationComplete`; readiness is withheld when a domain fails protocol validation. Data-bearing messages have a separate budget from control messages.
- RequestPreparationService combines variable resolution, effective-request URL/header validation, and static authentication conflict checks. The same result feeds preview, execution, and generated examples.

## Daily workflows and deferred panels (1.2.0)

Folder mutations traverse the same queued service/manager transaction as request saving. Moves use a destination index in the array after removal of the source item. Subtree deletion commits the tree and request removals together before releasing saved and staged credentials. The webview guards the active descendant draft and cancels its execution; cross-collection moves update the current request scope without replacing editor text.

Path substitution occurs in `normalizeEffectiveRequest`, after hierarchical variable resolution. Only complete `/:name` path segments are substituted and values are encoded once. Preview, transport and code generation share this operation and the `INVALID_PATH_PARAMETER` preflight diagnostic.

Secondary panels use React lazy imports with loading/error boundaries. Webpack derives chunk URLs from the local entry script and applies its nonce to every injected script. The CSP remains nonce-only; no remote script source is enabled. Build cleanup removes obsolete chunks. Package validation and installed-artifact checks cover all generated JavaScript and license files. A panel load error leaves the request editor and its stored draft available.

## Independent request tabs (1.3.0 candidate)

`useRequestStore` owns request-tab sessions. Each session has a unique tab ID separate from its request ID, its draft/baseline and selected/baseline collection, pending auth metadata, execution ID, response, code and transient status. A cached active projection is updated atomically with the tab array so existing editor selectors remain stable. Responses no longer have a separate singleton store.

App captures the originating tab before asynchronous preparation, tracks load/save/code operations by tab, and routes replies without switching the active tab. Read supersession is scoped by request ID; execution IDs remain independent. Closing awaits pending auth/save work, rolls back staged credentials and removes only that session. Save-and-close retains newer unsaved changes or errors instead of removing a failed draft. Collection mutations reconcile every tab and guard inactive descendants.

Webview cache version 2 stores a bounded list of sanitized drafts/baselines and collection scopes, migrates version 1 and clears pending-auth markers on restoration. It never serializes response/code/execution/promise state. This cache version is separate from persisted collection/storage schema v2, which is unchanged. Recreating the view cancels old host executions before clearing staged authentication.

The primary editor also uses the local deferred-panel boundary. URL user information is redacted through a shared helper across derivatives, cached drafts and history, including incomplete authorities and variable protocols. Recognized query credentials are removed without requiring an executable URL; path/fragment at signs and ordinary URL spelling remain intact.


## Environments and local dotenv import (1.3.0 candidate)

Variable sets may carry additive `kind: "environment"` and `active` fields. Legacy sets keep their shape and linked behavior. Selection and environment CRUD use the existing queued `variableSets` transaction, publish only after durable writes, validate the aggregate domain and allow at most one active environment. Environment edits carry their last committed timestamp; a concurrent edit/selection/import rejects stale snapshots. The storage envelope remains schema v2.

Resolution precedence is Global < linked shared sets < active environment < Collection < Request. Unselected environments never contribute variables. RequestService captures an immutable set snapshot before asynchronous preflight and transport preparation, so later selection/editing cannot mix environment values within that execution. Preview, HTTP and generated snippets share the same resolver; the webview awaits accepted environment mutations before dependent actions.

EnvironmentFileService receives the native file-picker adapter, reads only a selected regular UTF-8 file through a bounded descriptor read, and stages a content digest plus target revision. Confirmation checks reviewed bytes and the target revision; concurrent replay cannot import the same preview twice. EnvParser implements literal, bounded assignments with value-free line diagnostics; no shell or process environment expansion occurs. Native collection export remains unchanged and does not include environments.

Optional file watching polls only the selected path, supports atomic replacements and emits a new preview rather than modifying stored variables. Watched paths, up to 20 staged previews and their values remain host-session data. Stop, deletion and view recreation release these resources. Watch creation failures report a notice while retaining a successful import. No file write or HTTP send is triggered by watching.

The lazy environment panel retains unsaved drafts in the variable store across navigation, with Save/Discard and optimistic conflict handling. Values are masked by default. The webview cache stores only a pending-edit boolean for a reload warning, never environment drafts, import previews, watched paths or resolved values. Committed environment values are ordinary local JSON data; Auth Builder remains the SecretStorage boundary.

## Offline Postman migration

`PostmanParser` converts bounded v2.1 collections and environment exports into native models, generating local IDs and preserving folder order. It reports omissions with source-index locations and never executes scripts or resolves linked files. Unsupported requests are excluded whole. Recognized helper/header/URL credentials are held separately as host-only AuthInput values; secret environment variables are reported and excluded because ordinary variables are not SecretStorage-backed.

`PostmanImportService` opens only a host-picked local regular file, retains one bounded staged document, and sends a counts/diagnostics-only preview. Confirmation requires explicit warning consent and a fresh SHA-256 match; duplicate confirmations, obsolete picker results, cancellation and view reset are guarded. Collections use the existing serialized import transaction and AuthService secret rollback. Environments use the variable-set transaction and start inactive. Mutation results publish domains without loading another request or replacing drafts. No Postman account, API request or background import is involved.

The lazy webview preview stays outside persisted workspace state. AuthService can resolve stored credential templates through a supplied value resolver; request preparation supplies the captured variable context. Authorized code generation captures the same context through preflight and credential resolution. Default derivatives still use placeholders.

## Complete response downloads

`HttpClient.takeResponseBody()` transfers the full decompressed Buffer before charset decoding or base64 preview conversion. `RequestService` registers only complete, uncancelled responses with `ResponseDownloadService`, emits a random response ID/availability flag and invalidates previous IDs on resend. Transport/decompression/limit errors never register a body. The optional transport method preserves existing test/factory injection without reconstructing bytes from text.

`ResponseDownloadService` owns a session-only, bounded cache (100 MiB, 20 entries, one current body per request). It evicts the oldest retained body, refreshes recency after a save, and reports released IDs to all response tabs. A native save callback is the only destination boundary: webview messages carry no path or body. Suggested names use a fixed MIME/type mapping. Saves create a private sibling file, write/fsync/close it, recheck response identity/generation and atomically rename. Failed writes clean up the temporary file and retain the original body for retry. The cache is cleared on view reset/disposal and tab-close messages release individual bodies.

Only one native save operation is allowed at a time. A dialog does not pin body bytes; after selection the body must still exist in the same generation. An in-progress write can temporarily pin one body in addition to the bounded cache. Closing, replacement, eviction or reset before commit prevents replacement. Once atomic replacement commits, the user-selected file is independent of the session cache. No body is implicitly exported or copied into profile storage.

Each request tab explicitly initializes its download state, preventing a prior active projection from leaking status into an untouched tab. Replies are checked against both operation and response ID; newer responses/closed tabs ignore old replies. Availability releases update inactive tabs atomically. Save-dialog acknowledgements have no artificial 30-second timeout, while other operations retain the existing timeout. `ResponseViewer` stays deferred and explains complete-byte downloads separately from text/image/JSON preview caps.

## Local file uploads

`RequestFileService` is the sole path-to-bytes authority. A native local chooser yields a host-only real path; the service opens a regular file with no-follow/nonblocking flags, checks its bounded size and stable descriptor metadata, and hashes its bytes. Only an opaque ID, basename, size and mtime reach the webview. IDs are bound to the owning request and this service generation. Native dialogs use no artificial 30-second ACK timeout. Picker slot revisions are globally monotonic, preventing stale responses even when intermediate selections have already completed. Close/reset invalidates grants and outstanding picker slots.

The model adds `body.binarySource = 'file'`/`body.file` for raw bytes and `body.files` for multipart file fields alongside the existing text `formData`. Legacy binary literal content retains UTF-8 semantics. Variables apply to file field names and MIME settings, never to filenames, paths or bytes. Effective-request validation handles missing parts/MIME/file-count/declared aggregate size; preparation checks request-bound grants and file metadata. Transport reopens and verifies metadata/hash immediately before building the body, so changes after preflight still fail without connecting.

`HttpClient` awaits its injected file reader, checking cancellation before/after each read and before opening the first hop. Raw files are Buffers; multipart writes text parts followed by file parts, escaped Content-Disposition parameters, per-file MIME and a matching generated boundary. Boundary collisions and complete bodies over 25 MiB fail before connection. Redirects reuse captured payload bytes for 307/308 and drop them for the existing 303 policy. Per-file reads are bounded to 10 MiB; up to 20 file rows/1000 grants per view prevent unbounded metadata growth. Streaming is outside this increment.

`CollectionService` strips file references for imports/exports and strips expired/foreign grants when opening saved requests. Local persistence may retain opaque metadata, but no path or content; those metadata alone cannot authorize a read in another session/request. `WebviewState` removes all selection metadata from current/baseline draft caches and marks the restored workspace for a notice. Each tab owns picker operations/results/errors; editing a request invalidates older picker responses. Saving/sending/previews wait for ordinary variable/auth coordination and block while that tab has a pending file selection.

File-specific code recipes share effective request semantics and preserve default credential redaction. They request replacement files or show explicit placeholders, without serializing host paths, grants or bytes. Browser TLS and Java TLS limitations remain explicit in the relevant examples. HTTP upload tests compare buffers rather than strings; generated curl/JavaScript recipes are also exercised against loopback.
