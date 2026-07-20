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
`AuthService`. Services compose those boundaries instead of reimplementing them.

## Lifecycle ownership

1. The provider creates stores, authentication, application services, the message handler, and
   the router once per extension activation.
2. Each resolved webview replaces and disposes only view-scoped event listeners. The startup
   queue is reset for the new target so pending commands can be redelivered once.
3. `RequestService` owns the execution registry and cancels all active transports on disposal.
4. `WebviewMessageHandler` disposes request execution and the startup queue exactly once from
   the provider's extension-level `dispose()` path.
5. The provider then disposes staged secrets and every distinct store, allowing queued writes
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
- Folder graphs and request-scoped variables are valid domain data, but the webview currently
  exposes neither folder-management actions nor a request-variable editor.

The exact user-facing support contract, runtime assumptions, and deferred capabilities are
maintained in [`README.md`](../README.md). Architectural support in an engine or protocol is not
treated as a public UI capability unless the command/webview path and regression coverage prove it.
