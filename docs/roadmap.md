# Local API client roadmap

Status: the first two daily-workflow items ship in 1.2.0; independent request tabs, environments, local `.env` import, offline Postman migration, response downloads and local file uploads are prepared in the working tree for 1.3.0, with source validation complete and installable packaging deferred. Remaining capabilities are proposed. The baseline is the [Postman VS Code extension](https://learning.postman.com/docs/reference/vs-code-extension/overview/), rather than every Postman desktop/cloud product.

## 1. Complete daily workflows

| Capability | Existing foundation | Intended acceptance |
|---|---|---|
| Folder CRUD, moves, and ordering — implemented 1.2.0 | Targeted queued mutations, cascade deletion, nested import/export | Native buttons/forms support keyboard and pointer; IDs and exact sibling order survive moves, saves and reloads. |
| Request variables and path parameters — implemented 1.2.0 | Draft editors, hierarchical resolver, normalized HTTP pipeline | Scope/precedence are explained; complete `/:name` segments substitute and encode consistently in preview, transport and all code targets. |
| Multiple request tabs — implemented, 1.3.0 candidate | Request-owned workspace state, scoped correlations and execution registry | Separate drafts/responses/scopes/auth/code; save/discard/close protection; independent cancellation; sanitized multi-draft restoration. No new VSIX created. |
| Environment selection and `.env` import — implemented, 1.3.0 candidate | Existing shared sets plus explicit environment metadata | Profile-wide active selection; masked local import preview; confirmed session-only file watching; pinned in-flight resolution; no automatic environment export. |
| Postman v2.1 collection/environment import — implemented, 1.3.0 candidate | Validated native v2 transfer and staged local files | Value-free migration preview, explicit acceptance of omissions, supported nested HTTP conversion, SecretStorage-backed auth, inactive environments, changed-file/replay guards and persistence rollback. Unsupported requests and secret environment variables are reported as exclusions. |
| Response downloads — implemented, 1.3.0 candidate | Complete host-side entity bytes and bounded viewer | Local save dialog, exact binary/encoded-text bytes after decompression, atomic overwrite/retry, cancellation, response-owned pending/results, bounded retention and explicit expiration. Viewer limits do not truncate files. |

## 2. Expand HTTP capabilities

Binary/file-valued multipart uploads are implemented in the 1.3.0 source candidate: native file selection, exact binary bytes, mixed/repeated fields, per-part MIME, bounded bodies, changed-file checks and session-only access grants; reload/import/duplicate requires reselection. See the [upload evidence](audits/2026-10-16-file-uploads.md).

Next prioritize a local cookie jar, proxy configuration, custom CA/client certificates, and OAuth 2.0 with PKCE. Reuse SecretStorage and the normalized-request pipeline; local file access must be explicit. Add a redacted diagnostic console and improve response search/inspection. Measure startup and large collections/responses before choosing lazy loading, indexing, or virtualization changes.

## 3. Automation and additional protocols

Add isolated pre-request/post-response scripts and a collection runner with JSON/CSV data, cancellation, bounded resources, and exportable results. Then expose a local CLI and dedicated WebSocket/gRPC clients and GraphQL tooling. Script execution needs an explicit capability model and isolation boundary; it must not silently gain filesystem access, install packages, or become arbitrary extension-host code execution.

## Product constraints

No mandatory account, service backend, cloud sync, telemetry integration, or remote execution service. Network access remains explicit through configured API operations. Storage stays per VS Code profile until workspace storage is separately designed. File/Git sharing can provide an optional local alternative to cloud collaboration; it is not included in the current release. Each roadmap item needs its own implementation scope and acceptance tests before development.

Performance: 1.2.0 loads secondary panels and response rendering on demand; its initial production JavaScript fell from 335 KiB before splitting to 262 KiB. The 1.3.0 candidate also defers the request editor and reduces its entry from about 270 to 252 KiB during final review. With the environment increment the initial script is about 257 KiB; adding the deferred Postman preview brings it to about 259 KiB and response download metadata/state brings it to about 261 KiB. Two webpack size recommendations remain visible. No measured startup-time or total-package improvement is claimed. Large-collection virtualization/indexing and response benchmarks remain future work. See the [1.2.0 evidence](audits/2026-10-16-daily-workflows.md) and [1.3.0 candidate evidence](audits/2026-10-16-request-tabs.md).

Environment implementation and validation: [local environments and dotenv](audits/2026-10-16-environments.md). Postman migration implementation and validation: [offline migration](audits/2026-10-16-postman-import.md). Response download implementation and validation: [complete response bodies](audits/2026-10-16-response-downloads.md). The daily-workflow capabilities in phase 1 are implemented in the source candidate. The first phase-2 increment, binary/file-valued multipart uploads, is also implemented. The next proposed increment is the local cookie jar; packaged installation checks remain deferred.
