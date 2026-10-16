# Local binary and multipart uploads — 1.3.0 candidate

Date: 2026-10-16. This is the first phase-2 increment after response downloads. Earlier tab/environment/Postman/download changes are preserved. No installable VSIX has been created; version 1.3.0 remains a source candidate pending the user's final packaging instruction.

## Delivered behavior

- **Body → Binary** selects a local regular file and sends its bytes without UTF-8 conversion. Empty files, all byte values, BOM and line endings are supported. Existing binary literal bodies retain their UTF-8 behavior. The optional file MIME type defaults to `application/octet-stream`; an explicit request Content-Type can override the raw body default.
- **Body → Form Data** combines existing text fields with up to 20 file rows. Each file row has a name, enable switch, local chooser, optional MIME type and Remove. Multiple files may use the same field name. Text parts precede file parts; inactive/unnamed file rows are omitted. Content-Disposition parameters are escaped and the generated boundary matches the transport Content-Type, following [RFC 7578](https://www.rfc-editor.org/rfc/rfc7578.html#section-4.2). MIME settings accept type/subtype tokens without parameters. Total multipart bytes, including framing, are limited to 25 MiB; each file is limited to 10 MiB. Uploads are buffered, not streamed.
- Only the native chooser can authorize a path. `RequestFileService` keeps real paths and file identity/hash in host memory, while the webview receives an opaque request-bound ID, safe basename, size and mtime. It checks regular-file status, size, descriptor identity and SHA-256 before supplying bytes; changed/deleted/replaced files require explicit reselection. Directories and oversized files are rejected. Explicitly chosen symlinks resolve once; later replacement symlinks cannot substitute another source.
- File grants are per request and view session, bounded to 1000 selections. Closing a tab/resetting the view invalidates its grants and pending selectors. Local saved request metadata alone cannot authorize reading a file in another request/session. Cache restoration, native import/export and duplicate-request opening remove file selections while preserving field/MIME configuration. Paths and contents never enter collections, cache, exports or code recipes. Postman migration still reports linked-file requests as unsupported; it does not read paths from foreign exports. cURL import still does not automatically expand `@file`.
- Pending picker operations and results belong to their original tab/field. Navigation preserves ownership; editing/removing a field, changing its request/body or closing the tab invalidates old replies. Save/send/previews/code generation block while that tab has a pending picker. Cancellation preserves the prior selection; errors permit retry. Picker ACKs have no artificial 30-second timeout.
- All seven code targets provide file recipes. JavaScript/TypeScript use browser file inputs and an explicit Send button; Python/curl/C#/Java/Go use `<LOCAL_FILE_n>` placeholders. They retain credential redaction and do not embed selected paths, grants or contents. cURL uses explicit disposition headers when a field name contains `=` rather than parsing it as a name/value separator. Browser TLS limitations and Java's retained JVM verification are explicitly noted for `verifySSL=false`.

## Permanent regression evidence

| Reproduction / risk | Correction and check |
|---|---|
| Binary input converted through a string | Host buffers and a transport reader injection preserve raw bytes. Unit, real HTTP and actual VS Code runtime tests compare original buffers, including empty bodies and all byte values. |
| Multipart fields lose file data or repeated names | Separate file parts retain name/filename/MIME and original buffers. HTTP assertions compare the complete mixed payload and declared Content-Length; disabled parts are omitted. |
| Forged webview paths or request-ID reuse | Strict ID/metadata-only protocol, request-bound grant matching, metadata equality and no arbitrary path read API. Tests forge metadata/IDs and assert no connection. |
| File changes between selection/preflight/send | Stable descriptor fingerprint plus digest is recorded at selection and rechecked on read. Preparation rejects stale metadata; direct transport race fixtures reject changed bytes before connecting. |
| Cancellation during asynchronous file reading | Check the active abort state before and after every read and before the first hop. A suspended reader is cancelled and resumed; the server receives no connection/request. |
| Boundary conflict or body over the cap | Detect content collisions and actual framed size before connecting. Fixtures check boundary collisions, declared aggregate overflow and matching request Content-Type. |
| Redirects re-open or corrupt the selected file | Build once and reuse the captured payload through redirects. HTTP fixtures verify 307 preserves bytes and 303 drops body and body headers. |
| Late picker replaces newer state or recreates a removed field | Session generation and monotonically increasing slot revisions suppress older host results; tab/operation/field checks suppress older UI replies. Tests include overlapping first/second/third revisions, reset/close, tab navigation and field deletion/editing. |
| Selection survives export/reload/duplication unexpectedly | Strip references at import/export/cache boundaries, and filter expired/foreign grants when opening saved requests. Tests exercise real persistence and import/export, cache sanitation and request/session changes. |
| Dormant form fields or MIME variables block a newly selected body | Resolve only fields used by the active body mode. Added a regression for file/text/form transitions; updated the older multipart assertion to retain dormant raw content, with its existing active-JSON assertion preserved. |
| Generated recipes silently alter file bytes | Execute generated curl and browser JavaScript recipes against loopback and inspect binary/multipart buffers. cURL includes `=` field names and multiline text. Seven-target recipes contain neither selected IDs nor paths. |

New checks: seven unit tests (`src/test/unit/fileUploads.test.ts`), six HTTP tests (`src/test/integration/fileUploads.integration.test.ts`), five React tests (`webview-ui/test/fileUploads.test.tsx`), one additional extension-host test and the amended existing variable-resolution regression. An early import/export fixture incorrectly tried to import duplicate IDs into the same collection store; it now removes the original fixture before reimporting. Early UI assertions were corrected for accessible tab labels, dirty markers and the editor returning to Headers on tab navigation. No production behavior or test policy was weakened to accommodate those assertion errors.

## Final validation

`npm run validate:source`, Node 22.14.0, macOS arm64, 2026-10-16:

| Check | Result |
|---|---|
| Test policy, lint and strict host/webview type checks | Passed; 42 TypeScript test files, no suppressed/skipped checks or lint warnings |
| Unit tests | 161 passed |
| Real HTTP integration | 27 passed |
| React component/state suite | 52 passed; no React act warnings |
| Source extension host, VS Code 1.80.0 | 9 passed |
| Source extension host, VS Code 1.142.0 with a fresh temporary profile/extensions directory | 9 passed |
| Runtime and full npm dependency audits | 0 vulnerabilities |
| Production compilation and inventory | Passed; 23 allowlisted payload files, 15 local webview scripts |
| Initial production webview script | 270,545 bytes (about 264 KiB); two webpack size recommendations remain |
| Narrow visual check | Actual production chunks at 320 px: root/body width 320, file fieldset fits, no console warnings/errors or CSP violation; native-host replies supplied by a local fixture |
| VSIX creation / installed-package validation | Deferred by explicit user instruction |

The narrow visual check is an actual browser rendering of the production UI with a synthetic chooser reply. Automated filesystem/HTTP/runtime checks supply the native picker callback with temporary local files. Manual OS-dialog interaction, assistive-technology certification, C# compilation and Go compilation are not claimed. JavaScript/TypeScript syntax, Python AST, shell syntax and Java compilation pass; Go recipe structure is checked because `gofmt` is not installed. The stable VS Code host still emits the existing `DEP0169 url.parse()` deprecation notice; its stack origin remains untraced and the warning is not suppressed. The dependency audits remain clean.

Logs: `/private/tmp/justapi-file-uploads-validation.log` (exit 0) and `/private/tmp/justapi-file-uploads-stable.log` (exit 0). Earlier focused diagnostic logs are not the final validation gate. Visual evidence: [320 px upload editor](assets/file-uploads-320.png).

Only the existing 1.1.0 and 1.2.0 VSIX archives remain, with unchanged SHA-256 values:

- `justapi-1.1.0.vsix`: `dac38c9f5c6545bf187a927a0d75aa77a0ce5dcb5bf0b877ed176305b04ac699`
- `justapi-1.2.0.vsix`: `451992143a555363e2a1957c2191045a6a1ab9f664d351604bddca05985f257e`

Next proposed block: a local cookie jar. Proxy, CA/client certificates, OAuth, diagnostic console, automation and additional protocols remain outside this increment. Installed VSIX verification will follow the user's packaging instruction.
