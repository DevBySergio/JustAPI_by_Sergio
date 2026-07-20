# Change Log

All notable changes to JustAPI are documented in this file.

## Unreleased — stabilization

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
