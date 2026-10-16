# Change Log

All notable changes to JustAPI are documented in this file.

## [1.2.0] - 2026-10-16

### Added

- Folder creation, nested creation, renaming and confirmed cascade deletion from the collection panel.
- Keyboard-accessible folder/request moves between collections and folders, destination position selection, and sibling ordering controls.
- Request-variable editing with explicit precedence and normal draft/save behavior.
- Path parameter editing using complete `/:name` segments, with shared substitution and encoding in preview, transport and every code target.

### Changed

- Load secondary panels and response rendering on demand, propagating the webview script nonce to local chunks and preserving drafts on panel-load failures.
- Verify every emitted webview chunk in package inventory and installed VSIX byte comparisons.

### Fixed

- Protect unsaved descendant requests and cancel active executions before deleting their folder; follow the current request's collection when it moves.
- Release pending as well as saved credentials after successful request/subtree deletion; retain both if persistence fails.
- Drop obsolete variable previews after editing and flush pending scope/auth changes before previewing.

## [1.1.1] - 2026-10-16

### Fixed

- Prevented transport from starting after cancellation or disposal during asynchronous request preparation.
- Serialized complete collection, history, and variable-set transactions; preserved folder/order on request updates and committed in-memory state only after durable writes.
- Replaced variable autosave effects with an App-owned, acknowledgement-based coordinator; pending edits survive panel changes and failures, and collection-variable writes no longer replace whole collection snapshots.
- Kept authentication changes pending until Save, including same-type token replacement; discard and webview recreation clear pending credentials.
- Redacted URL credentials consistently and restored explicitly exported credentials into the importing SecretStorage. Saved collection exports use committed credentials.
- Preserved imported cURL encoded bodies, explicit/default content types, and redirect flags; corrected IPv6 literal destinations and HEAD/204/205/304 metadata handling.
- Added data-specific protocol budgets and separate initial-domain delivery; shared request preflight across preview, sending, and generation.
- Preserved newer editor changes while acknowledging an older save and ignored execution results after changing requests.

### Validation and maintenance

- Added service, transport, and real React component regressions; included webview test compilation and test policy in CI.
- Added isolated VSIX installation and execution checks on minimum and stable VS Code, with bundle byte comparisons.
- Updated development tooling and compatible transitive dependencies; dependency audit returned zero advisories on 2026-10-16.
- Documented the prioritized local-client roadmap without adding its deferred product capabilities.

## [1.1.0] - 2026-07-20

### Changed

- Corrected the public capability contract and documented all active commands, startup delivery, storage scope/schema, recovery behavior, validation limits, and generated-code runtime assumptions.
- Clarified that production storage is extension-global rather than workspace-scoped and that user-initiated HTTP requests send data to their configured destinations.
- Described code generation as reviewed starter snippets with credential placeholders by default.
- Limited history to redacted summaries and made collection JSON exports credential-redacted by default.

### Fixed

- Added runtime-validated, operation-correlated webview messaging and ready-gated command delivery for all seven contributed commands.
- Added versioned atomic storage, verified backups, legacy migration, corruption recovery, revision conflict detection, and shutdown flushing.
- Moved Auth Builder credentials to VS Code SecretStorage and added explicit one-time disclosure for credential-bearing derivatives.
- Corrected variable precedence/bounds, multipart and URL-encoded bodies, redirects, cancellation, decompression, response limits, collection transactions, cURL parsing, search/history behavior, binary/image rendering, and code generation.
- Split the provider into protocol, application-service, engine, and storage boundaries with deterministic tests.

### Deferred

- Folder-management UI, request-variable editing, workspace-scoped storage, cookie jars, proxies, local-file/streaming uploads, and automatic cURL `@file` reads are not supported.

## [0.0.1] - 2026-05-17

### Added

- HTTP request editing for GET, POST, PUT, PATCH, DELETE, OPTIONS, and HEAD.
- Collections, saved requests, JSON import/export, cURL import, four-scope variable resolution, Auth Builder, response inspection, history summaries, search, and seven code-snippet targets.
- Seven Command Palette contributions and two keyboard shortcuts.
- Local extension storage with no account, telemetry, or cloud-sync integration. User-initiated requests still communicate with their configured HTTP(S) targets.

The current supported behavior and known capability gaps are defined in [README.md](README.md); this historical entry does not expand that contract.
