# Validation and testing

JustAPI uses deterministic local fixtures. The automated suites never call a live third-party API and the HTTP integration suite binds to an ephemeral `127.0.0.1` port.

## Prerequisites

- Node.js 22.14.0 and npm 10 or newer.
- VS Code extension-host tests download and run the declared minimum VS Code version, 1.80.0.
- Linux needs a display server; CI runs the extension suite with `xvfb-run`. macOS and Windows can run it directly.

Install exactly the locked dependency graph, then validate without creating an installable archive:

```sh
npm ci
npm run validate:source
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run test:policy` | Rejects focused, skipped, or suppressed tests. |
| `npm run test:unit` | Compiles and runs pure unit and fixture-contract tests. |
| `npm run test:integration` | Exercises the HTTP client against a localhost fixture server. |
| `npm run test:webview` | Compiles and runs real React components with Testing Library and jsdom 28 on Node 22.14. |
| `npm run test:packaged` | Installs the built VSIX in temporary profiles and runs extension-host tests on 1.80.0 and stable, checking installed bundle bytes. |
| `npm run test:extension` | Activates the extension, validates commands, and exercises its webview lifecycle. |
| `npm run lint` | Lints extension and webview TypeScript with zero warnings allowed. |
| `npm run typecheck:extension` | Strictly type-checks the extension and tests. |
| `npm run typecheck:webview` | Strictly type-checks the React webview. |
| `npm run validate:static` | Runs policy, lint, both type-checks, Node suites, build, and both audits. |
| `npm run validate:source` | Runs static validation, source extension-host tests, production build and package inventory without creating a VSIX. |
| `npm run validate` | Adds extension-host tests, VSIX creation, package-content validation, and isolated packaged-extension tests. |

The regression catalogue labels implemented checks as `active`. A `contract` fixture records the required behavior and owning remediation task without pretending that unfinished product behavior passes. Owners promote those fixtures to active tests as their implementation lands.

## CI contract

The GitHub Actions workflow installs with `npm ci`, caches only npm's download cache, runs the complete static gate, runs extension tests under Xvfb, creates the VSIX, validates its allowlist, and uploads the package. Generated output and `node_modules` are never restored as caches or committed artifacts.

## Packaged extension checks

After `npm run vsix`, run `npm run test:packaged`. The script uses a fresh temporary profile and extensions directory for each VS Code version, installs the VSIX, compares the installed host bundle and every generated webview chunk/license with the verified build, and executes the extension-host suite against the installed files. User profiles and installed extensions are untouched. Test profiles are removed afterward; downloaded VS Code runtimes remain in the ignored `.vscode-test` cache. Pass version arguments directly to `node scripts/test-packaged.mjs` to select a subset.

The minimum-version and stable-version package runs require a desktop display (Xvfb on CI). Runtime downloads use Microsoft's update service; security audits use npm. Product tests send synthetic data only to ephemeral IPv4/IPv6 loopback servers. jsdom component tests prove interaction/state contracts, not visual rendering or manual assistive-technology accessibility.

## Daily workflows (1.2.0)

`dailyWorkflows.test.ts` covers nested folder moves/reordering and subsequent saves, concurrent targeted mutations, reloads, descendant rejection, disk failure rollback, saved/pending credential cleanup, correlated folder protocol operations, path encoding and consistent preflight/code generation. The localhost integration suite verifies actual path bytes. React tests exercise folder forms and failed-write retry, valid destinations, moving the current request scope, deleting a dirty descendant with active execution, editing/saving/sending request variables and path parameters, and rejecting obsolete previews. Tests wait for deferred panels to finish loading before interacting.

Package inventory and installed VSIX checks include every generated webview chunk and license file. The local browser smoke review uses synthetic data, production assets and the generated nonce-only CSP; it is separate from VS Code extension-host tests and does not claim a screen-reader or cross-platform manual review.

## Request tabs (1.3.0 candidate)

Use `npm run validate:source` while installable packaging is deferred. `requestWorkspace.test.ts` checks multiple-draft cache migration, validation/redaction/bounds, formatting preservation, scoped read correlation, independent host cancellation and view recreation. React tests cover concurrent out-of-order responses, background authentication/preparation, inactive save reconciliation, close/save/discard failures, separate saved-request loads and retries, close/reopen stale replies, inactive descendant deletion, multi-draft restoration, generated-code ownership, keyboard control and the tab limit. No new VSIX is required for these checks.

`urlRedaction.test.ts` covers incomplete and templated URL authorities/query credentials across default derivatives, cached drafts and history. The 1.3.0 candidate passes 122 unit, 17 HTTP and 31 React tests, plus six source-host tests on each of VS Code 1.80.0 and 1.142.0. Packaging and the installed-artifact matrix remain the final deferred release step. See the [candidate evidence](audits/2026-10-16-request-tabs.md).


## Environments and dotenv (1.3.0 candidate)

`environments.test.ts` exercises literal parsing/quoting/limits, diagnostics without values, legacy shared-set behavior, active selection and precedence, concurrency and disk rollback, stale edits, captured request contexts, preview/confirm/cancel/replay, reviewed-file changes, malformed UTF-8, actual atomic file replacement watching and stop/reset cleanup. It also covers empty files and reload warnings without serializing environment edits.

`environments.integration.test.ts` runs the normal preparation/transport pipeline against localhost: changing selection between preflight and transport keeps the original environment in the received query, headers and body. Generated code uses the newly selected environment and redacts recognized credentials. Component tests cover selection acknowledgements/failures while sending, masked confirmation, invalid/cancelled imports, retained drafts across navigation and failed saves, watcher previews and explicit stopping.

The current source gate passes 134 unit, 18 HTTP and 37 component tests (189 total), plus six source-host tests on each of VS Code 1.80.0 and 1.142.0. The production browser check uses synthetic data and the generated nonce-only CSP at 320px; it is distinct from installed-extension or screen-reader validation. No VSIX is generated for this increment. See [environment implementation evidence](audits/2026-10-16-environments.md).

The actual extension-host environment test also reads/confirms a temporary `.env`, starts/stops its watcher, creates a collection and parses cURL. It reproduced the missing browser-crypto global on VS Code 1.80; host callers now inject Node UUIDs into shared model factories.

## Postman migration increment

The next source snapshot is recorded in [offline Postman migration](audits/2026-10-16-postman-import.md). Unit tests exercise nested conversion, auth inheritance, redaction markers, unsupported request exclusion, environment flags/secrets, bounds, changed files, duplicate confirmation, canceled/reset/stale pickers and secret rollback/retry on disk failure. A real HTTP integration migrates both export types through filesystem/storage and checks body/query/auth bytes, credential template resolution, missing-template rejection and default-redacted versus authorized code. React tests cover consent, stale preview replacement, acknowledgement ownership, failed-import retry, cancellation, both entry points and preservation of drafts/cache boundaries. The actual extension runtime imports both kinds and resolves protected credentials at the declared engine floor and stable. VSIX installation validation remains deferred until packaging is explicitly requested.

## Response download increment

The current source snapshot is recorded in [complete response downloads](audits/2026-10-16-response-downloads.md). Eight unit tests exercise exact binary/text/empty writes, explicit overwrite, cancellation, disk-failure retry, budget eviction, release/reset during picker and before commit, safe names and strict protocol shapes. Two real HTTP tests cover original charset/BOM bytes, large truncated previews, all byte values/images, gzip/deflate/Brotli, 500/204/HEAD, size/decompression/partial failures, live cancellation and cache release without additional HTTP calls. Six React tests cover ID-only save messages, cancel/failure/retry, pending state across tab navigation, expiration, closing/replacing a response and stale save results. The actual VS Code runtime also downloads a non-UTF-8 HTTP response and compares the saved bytes. Run the full source gate and stable-host suite; creating/installing a VSIX remains pending explicit authorization.

## Local file upload increment

See [file upload evidence](audits/2026-10-16-file-uploads.md). Seven unit tests cover request-bound grants, file identity/digest checks, empty/exact-limit/oversized files, directories/symlinks, stale picker revisions/reset/close, metadata stripping, protocol validation, active versus dormant body templates, variable/MIME handling and seven snippet targets. JavaScript/TypeScript syntax, Python AST, shell syntax and Java compilation are checked locally; Go structure is checked when its formatter is unavailable, and no C# compilation is claimed.

Six real HTTP tests compare raw/multipart bytes and lengths, MIME/boundaries, repeated/disabled fields, redirects, full preparation/persistence/export/import, missing/changed/forged/expired selections, cancellation before connection, aggregate-size/boundary failures and generated curl/browser JavaScript recipes. Five React tests exercise the actual App with asynchronous picker replies, cache redaction, multipart editing, tab ownership, invalidation after editing/removing/closing, cancellation, failure/retry and blocking sends during selection. An additional actual extension-runtime test selects a temporary file and sends binary/multipart bytes on both supported VS Code test versions. Native OS chooser interaction is supplied through its callback boundary in automated tests; no manual chooser/accessibility certification is implied. No VSIX is created by the source-only gate.
