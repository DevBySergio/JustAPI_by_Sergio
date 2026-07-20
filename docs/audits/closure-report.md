# JustAPI stabilization closure report

Closure date: 2026-07-20<br>
Audited baseline: `b21b04f1`<br>
Validated source revision: `53717e9558b8a41259c4d191c88408f882b328f0` plus the `1.1.0` release metadata<br>
Manifest/artifact version: `1.1.0`<br>
Decision: **ready to close stabilization and begin a separately scoped capability phase**

## Decision

The stabilization roadmap meets its exit criteria. All 18 audit findings are resolved, including
all 11 High findings. There is no unaccepted Blocker, Critical, or High finding, no unresolved
Lynvo conflict, and no detected credential or dependency leak in the final VSIX.

JustAPI 1.1.0 is ready for release within the support contract in `README.md`. This decision does
not claim support for the deferred capabilities listed below. New product capabilities should be
planned separately so they do not silently broaden this stabilization sign-off.

## Validation environment and command evidence

The complete product gate ran after `npm ci` and after the regression-catalogue status correction.
Only test display names and closure documentation changed afterward; the affected unit and
extension-host suites were rerun on that final test state.

| Item | Evidence | Result |
|---|---|---|
| Host | macOS 26.5.2 (25F84), arm64 | Recorded |
| Runtime | Node.js 22.14.0; npm 10.9.2; lockfile v3 | Recorded |
| Clean dependency install | `npm ci`: 619 packages added, 620 audited | Passed; 0 vulnerabilities |
| Test policy | `npm run test:policy`: 20 TypeScript test/support files | Passed |
| Static checks | zero-warning lint plus strict extension and webview type checks | Passed |
| Unit tests | 94 tests in 10 suites | Passed; 0 failed/skipped/todo |
| Localhost integration | 13 deterministic transport tests | Passed; 0 failed/skipped/todo |
| Extension host | VS Code 1.80.0, 4 activation/command/webview tests | Passed |
| Builds | development and production extension/webview webpack builds | Passed |
| Dependency audits | runtime-only and complete installed graph at `audit-level=low` | Passed; 0 vulnerabilities |
| Package | `npm run vsix` plus the nine-payload allowlist | Passed |
| Complete gate | `npm run validate` | Passed on 2026-07-20 |

The production webview is 321 KiB and webpack emits its three standard performance warnings for
the asset, entrypoint, and code-splitting recommendation. Those warnings are non-functional and
are retained as an explicit residual risk rather than hidden or promoted to a correctness failure.

## Smoke matrix

These results are automated, deterministic smoke evidence. A manual screen-reader pass remains a
recommended follow-up and is not represented as completed.

| Area | Evidence exercised | Result |
|---|---|---|
| Activation and lifecycle | Activation at the declared VS Code floor; open/reveal/close; repeated disposal | Passed |
| Commands | Exact seven-command manifest/registration parity; cold/warm delivery; ready handshake; one-shot acknowledgement; cancellation/error paths | Passed |
| Persistence and reload | v1-to-v2 migration; serialized writes; two-window revision conflicts; locks; atomic rename; backup recovery; read-only failures; shutdown flush; safe webview snapshot restoration | Passed |
| History and search | Redacted bounded summaries; delete/clear; saved and unsaved replay; exact request/history IDs; deduplication; stale-search suppression | Passed |
| Collections | Validated mutations; delete cascade; deep hierarchy/order; failed-commit preservation; schema-v2 import/export round trip | Passed |
| cURL import | Executable recognition; quotes/escapes/continuations; supported options; warnings; preview; cancellation; no shell execution or file reads | Passed |
| Code generation | Seven targets; every method/body combination; target escaping; stable goldens; available parser/compiler checks; placeholder and explicit-reveal paths | Passed |
| Variables and authentication | Scope precedence; nested/cyclic/bounded resolution; all request locations; Bearer/Basic/API-key SecretStorage delivery; conflicts and redaction | Passed |
| HTTP transport | Methods, query/headers, empty/raw/URL-encoded/multipart/binary bodies, redirects, compression, charsets, limits, timings, typed failures | Passed |
| Cancellation and races | Per-execution cancel versus timeout; duplicate operation rejection; superseded operation/execution suppression | Passed |
| Unsaved state | Dirty-baseline comparison, navigation protection, safe persistence omissions, reload warning | Passed |
| Large/binary responses | declared/streamed/decompressed limits; exact base64 bytes; bounded text/JSON/tree; raster MIME and size allowlist; object-URL cleanup | Passed |
| Keyboard/accessibility contracts | roving tabs, arrow/Home/End behavior, focus-managed dialogs/search/tree controls, status roles, polite/assertive announcements | Passed by source and automated contracts; manual assistive-technology review deferred |
| Folder-management UI | create/rename/delete/move/reorder folders and move requests | **Deferred; not tested as supported** |
| Request-variable editor | model/resolver support exists; user-facing request-scope editor does not | **Deferred; not tested as supported** |
| Cookie jar, proxy, certificates, OAuth | outside the stabilized product contract | **Deferred; not tested as supported** |
| Local-file/streaming uploads and shell expansion | cURL file references remain unresolved text; no file reads or shell execution | **Deferred; not tested as supported** |

## Finding reconciliation

| Finding | Closure | Evidence and retained qualification |
|---|---|---|
| JAPI-001 | Resolved | Auth Builder secrets use SecretStorage and derivatives are redacted; protected legacy rollback backups can retain pre-migration plaintext. |
| JAPI-002 | Resolved | Versioned atomic storage, revision/lock conflicts, verified backups, recovery, read-only failure, and disposal flush passed. |
| JAPI-003 | Resolved | Runtime validation, bounds, operation/execution correlation, acknowledgements, stable errors, and stale-result suppression passed. |
| JAPI-004 | Resolved | The bounded non-executing cURL parser and preview/warning flow passed; local files and shell expansion remain unsupported. |
| JAPI-005 | Resolved | One deterministic bounded resolver is shared by preview, execution, and code generation. |
| JAPI-006 | Resolved | Empty, raw, URL-encoded, text multipart, and binary bodies passed byte-level tests; file-valued multipart is deferred. |
| JAPI-007 | Resolved | Redirect, cancellation/timeout, decompression/charset/binary, limits, errors, final URL, and observable timings passed. |
| JAPI-008 | Resolved | Collection mutations and recursive redacted import/export validate and commit transactionally. |
| JAPI-009 | Resolved | Every contributed command is registered and ready-gated with correlated outcomes. |
| JAPI-010 | Resolved | Layered unit, localhost, extension-host, policy, audit, build, package, and CI gates replace the placeholder test; all 24 catalogue entries are active. |
| JAPI-011 | Resolved | History is a redacted summary store capped at 200 entries and a 2 MiB envelope. |
| JAPI-012 | Resolved | Dependencies and generated output are untracked; lock/manifest parity, clean install, zero audits, and package allowlisting passed. |
| JAPI-013 | Resolved | README, CHANGELOG, architecture, audit ledger, and package-facing documentation now distinguish verified behavior from deferred gaps. |
| JAPI-014 | Resolved | Stable-ID history operations and exact, bounded search navigation passed with stale-operation suppression. |
| JAPI-015 | Resolved | Bounded response rendering and exact allowlisted raster-image handling passed. |
| JAPI-016 | Resolved | Seven normalized secret-aware starter-snippet renderers passed goldens and available parser/compiler checks. |
| JAPI-017 | Resolved | API keys work in header and query locations with conflict blocking and redacted final URLs. |
| JAPI-018 | Resolved | Safe state restoration, dirty protection, zero-warning TSX lint, keyboard semantics, focus, and announcements passed automated checks. |

No finding is accepted as unresolved or externally blocked.

## Artifact and scope inspection

Final artifact:

- file: `justapi-1.1.0.vsix`;
- size: 145,311 bytes (141.91 KiB);
- SHA-256: `dac38c9f5c6545bf187a927a0d75aa77a0ce5dcb5bf0b877ed176305b04ac699`;
- archive: 11 ZIP entries, comprising two VSIX metadata entries and nine allowlisted extension payloads;
- manifest: `justapi` 1.1.0, entry point `./dist/extension.js`, VS Code engine `^1.80.0`.

The payload contains only package metadata, README, license, changelog, two media assets, the
minified extension bundle, the minified webview bundle, and its license notice. It contains no
source, tests, source maps, `node_modules`, cache, environment file, audit document, or closure
report. VSCE's expected rewriting of repository-relative README/CHANGELOG links accounts for the
package-copy hash difference from the working files.

Independent scans found zero occurrences in package text for the unmistakable synthetic fixture
marker, PEM private-key headers, GitHub classic-token shapes, AWS access-key shapes, Slack token
shapes, or JWT-shaped values. Git tracks zero paths under `node_modules`, `dist`, `out`, `coverage`,
or `*.vsix`. Historical overclaims remain only as quoted audit-baseline evidence; current public
documentation does not repeat them as supported behavior.

The implementation diff reviewed from `b21b04f1` through the validated revision contains 104
non-generated files: 57 added, 45 modified, and 2 deleted, totaling 16,080 insertions and 2,112
deletions. Changes remain within the approved stabilization, tests, CI, documentation, and
repository-cleanup scope.

## Migration and compatibility notes

- Persisted JSON domains remain extension-global under VS Code `globalStorageUri`; workspace scope
  and synchronization are not introduced.
- Legacy unversioned documents migrate once into schema-v2 envelopes. Writes are serialized,
  locked, revision-checked, fsynced, atomically renamed, and verified. Corrupt or unsupported data
  becomes recoverable/read-only rather than being silently overwritten.
- Migration backups are checksummed and retained through stabilization. Downgrading requires an
  explicit restore of a compatible v1 backup and can reintroduce legacy plaintext credentials.
- History migration intentionally discards bodies, headers, cookies, query values, resolved
  variables, and credentials. That sensitive data cannot be restored from the canonical v2 history
  or its deliberately redacted migration backup.
- Recognized Bearer, valid UTF-8 Basic, and exact `X-API-Key` builder credentials migrate to
  SecretStorage. Ambiguous/custom auth-like values are left as ordinary request data rather than
  guessed. Secret writes are rolled back if request persistence fails.
- The VS Code compatibility floor remains 1.80.0. The manifest, lockfile root, and artifact version
  agree at 1.1.0.

## Accepted residual risks and deferred scope

- The 321 KiB production webview bundle exceeds webpack's recommended 244 KiB threshold. This is a
  performance optimization opportunity, not a correctness or data-safety failure.
- Automated keyboard, focus, roles, and live-region contracts do not replace a manual pass with
  representative screen readers and high-contrast/zoom settings.
- Protected legacy pre-auth migration backups may retain plaintext until a separate retention or
  removal decision is approved. Canonical storage and new derivative artifacts remain redacted.
- Generated code is deliberately a set of starter snippets, not a deployment, retry, streaming,
  observability, or production-hardening guarantee.
- Secrets entered manually in ordinary variables, headers, query fields, or bodies remain ordinary
  user data; only Auth Builder credentials receive SecretStorage lifecycle management.
- Folder-management UI, request-variable editing, workspace storage/sync, persistent cookies,
  proxies, client certificates/OAuth, local-file or streaming uploads, shell-compatible cURL, API
  scripting/testing/runners, scheduling, collaboration, and protocol-specific tooling remain a
  separate capability phase.

These residuals are documented, bounded, and do not leave a Blocker, Critical, or High audit
finding open. The stabilization roadmap may therefore be closed.
