# Complete response downloads — 1.3.0 candidate

Date: 2026-10-16. This increment follows offline Postman migration. Previous environment/migration work is preserved. Version 1.3.0 remains a source candidate; the user has not authorized an installable VSIX.

## Delivered behavior

- Complete responses offer **Save response body…** with a native local save dialog and a MIME/type-based suggested `response.ext` name. The dialog owns destination selection and overwrite confirmation. The webview sends only a response ID; it cannot supply file paths or replacement body data. Server filenames/URL paths are not used as destinations. No additional HTTP request is made to download a retained response.
- `HttpClient.takeResponseBody()` transfers the complete Buffer after HTTP gzip/deflate/Brotli decompression and before charset decoding/base64 presentation. This preserves original entity bytes, including binary/image data, BOM, line endings, invalid UTF-8 and other text encodings. It does not export compressed wire bytes, headers or cookies.
- Preview truncation, JSON formatting/search, image preview limits and the binary base64 display do not alter downloaded files. Complete non-2xx and empty/HEAD/no-content responses are supported. Failed, partial, cancelled, oversized and invalid-compression responses are never offered as complete downloads. Configured transport limits still apply (default 10 MiB, maximum 100 MiB); streaming/unlimited downloads are outside this increment.
- The host keeps at most 100 MiB of original bodies across 20 response IDs and one current body per request. Oldest retained bodies are evicted to stay within that budget; successful saves refresh recency. Resending, closing a tab and view reset/disposal release bytes. Releases update inactive tabs too, with an explicit expiration notice rather than a misleading enabled download.
- Save cancellation writes nothing. Saving writes/fsyncs/closes a private sibling temporary file, rechecks response identity/generation, then atomically replaces the destination. Failed writes retain both the existing destination and source bytes for retry, and remove temporary leftovers. One native save operation is allowed at a time. The picker does not pin body bytes; one in-progress filesystem write may temporarily pin one body in addition to the bounded cache.
- Closing/replacing/releasing/evicting/resetting a response before commit prevents its pending save from replacing a file. Already committed user-selected files remain independent of session cleanup. Saved content is ordinary local data and may contain sensitive API response values; the UI does not automatically open or execute files.
- Pending state, cancellation/errors and success messages belong to both the originating operation and response. Navigating to another tab preserves the pending save without transferring its indicator/result. Replacing or closing a response ignores older results. Native save operations have no artificial 30-second acknowledgement timeout; ordinary protocol operations retain theirs. Response bytes, paths and download state are excluded from history, exports and restored drafts.

## Regression evidence

| Reproduction / risk | Correction and permanent checks |
|---|---|
| Re-encoding displayed Latin-1/UTF-16/invalid UTF-8 text changes its bytes or drops a BOM | Retain the Buffer before text decoding. Unit, localhost HTTP and actual-extension-runtime tests compare saved bytes directly. |
| Preview limits or formatting could accidentally truncate/change a file | Save by host response ID, not DOM text/base64. The HTTP suite saves a body beyond the text preview cap; React asserts the outbound message contains neither body nor path. |
| Binary and compressed bodies | HTTP fixtures cover all byte values, image data and gzip/deflate/Brotli; saved files equal the decompressed source buffers. Downloading does not increase server request counts. |
| Error status / no content / failed transport | Complete 500/204/HEAD responses save correctly; size/decompression/partial failures and a live cancelled response do not register a body. |
| Cancelled dialog or failed disk write | Cancel produces no file and permits retry. An injected pre-commit failure preserves the existing destination; retry writes exact bytes. Real temporary files are checked for leftovers. |
| Multiple bodies / obsolete save dialog / released response | Small-budget unit fixtures prove byte/count eviction, per-request replacement, release/reset and duplicate-dialog guards. Release during writing aborts before atomic replacement. |
| Pending indicator followed the prior active tab | The new download field was initially omitted from fresh tab objects, so the active Zustand projection retained the old field on a tab switch. It is now required and explicitly initialized. The React navigation test verifies the second tab has no pending indicator and the first receives its own result. |
| Late save response after closing/resending | React tests close a tab or install a new execution/response before delivering the older result; neither can alter the replacement tab/response. |
| Protocol paths or forged payloads | Both endpoints validate strict ID-only commands, bounded metadata, released-ID lists, correlated saved/cancelled results and the unavailable-body error. |

New permanent checks: eight unit tests in `src/test/unit/responseDownloads.test.ts`, two real HTTP tests in `src/test/integration/responseDownloads.integration.test.ts`, six React tests in `webview-ui/test/responseDownloads.test.tsx`, and one additional actual extension-runtime test in `src/test/extension/extension.test.ts`.

During debugging, the navigation test's failed DOM-element assertion exhausted the test process heap while formatting the stale element. The state-initialization defect above was fixed; the final unfiltered suite runs normally without increasing the heap or suppressing/skipping tests. Diagnostic logs remain under `/private/tmp/justapi-download-ui-debug.log` and `/private/tmp/justapi-download-ui-isolate.log`; they are not passing-validation evidence.

## Final validation

`npm run validate:source`, Node 22.14.0, macOS arm64, 2026-10-16:

| Check | Result |
|---|---|
| Test policy / lint / strict host and webview types | Passed; 39 TypeScript test files, no lint warnings or test suppressions |
| Unit suite | 154 passed |
| Real HTTP integration | 21 passed |
| React component/autosave suite | 47 passed; no React act warnings |
| Source extension host, VS Code 1.80.0 | 8 passed |
| Source extension host, stable 1.142.0, temporary isolated profile | 8 passed |
| Runtime and full dependency audits | 0 vulnerabilities |
| Production scripts | 267,175-byte initial bundle; 15 scripts; two retained webpack size recommendations |
| Candidate inventory | 23 payload files, including the changed deferred response-viewer chunk; no archive created |

The Node/HTTP/React suites total 222 passing tests; the two source-host runs add sixteen passing test executions. Logs: `/private/tmp/justapi-response-downloads-validation.log` and `/private/tmp/justapi-response-downloads-stable.log`. The stable host also emits a Node `DEP0169` legacy `url.parse` deprecation warning. JustAPI source does not call that API; the bundled VS Code host contains such calls. Its exact originating stack was not traced, and the warning was not suppressed. This is separate from the zero-advisory npm audit and does not fail the tests.

Production-browser review used generated CSP/local chunks and synthetic host replies at 320px. Body and response width/scroll width were all 320px. A 240,025-byte body showed a 200,000-character capped preview, while the save result confirmed the full byte count and selected filename. Buttons and notices remained readable, and console warning/error logs were empty. Evidence: [response download at 320px](assets/response-downloads-320.png). The mock review does not claim a manual native-file-picker or filesystem check; real HTTP/file-byte assertions are covered separately by automation. Windows/Linux, screen-reader and installed-VSIX validation remain unverified.

## Release boundary and next increment

No VSIX, commit, push or store publication is performed. Existing ignored archives remain unchanged:

- `justapi-1.1.0.vsix`: `dac38c9f5c6545bf187a927a0d75aa77a0ce5dcb5bf0b877ed176305b04ac699`
- `justapi-1.2.0.vsix`: `451992143a555363e2a1957c2191045a6a1ab9f664d351604bddca05985f257e`

Phase 1 daily-workflow capabilities are implemented in the source candidate. The next proposed increment is real binary/file-valued multipart uploads in phase 2. Cookie jar, proxy/certificates/OAuth, response/console improvements, scripts/runner/CLI and additional protocols remain future roadmap work. Packaging and isolated installed-payload checks wait for the user's explicit instruction.

HTTP encoding reference: [RFC 9110, Content-Encoding](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4). The chosen export is the decompressed entity body; the original text encoding is retained.
