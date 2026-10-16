# Offline Postman migration — 1.3.0 candidate

Date: 2026-10-16. This increment follows the environment/.env block. Existing uncommitted environment work is preserved. The manifest remains 1.3.0; no installable VSIX is created or published.

## Delivered behavior

- Both Collections and Variables → Environments offer **Import Postman…**. The extension opens a local file picker for one JSON export. The existing native JustAPI import command retains its format.
- Accepts Postman collection v2.1 exports and environment exports identified by `_postman_variable_scope: "environment"`. Root names and structure are validated; source IDs are replaced by new local UUIDs. No Postman account, service request, script evaluation or linked-file access is involved.
- Collections preserve nested folders, sibling order, collection variables, inherited folder variables, supported HTTP methods, disabled headers/query/body pairs, URL object/raw representations, path parameters, raw text/JSON/XML, URL-encoded fields and text-only multipart bodies.
- Authentication inherits through collection/folder/request boundaries, with explicit noauth overrides. Supported Bearer, Basic and API key helpers, recognizable auth headers and URL user information are removed from ordinary request data and written to SecretStorage inside the existing import transaction. Failed collection persistence removes newly created secrets and leaves memory/disk state unchanged; the same preview may be retried.
- Credential templates resolve against the captured variable context at send time. Basic username/password are resolved before encoding. Missing references fail before HTTP. Default snippets retain placeholders; explicit disclosure resolves the same captured environment through preparation and auth. URL migration shares the derivative-redaction authority boundary, including variable protocols, encoded passwords and redaction markers.
- A new environment keeps its disabled flags and starts inactive, preserving the selected environment and existing drafts. Ordinary values use local JSON. Values marked `secret` are excluded and reported rather than downgraded to ordinary storage.
- The host retains one staged source document; only file/name metadata, counts and index-based diagnostics reach the webview. Preview values, credentials and source paths are absent from webview workspace persistence. The new preview panel loads on demand.
- Confirmation requires the reviewed name, warning acknowledgement where applicable and a fresh SHA-256 match of the source file. Duplicate/replayed confirmations fail; cancel/reset removes stages; obsolete picker completions cannot recreate a stage. Mutations keep their acknowledgement/error ownership and publish domains without replacing a request draft.

## Explicit compatibility limits

This is a supported-subset migration, not a Postman runtime. Scripts and response examples are omitted and never executed. Request descriptions, cookies and Postman-specific proxy/certificate/profile settings are reported as omissions. Unsupported or invalid request bodies/auth/methods/fields are excluded whole; file-valued uploads and GraphQL bodies await later roadmap blocks. Ambiguous combinations of multiple credentials, unsupported credential headers and disabled credential headers also exclude the request rather than leaving additional secrets in ordinary header storage.

Secret environment variables must be configured through Auth Builder after migration. Other variables and body values remain ordinary local data; masking does not encrypt them. JustAPI collection/request variables override the active environment, whereas Postman environments override collection variables. Collections containing variables explicitly warn about this difference before confirmation. Folder variables are materialized at request scope, including their disabled/override behavior; variable-entry counts therefore include materialized copies.

Input bounds: UTF-8 regular file ≤10 MiB, source structure ≤100,000 nodes/110 levels, ≤10,000 collection items, ≤50 nested folder levels, existing request/variable field limits. Converted request/credential data has its own 10 MiB budget and at most 10,000 expanded variable entries, preventing small inherited-variable sources from expanding into unbounded collections. The canonical native document still passes its existing graph/structural limits. Diagnostics show at most 200 entries and separately report the total. Large collections may need splitting. No Postman bulk-dump, v1/v2.0, URL-download or automatic background migration is added.

## Regression evidence

| Scenario | Implementation and permanent evidence |
|---|---|
| Nested source with inherited credentials/noauth, URL objects, disabled pairs and form fields | Pure converter preserves tree/order and effective values; `src/test/unit/postmanImport.test.ts`. |
| Scripts/examples/unsupported protocols, methods, OAuth or upload bodies | Counts/index-based warnings require consent; excluded requests have no partial transport representation. Unit + React preview tests. |
| Header/URL secrets and redaction placeholders | Separate host-only auth map, secure transaction and shared URL authority parsing. Unit tests include variable protocols and encoded credentials; disk assertions exclude synthetic secret values. |
| File changes, duplicate confirmation, replay, cancellation/reset or obsolete picker completion | Bounded descriptor read, SHA-256 comparison, stage identity/generation and one-shot guard; unit tests use real temporary files and controlled picker promises. |
| Failure during durable collection write | Injected pre-rename failure leaves no imported collection or secret; retry succeeds; unit test checks disk bytes and resolved Basic credentials. |
| New environment import | Disabled flags/scalar values preserved, secret/duplicate/invalid variables reported, current selection unchanged; unit + actual-runtime checks. |
| HTTP and snippet behavior after migration | Real localhost receives exact URL-encoded/raw UTF-8 body bytes, duplicate/enabled query fields and resolved Bearer/Basic/API key credentials; default snippets are redacted, authorized snippets resolve Basic values, missing auth variables reject. `src/test/integration/postmanImport.integration.test.ts`. |
| Delayed mutation result or failed import in the UI | Preview remains until its own acknowledgement, failure permits retry, cancellation never confirms, a new preview resets consent, existing dirty request tabs/cache survive. `webview-ui/test/postmanImport.test.tsx`. |
| Declared minimum runtime | Actual VS Code test imports both export kinds through real temporary JSON files and local storage, checking protected credential resolution without browser crypto globals. `src/test/extension/extension.test.ts`. |

The increment adds 12 unit, one HTTP and four React tests plus one extension-host test. Earlier environment and stabilization suites remain active.

## Validation

Final source gate: `npm run validate:source`, Node 22.14.0, macOS arm64. This gate builds scripts and checks package inventory without producing an archive.

| Check | Result |
|---|---|
| Policy, lint and strict host/webview types | Passed; no lint warnings, skipped/focused tests or suppression directives |
| Unit tests | 146 passed |
| Localhost HTTP tests | 19 passed |
| React component/autosave tests | 41 passed; no React act warnings |
| Source extension host, VS Code 1.80.0 | 7 passed |
| Source extension host, VS Code stable 1.142.0, temporary isolated profile | 7 passed |
| Runtime/full dependency audits | 0 vulnerabilities |
| Production scripts | Initial bundle 264,930 bytes, 15 local scripts; two retained webpack size recommendations |
| Candidate inventory | 23 payload files; archive creation not run |

Unit/HTTP/React suites total 206 passing tests; the two source-host runs add fourteen passing test executions. Final logs: `/private/tmp/justapi-postman-validation.log` and `/private/tmp/justapi-postman-stable.log`. Installed-VSIX checks remain deferred until the user explicitly requests packaging. No Windows/Linux, screen-reader, manual native-file-picker or store-publication verification is claimed.

Production browser review used generated CSP/nonced local chunks with synthetic host data. At 320px, body width/scroll width were both 320px; the preview's outer width was 304px and inner scroll width 302px. Confirmation was disabled until the warning was accepted, adding the synthetic collection preserved the open tabs and active environment, and console warnings/errors were empty. This visual review is separate from real filesystem/HTTP/extension-host automation. Evidence: [preview](assets/postman-import-320.png) and [imported result](assets/postman-imported-320.png).

## Release boundary and remaining work

The existing archives retain their previous hashes:

- `justapi-1.1.0.vsix`: `dac38c9f5c6545bf187a927a0d75aa77a0ce5dcb5bf0b877ed176305b04ac699`
- `justapi-1.2.0.vsix`: `451992143a555363e2a1957c2191045a6a1ab9f664d351604bddca05985f257e`

No 1.3.0 VSIX, commit, push or store publication is performed. Response downloads are the next daily-workflow block. Binary uploads, cookie jar, proxy/certificates/OAuth, scripts/runner and additional protocols remain future roadmap work. Earlier audit files preserve historical snapshots.

## Primary format references

- [Postman Collection v2.1 JSON Schema](https://schema.postman.com/collection/json/v2.1.0/draft-07/collection.json), consulted for collection/folder/request, auth attributes, URL forms and body modes.
- [Postman data exports](https://learning.postman.com/docs/getting-started/importing-and-exporting/exporting-data/), consulted for separate local collection/environment exports.
- [Postman environment variables](https://learning.postman.com/docs/use/send-requests/variables/managing-environments/), consulted for active-environment scope and precedence.
