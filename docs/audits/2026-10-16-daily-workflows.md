# Daily workflows and loading improvements — JustAPI 1.2.0

This increment follows the corrective 1.1.1 release. It completes the first two items of the local-client roadmap and reduces initial JavaScript loading. No service account, cloud backend, telemetry or remote execution was added. Storage and native transfer schemas remain v2.

## Accepted implementation scope

- Folder CRUD and nested folders are reachable through native buttons/forms. Folder/request moves support another collection, a parent folder and an exact position; sibling up/down controls use the same engine. Every operation supports keyboard and pointer input. IDs/order persist through saves and reloads. Drag-and-drop and collection-list reordering are outside this increment.
- Deleting a folder explicitly cascades to its descendants and saved/staged credentials after a successful storage commit. A dirty current descendant receives the existing discard guard. Its running execution is cancelled, late results are ignored, and the editor becomes a new draft only after deletion succeeds. A cross-collection move follows the current request's variable scope without replacing its text.
- The request Vars tab edits the request's draft variables and explains precedence. Save persists them with the request; disabling an override exposes a lower-scope value. Pending global/collection writes and auth changes finish before preview. Previews clear when inputs change and ignore obsolete results.
- Params exposes complete `/:name` path segments. Hierarchical variables resolve before substitution. Values are encoded as a single segment, preserving `/`, `?`, `#`, `%` and Unicode as data. Authority/query/fragment text is not substituted. Invalid/duplicate names, missing/empty values, malformed Unicode and dot-only values produce `INVALID_PATH_PARAMETER` and block preview readiness, sending and generation consistently. Valid unused parameters remain saved.
- Secondary panels and response rendering load on demand. Chunk URLs are derived from the local entry script and carry its nonce; CSP is unchanged. Error/loading boundaries retain the surrounding editor. Obsolete chunks are cleaned during builds, and package inventory/hash checks include every generated script/license.

## Regression evidence

- `src/test/unit/dailyWorkflows.test.ts`: nested/concurrent folder mutations, exact move/reorder/save/reload behavior, descendant rejection, disk failure rollback, saved and pending secret cleanup, protocol dispatch/acknowledgements, path encoding/validation, scope precedence and URL agreement across preview/transport/seven code targets.
- HTTP integration verifies the exact encoded path received by a real loopback server.
- React component tests exercise create/rename forms, rejected-write retry, excluded descendant destinations, current request scope after a move, dirty-descendant deletion/cancellation, request variable/path editing sent to Save/Send, and obsolete preview suppression. Component tests await deferred loading.
- Local browser smoke review used production assets and `renderWebviewDocument` with its nonce-only CSP, synthetic host data and a 320px content width. Folder organization/move forms and the request variable editor fit without horizontal overflow; no browser errors/warnings were observed in these flows. This is a browser fixture review, separate from installed VS Code host tests. It does not claim manual assistive-technology or Windows/Linux testing.

## Performance measurements

With the same 1.2.0 feature set, production `bundle.js` fell from approximately 335 KiB before splitting to 262 KiB afterward (about 22%). Remaining scripts are requested when their panels are used. Total packaged JavaScript grows slightly because splitting adds loader/module overhead; no total-package reduction or startup-time speedup is claimed. Two webpack size recommendations remain for the entry asset/entrypoint. Large-dataset rendering/virtualization remains future work.

## Release validation

The complete `npm run validate` passed (exit 0) on 2026-10-16 using Node 22.14.0, macOS arm64.

| Check | Result |
|---|---|
| Test policy, zero-warning lint, strict extension/webview type checks | Passed |
| Unit tests | 111 passed; no failures/skips |
| IPv4/IPv6 localhost HTTP integration | 17 passed; no failures/skips |
| React component/autosave tests | 14 passed; no failures/skips |
| Source extension host, VS Code 1.80.0 | 5 passed |
| Runtime and complete dependency audits | 0 vulnerabilities in both |
| Development and production builds | Passed; 2 production size recommendations retained |
| VSIX inventory | 20 payload files; source/tests/dependencies/maps excluded |
| Installed VSIX, temporary profile, VS Code 1.80.0 | 5 passed; host and every chunk/license match build bytes |
| Installed VSIX, temporary profile, stable VS Code 1.142.0 | 5 passed; host and every chunk/license match build bytes |
| Local documentation links and diff whitespace | Passed |

Artifact: `justapi-1.2.0.vsix`, 167,662 bytes. SHA-256: `451992143a555363e2a1957c2191045a6a1ab9f664d351604bddca05985f257e`.

The local gate log is `/private/tmp/justapi-1.2-validation.log`. This work neither publishes the extension nor installs it into the user's existing VS Code profile. Source changes remain uncommitted.

Visual evidence from the synthetic browser review: [320px folder move form](assets/1.2-folders-320.png).

## Next roadmap items

Independent request tabs, explicit environments/`.env` import, Postman v2.1 migration and response downloads remain proposed, followed by the broader HTTP and automation/protocol items. These capabilities have not been silently bundled into this increment.
