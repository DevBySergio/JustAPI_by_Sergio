# Local API client roadmap

Status: the first two daily-workflow items ship in 1.2.0; independent request tabs are prepared in the working tree for 1.3.0, with source validation complete and installable packaging deferred. Remaining capabilities are proposed. The baseline is the [Postman VS Code extension](https://learning.postman.com/docs/reference/vs-code-extension/overview/), rather than every Postman desktop/cloud product.

## 1. Complete daily workflows

| Capability | Existing foundation | Intended acceptance |
|---|---|---|
| Folder CRUD, moves, and ordering — implemented 1.2.0 | Targeted queued mutations, cascade deletion, nested import/export | Native buttons/forms support keyboard and pointer; IDs and exact sibling order survive moves, saves and reloads. |
| Request variables and path parameters — implemented 1.2.0 | Draft editors, hierarchical resolver, normalized HTTP pipeline | Scope/precedence are explained; complete `/:name` segments substitute and encode consistently in preview, transport and all code targets. |
| Multiple request tabs — implemented, 1.3.0 candidate | Request-owned workspace state, scoped correlations and execution registry | Separate drafts/responses/scopes/auth/code; save/discard/close protection; independent cancellation; sanitized multi-draft restoration. No new VSIX created. |
| Environment selection and `.env` import | Reusable linked variable sets | Explicit active environment, local import preview, opt-in file watching, no automatic secret export. |
| Postman v2.1 collection/environment import | Validated native v2 transfer | Migration preview reports unsupported elements; credentials enter local SecretStorage; no Postman account/API is required. |
| Response downloads | Exact text/base64 transport and bounded viewer | User-selected local destination, exact binary bytes, clear distinction between preview limits and downloaded content. |

## 2. Expand HTTP capabilities

Prioritize actual binary/file-valued multipart uploads, a local cookie jar, proxy configuration, custom CA/client certificates, and OAuth 2.0 with PKCE. Reuse SecretStorage and the normalized-request pipeline; local file access must be explicit. Add a redacted diagnostic console and improve response search/inspection. Measure startup and large collections/responses before choosing lazy loading, indexing, or virtualization changes.

## 3. Automation and additional protocols

Add isolated pre-request/post-response scripts and a collection runner with JSON/CSV data, cancellation, bounded resources, and exportable results. Then expose a local CLI and dedicated WebSocket/gRPC clients and GraphQL tooling. Script execution needs an explicit capability model and isolation boundary; it must not silently gain filesystem access, install packages, or become arbitrary extension-host code execution.

## Product constraints

No mandatory account, service backend, cloud sync, telemetry integration, or remote execution service. Network access remains explicit through configured API operations. Storage stays per VS Code profile until workspace storage is separately designed. File/Git sharing can provide an optional local alternative to cloud collaboration; it is not included in the current release. Each roadmap item needs its own implementation scope and acceptance tests before development.

Performance: 1.2.0 loads secondary panels and response rendering on demand; its initial production JavaScript fell from 335 KiB before splitting to 262 KiB. The 1.3.0 candidate also defers the request editor and reduces its entry from about 270 to 252 KiB during final review. Two webpack size recommendations remain visible. No measured startup-time or total-package improvement is claimed. Large-collection virtualization/indexing and response benchmarks remain future work. See the [1.2.0 evidence](audits/2026-10-16-daily-workflows.md) and [1.3.0 candidate evidence](audits/2026-10-16-request-tabs.md).
