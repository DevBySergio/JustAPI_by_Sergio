# JustAPI 1.1.1 corrective audit

Historical 1.1.1 corrective-release evidence. Subsequent 1.2.0 capabilities and validation are recorded in [daily workflows](2026-10-16-daily-workflows.md).
Date: 2026-10-16. Baseline: 1.1.0 at `9ad91f50`. Product boundary: a local API client for VS Code, without an account, telemetry integration, or required cloud service. This audit implements the approved correction plan; new product capabilities are proposed separately in [the roadmap](../roadmap.md).

## Evidence and disposition

The original defects were reproduced with synthetic inputs, temporary storage, an injected delayed transport, and IPv4/IPv6 loopback servers. The first four new transaction/cancellation regression tests failed against the baseline and passed after their fixes. The final suites include actual React component tests rather than relying only on helper/source-contract checks.

| ID | Priority | Reproduction and resulting behavior | Permanent evidence |
|---|---|---|---|
| OCT-001 | P1 | Cancel while variable or credential preparation is suspended. Transport previously started after cancellation. Both preparation boundaries now check cancellation; disposal has the same guarantee. | `stabilization.test.ts`: cancellation/disposal during both preparation phases. |
| OCT-002 | P1 | Start two collection creations or two history records concurrently. One previously overwrote the other. Entire read-modify-commit transactions now serialize, including clear/delete operations. | `stabilization.test.ts`: concurrent creations, history record/clear; existing cross-window revision tests remain active. |
| OCT-003 | P1 | Receiving collections while Variables is open previously scheduled another save; leaving within 500 ms canceled local edits. App owns the coordinator, only local edits schedule writes, and navigation/sending/generation wait for acknowledgement. Failed/newer snapshots remain pending. | React `editor.test.tsx`: remote snapshots, unmount, flush-before-send; `autosave.test.ts`: in-flight edits and failed-save retry. |
| OCT-004 | P1 | Replace a Bearer token without changing its public metadata. The request previously appeared clean and reopening could use pending authentication. Pending state now remains dirty until Save; confirmed discard rolls it back. Webview replacement clears staged secrets through the service queue; restored state drops pending auth and announces omissions. | `credentialAndProtocolRegressions.test.ts`: stage/save/discard/retry and shutdown; React tests: dirty guard, discard ordering, restoration. |
| OCT-005 | P1 | Generate code or a collection derivative from a URL containing user:password. Default derivatives previously included credentials. Shared redaction strips user information and produces an authentication placeholder, including across seven targets. | Credential regressions for URL redaction and snippets; shared helper is used by export and preview. |
| OCT-006 | P1 | Submit a 1 MiB request body or publish a collection with 1.2 MB of individually valid variables. General-message limits previously rejected them. Data-bearing messages now have their own budget; initialization sends domains separately and withholds readiness on failure. | Credential/protocol regressions: large request/domain, small control limit, initial-domain ordering and failed readiness. |
| OCT-007 | P2 | Save a request already inside a folder. It previously moved to the root/end. Updates now preserve its owning folder, reference ID, and position; moves remain explicit. | Stabilization regression: nested first/second request order survives edit and reload. |
| OCT-008 | P2 | Import `--data-urlencode` or URL-encoded `-d`. The parsed content previously disappeared because transport read only structured fields. Raw encoded content now reaches the server unchanged and remains visible/editable. Default Content-Type and redirect following match cURL. | HTTP integration: exact received body, Content-Type, redirect flag; existing parser fixtures updated for the corrected defaults. |
| OCT-009 | P2 | HEAD metadata advertised gzip or a large Content-Length, or a bodyless status advertised compression. It previously failed decoding/size validation. HEAD/204/205/304 now preserve metadata and skip body-only decoding and declared-length checks. | HTTP integration: all four bodyless cases and existing real compressed/oversized response cases. |
| OCT-010 | P2 | Send to an available `[::1]` server. The bracketed hostname previously caused a DNS error. Node receives an unbracketed IPv6 hostname. | HTTP integration against an actual ephemeral IPv6 loopback listener. |
| OCT-011 | P2 | Export with authorized credentials and import into fresh storage. Auth previously became `none`. Import now distinguishes credential markers, stages actual Bearer/Basic/custom header/query API keys in the destination SecretStorage, and rolls back on failure. Saved exports never disclose another pending draft token. | Credential regression: exact delivered values, no plaintext in collections JSON, collision preservation, and redacted import without secrets. |
| OCT-012 | P2 | Fail a variable-set write. Uncommitted values previously remained in memory. Candidate snapshots now publish only after a successful write; getters return copies. | Stabilization regression: failed create/update and mutation of returned copies. |
| OCT-013 | P2 | Submit Save, continue typing, then receive confirmation; or refresh collections after submitting Save. Older confirmations previously replaced edits or were suppressed. `requestSaved` reconciles only unchanged fields, mutations retain acknowledgements/errors, and old execution results are ignored after navigation. Invalid URL/header/auth conflicts block shared preflight. | React tests: save in flight, token replacement, navigation/late response; protocol tracker and preflight regressions. |

## Implementation boundaries

- Local JSON storage and native transfer schema remain v2. The protocol additions are internal to the extension/webview bundle: targeted collection-variable updates, separate save confirmation, pending-auth discard, and initialization completion.
- Service queues drain accepted work before SecretStorage/store disposal and reject late operations. The filesystem lock, backup/recovery, migration, and cross-window revision controls remain independently tested.
- Apply stages authentication for the current draft. Save persists it. A failed save retains staged credentials for retry; exports of saved collections use committed credentials.
- General control messages remain limited to 1 MiB. Data-bearing requests/domains use a 16 MiB budget plus 64 KiB envelope allowance; stored documents retain the 16 MiB cap, native import retains the 10 MiB cap, and response/field/structural bounds remain enforced.
- Tooling updates include test-cli 0.0.15, vsce 4, sharp 0.35.5, compatible transitive fixes, and React Testing Library/jsdom 28 for Node 22.14. jsdom 29 was not retained because its CSS implementation failed with VS Code theme custom properties; jsdom 28 passes the component suite with zero dependency advisories.
- `test:packaged` installs only into fresh temporary profiles. It verifies installed bundle hashes and executes against the VSIX files. Its explicit executable-path option accommodates the `Code` executable name in current macOS VS Code bundles without changing the downloaded application.

## Validation ledger

The final `npm run validate` completed successfully on 2026-10-16 after a clean dependency installation with `npm ci`. Node.js was 22.14.0 on macOS arm64.

| Check | Result |
|---|---|
| Test policy, lint, extension/webview type checks | Passed; no skipped/focused tests or lint warnings |
| Unit suite | 106 passed, 0 failed/skipped |
| IPv4/IPv6 localhost integration | 16 passed, 0 failed/skipped |
| React Testing Library/jsdom component and autosave suite | 9 passed, 0 failed/skipped |
| Source extension host, VS Code 1.80.0 | 5 passed |
| Development and production builds | Passed |
| Runtime dependency audit | 0 advisories |
| Complete dependency audit | 0 advisories |
| VSIX inventory | 9 extension payloads plus 2 VSIX metadata files; source/tests/dependencies excluded |
| Installed VSIX, temporary profile, VS Code 1.80.0 | 5 passed; installed bundles match verified build bytes |
| Installed VSIX, temporary profile, stable VS Code 1.142.0 | 5 passed; installed bundles match verified build bytes |
| Complete release gate | Passed, exit 0 |
| Local documentation links and diff whitespace | Passed |

Artifact: `justapi-1.1.1.vsix`, 150,542 bytes. SHA-256: `2c5192f191d402cd27a620476fcd507d4da76135e49e66bb122f8ef7641f164e`.

The production webview is approximately 326 KiB and webpack retains its three size recommendations. No size optimization is claimed. Automated component testing does not constitute pixel/layout verification, a manual screen-reader review, or Windows/Linux runtime testing. CI now includes the packaged minimum/stable checks on Linux; those remote jobs have not been run in this local session.

## Remaining boundaries

The roadmap capabilities are not implemented. In particular, there is no folder-management UI, request-variable editor, workspace storage, Postman v2.1 import, persistent cookie jar, file upload, proxy/certificate/OAuth flow, script runner, or extra protocol client. Existing literal binary text and text-only multipart remain the supported upload modes.

Ordinary data entered outside Auth Builder is still ordinary local data. Default derivative redaction covers recognizable credential fields; it does not claim to identify arbitrary secrets in variable/body text. Metadata and visual/render limits remain bounded. Production bundle size warnings are retained as a performance item, not hidden as a passing optimization. No publication or user-profile installation is performed by this work.
