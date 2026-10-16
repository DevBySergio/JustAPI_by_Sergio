# Independent request tabs — JustAPI 1.3.0 candidate

This increment implements the next roadmap block after 1.2.0. Code, manifest, lockfile and changelog are prepared for 1.3.0. The changes remain uncommitted/unpublished. No new VSIX is created; the existing archives are retained unchanged. Final installation checks await the user's packaging instruction.

## Accepted behavior

- New requests, confirmed cURL imports and unsaved history replays create independent tabs. Saved requests are opened once; reopening selects their existing unsaved draft.
- Every tab owns its draft/baseline, selected/baseline collection scope, pending authentication metadata, execution, response, generated code and error/loading state. Collection browsing cannot silently change another tab's request scope. Multiple explicit sends can run concurrently.
- Request IDs deduplicate saved requests; unique session IDs distinguish a closed/reopened tab. Asynchronous actions capture their originating session before awaiting preparation. Load/save/code replies update only that session, without focus stealing. Query supersession is scoped by request ID.
- Closing a dirty tab offers Keep editing, Discard and close, and Save and close when a collection is selected. Save failures or newer edits retain the tab. Closing cancels only its execution, awaits accepted auth/save work and releases its pending credentials. Closing the last tab creates an empty draft. Arrows/Home/End select tabs; Delete closes the focused tab.
- Folder/collection deletion guards all dirty open descendants, including inactive tabs, and preserves unrelated drafts/executions. Moves reconcile the owner scope in every tab.
- Webview state version 2 migrates the old single-editor state and restores sanitized drafts/baselines/scopes with an active tab. It accepts at most 20 tabs and a 4 MiB serialized budget, omitting large inactive fields first with a notice. Responses, generated code, execution IDs, promises and staged auth secrets are session-only. Pending auth must be re-entered after reload; previous host executions are cancelled when the view is recreated.
- Ordinary URL spelling and JSON whitespace are preserved when no redaction is needed. Saved collection/storage schema v2 is unchanged. Unapplied credential input fields are cleared on editor unmount; Apply stages them securely for that draft.
- The request editor loads only when its section is opened, through the existing nonce-bearing local chunk loader and error boundary. Other sections do not fetch it unnecessarily.

## Automated regression coverage

`requestWorkspace.test.ts` covers restoration of multiple drafts and pending auth, legacy migration, invalid/duplicate identities, state bounds, formatting preservation, scoped query supersession, independent host cancellation and view recreation.

`requestTabs.test.tsx` exercises concurrent responses, saved-request deduplication, authentication/preparation suspended across tab switching, inactive save acknowledgements with newer edits, per-tab close/cancellation, Keep/Save/rejected-save retry, multiple saved-request loads and error retry, close/reopen stale replies, inactive descendant deletion, multi-draft restoration, keyboard control, generated-code ownership, tab limits, discard after failed in-flight auth, keyboard focus after closing and a newer collection selection during an older save. Previous editor regressions remain active and use closing as the destructive action.

## Final review: incomplete URL credentials

An additional credential-redaction gap was reproduced before the final release pass: `https://reader:synthetic-secret@` and `{{scheme}}://reader:synthetic-secret@{{host}}/path` bypassed redaction when the URL constructor rejected them. A variable-protocol URL also retained a recognized query API key. Default collection/code derivatives, webview caches and history fallback handling now share authority redaction; query redaction works before the URL is executable. At signs in paths/fragments and safe URL spelling remain unchanged; live drafts are not mutated.

`urlRedaction.test.ts` failed in two of three cases before the correction and now passes all three. It covers incomplete hosts, invalid IPv6/ports, templated protocols, network-path authorities, multiple at signs, leading whitespace, incomplete HTTP authorities, duplicate query credentials, safe query/fragment preservation and ordinary at signs (including an empty user-info marker). Before-fix log: `/private/tmp/justapi-url-redaction-before.log`.

## Validation

`npm run validate:source` passed with exit 0 on 2026-10-16 using Node 22.14.0 and macOS arm64. It builds production JavaScript and checks the candidate package inventory without creating an archive.

| Check | Result |
|---|---|
| Test policy, zero-warning lint, strict extension/webview type checks | Passed |
| Unit tests | 122 passed, no failures/skips |
| Localhost HTTP integration | 17 passed, no failures/skips |
| React component/autosave tests | 31 passed, no failures/skips or React act warnings |
| Source extension host, VS Code 1.80.0 | 5 passed |
| Source extension host, VS Code 1.142.0, fresh temporary profile | 5 passed |
| Runtime and full dependency audits | 0 vulnerabilities in both |
| Development/production builds | Passed; initial production JavaScript 257,681 bytes (about 252 KiB), with 2 retained size warnings |
| Candidate package inventory | 21 files, including every generated chunk; no VSIX created |
| Documentation links and diff whitespace | Passed |

Final logs: `/private/tmp/justapi-release-validation.log` and `/private/tmp/justapi-release-stable.log`. The Node/HTTP/React suites total 170 passing tests; each VS Code version adds five source-host tests. These are source-extension checks; packaged installation tests remain deferred until the user requests the final VSIX. Manifest and lockfile both declare 1.3.0.

The entry asset fell from 276,662 to 257,681 bytes during final review (about 7%). This is a reduction in the initial script, not a measured startup-time or total-package improvement. Two webpack recommendations still flag the entry above 244 KiB; they remain visible and are not test/build errors or unresolved correctness findings.

The production browser fixture used synthetic data and the generated nonce-only CSP at 320px content width. Tabs and the close dialog fit without horizontal overflow (320px panel, 286px dialog); both secondary buttons are readable in the dark theme. Saving/closing an inactive dirty tab retained the other tab and returned keyboard focus to it. The final build was rechecked after deferring the editor: the editor loaded, the dirty-close dialog opened, and browser warnings/errors remained empty. This is separate from source extension-host testing and does not constitute a manual screen-reader or Windows/Linux review.

Visual evidence: [request tabs and protected close](assets/request-tabs-320.png).

The existing archives are unchanged:

| Existing file | SHA-256 before and after this increment |
|---|---|
| `justapi-1.1.0.vsix` | `dac38c9f5c6545bf187a927a0d75aa77a0ce5dcb5bf0b877ed176305b04ac699` |
| `justapi-1.2.0.vsix` | `451992143a555363e2a1957c2191045a6a1ab9f664d351604bddca05985f257e` |

## Remaining scope

No known correctness finding remains open for this increment. The remaining release step is to create the 1.3.0 VSIX and run the isolated installed-package matrix after the user authorizes packaging; store upload has not been performed.

Environment selection/`.env` import, Postman v2.1 migration and response downloads remain proposed daily-workflow roadmap items, outside this release. Drag reordering of request tabs and persistent response/viewer preferences are outside this increment. Large-collection/response benchmarks and the retained webpack size recommendations remain future performance work.
