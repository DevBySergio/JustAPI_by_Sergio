# Local environments and dotenv — JustAPI 1.3.0 candidate

This increment completes the next daily-workflow roadmap block after request tabs. It extends the existing, unpublished 1.3.0 candidate; no version/archive is published or generated. The previous [request-tab report](2026-10-16-request-tabs.md) remains a historical implementation snapshot.

## Implemented behavior

- A profile-wide selector chooses exactly one environment or none. Environments are variable sets with additive `kind: "environment"`/`active` metadata, saved atomically in the existing schema-v2 local domain. Legacy linked sets remain shared and unchanged.
- Precedence is Global < linked shared sets < active environment < Collection < Request. Inactive environments are excluded from resolution, variable counts and suggestions. Selection is acknowledged before dependent execution, previews or code generation; failed selection retains the old state. Each HTTP operation captures its environment before asynchronous preparation and keeps it through transport.
- Manage/Variables → Environments provides creation, renaming, variable editing, enabling/disabling, deletion and explicit Save/Discard. Drafts survive navigation in memory. Concurrent host changes reject stale saves. A pending-edit cache flag warns after reload without storing environment draft values. Deleting the active environment selects none.
- Import uses the native local file picker. A masked preview lists parsed names and optional revealed values, target/name, diagnostics and opt-in watching. Confirmation imports only reviewed, unchanged bytes and the expected target revision. New environments remain inactive. Replace explicitly replaces the complete variable list; cancel and failed persistence retain prior data. Concurrent confirmation of the same preview cannot create duplicates.
- Literal parsing supports UTF-8/BOM, LF/CRLF, optional export, comments, empty values and single/double-quoted multiline values. Double-quoted newline/carriage-return/quote/backslash escapes are decoded. No shell, `$VAR`, `${VAR}`, process environment or file-reference expansion occurs. Duplicate names and malformed syntax block import with value-free diagnostics. Empty files may be explicitly imported as empty environments.
- Bounds: 1 MiB file, 1,000 variables, 128-character names, 65,536-character values and at most 20 staged previews. Descriptor reads are bounded even if a file grows and reject directories/binary/non-UTF-8 input. The webview cannot provide an arbitrary source path.
- File watching is session-only and opt-in. Actual atomic replacements are detected. Changes create previews, never automatic writes/imports/HTTP sends. Stop, deletion and recreation release watchers and staged previews; stopped callbacks cannot reopen previews. Watch errors retain saved variables. Pending editor changes block replacement until saved/discarded; stale revisions are rejected again in the host.
- Source files, watched paths, previews and environment drafts are excluded from native collection exports/webview persistence. Committed values remain ordinary local JSON data, not SecretStorage credentials; the UI/docs direct credentials to Auth Builder. Existing recognized-credential redaction remains active for derivatives.

## Regression evidence

`src/test/unit/environments.test.ts` adds 12 tests for parsing, diagnostics/limits, shared-set compatibility, selection/precedence, serialized selection and disk rollback, stale edits, captured contexts, confirmation/cancellation/replay/file changes, UTF-8/directory rejection, real and injected watchers, reset/stop, protocol shape/path rejection, reload notices and empty files.

`src/test/integration/environments.integration.test.ts` exercises the real localhost transport after changing selection between preflight and transport. Received query, headers and body retain the original environment; subsequently generated code uses the newly selected environment and omits recognized synthetic credentials.

`webview-ui/test/environments.test.tsx` adds six real React component tests. A suspended selection blocks sending until acknowledged; failure keeps the old selection and prevents its waiting send. Other cases cover masked confirmation/no cache leakage, invalid/cancelled previews, drafts surviving navigation and failed-save retry, watcher previews conflicting with pending edits and explicit stopping. This caught and fixed a race where a failed selection promise could clear during autosave preparation before Send awaited it.

The added extension-host test reproduced `ReferenceError: crypto is not defined` in VS Code 1.80 when creating an environment. Shared model factories now accept an optional ID; host managers/parser supply Node `randomUUID`, while browser callers retain their native default. The same correction covers collection creation and cURL import. The actual-runtime test now creates a collection, parses cURL, creates an environment, reads/confirms a real temporary `.env`, starts/stops its watcher and restores/resolves the selected environment. Before-fix log: `/private/tmp/justapi-env-runtime.log`.

## Validation

Final source gate: `npm run validate:source`, Node 22.14.0, macOS arm64, 2026-10-16. This builds production scripts and checks the candidate package inventory without creating an archive.

| Check | Result |
|---|---|
| Policy, zero-warning lint and strict host/webview types | Passed |
| Unit tests | 134 passed |
| Localhost HTTP integration | 18 passed |
| React component/autosave tests | 37 passed |
| Source extension host, VS Code 1.80.0 | 6 passed |
| Source extension host, VS Code 1.142.0, fresh temporary profile | 6 passed |
| Runtime/full dependency audits | 0 vulnerabilities |
| Production scripts | Passed; initial bundle 262,948 bytes, two retained webpack size recommendations |
| Candidate inventory | 22 payload files, including all 14 webview scripts and licenses; no VSIX created |

The Node/HTTP/React suites total 189 passing tests without skips or React act warnings; the two source-host runs add twelve test executions. Logs: `/private/tmp/justapi-environments-validation.log` and `/private/tmp/justapi-environments-stable.log`. Package installation tests remain deferred until the user requests the VSIX.

Production browser review used synthetic mocked host data and the generated nonce-only CSP. At 320px the panel scroll width remained 320px and the preview width/scroll width both measured 302px. Values were masked, themed buttons readable, confirmation retained the current environment, subsequent selection/editing showed the imported environment and Stop watching cleared its indicator. No console warnings/errors were observed. This review does not claim a manual native file-picker, screen-reader or Windows/Linux check; filesystem/parser/watcher behavior is covered separately by real local tests.

Visual evidence: [environment import at 320px](assets/environments-320.png).

## Release and remaining scope

The existing `justapi-1.1.0.vsix` and `justapi-1.2.0.vsix` remain unchanged. No `justapi-1.3.0.vsix` is created. No commit, push or store publication is performed.

Postman v2.1 collection/environment migration is the next proposed block; response downloads and the remaining HTTP/automation/protocol roadmap stay deferred. Environment values remain per profile, file watching requires opt-in again after recreation, and `.env` shell expansion is deliberately unsupported. The two visible webpack recommendations remain future performance work, not suppressed warnings or correctness failures.
