# Validation and testing

JustAPI uses deterministic local fixtures. The automated suites never call a live third-party API and the HTTP integration suite binds to an ephemeral `127.0.0.1` port.

## Prerequisites

- Node.js 22.14.0 and npm 10 or newer.
- VS Code extension-host tests download and run the declared minimum VS Code version, 1.80.0.
- Linux needs a display server; CI runs the extension suite with `xvfb-run`. macOS and Windows can run it directly.

Install exactly the locked dependency graph, then run the complete release gate:

```sh
npm ci
npm run validate
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run test:policy` | Rejects focused, skipped, or suppressed tests. |
| `npm run test:unit` | Compiles and runs pure unit and fixture-contract tests. |
| `npm run test:integration` | Exercises the HTTP client against a localhost fixture server. |
| `npm run test:webview` | Compiles and runs real React components with Testing Library and jsdom 28 on Node 22.14. |
| `npm run test:packaged` | Installs the built VSIX in temporary profiles and runs extension-host tests on 1.80.0 and stable, checking installed bundle bytes. |
| `npm run test:extension` | Activates the extension, validates commands, and exercises its webview lifecycle. |
| `npm run lint` | Lints extension and webview TypeScript with zero warnings allowed. |
| `npm run typecheck:extension` | Strictly type-checks the extension and tests. |
| `npm run typecheck:webview` | Strictly type-checks the React webview. |
| `npm run validate:static` | Runs policy, lint, both type-checks, Node suites, build, and both audits. |
| `npm run validate` | Adds extension-host tests, VSIX creation, package-content validation, and isolated packaged-extension tests. |

The regression catalogue labels implemented checks as `active`. A `contract` fixture records the required behavior and owning remediation task without pretending that unfinished product behavior passes. Owners promote those fixtures to active tests as their implementation lands.

## CI contract

The GitHub Actions workflow installs with `npm ci`, caches only npm's download cache, runs the complete static gate, runs extension tests under Xvfb, creates the VSIX, validates its allowlist, and uploads the package. Generated output and `node_modules` are never restored as caches or committed artifacts.

## Packaged extension checks

After `npm run vsix`, run `npm run test:packaged`. The script uses a fresh temporary profile and extensions directory for each VS Code version, installs the VSIX, compares the installed host bundle and every generated webview chunk/license with the verified build, and executes the extension-host suite against the installed files. User profiles and installed extensions are untouched. Test profiles are removed afterward; downloaded VS Code runtimes remain in the ignored `.vscode-test` cache. Pass version arguments directly to `node scripts/test-packaged.mjs` to select a subset.

The minimum-version and stable-version package runs require a desktop display (Xvfb on CI). Runtime downloads use Microsoft's update service; security audits use npm. Product tests send synthetic data only to ephemeral IPv4/IPv6 loopback servers. jsdom component tests prove interaction/state contracts, not visual rendering or manual assistive-technology accessibility.

## Daily workflows (1.2.0)

`dailyWorkflows.test.ts` covers nested folder moves/reordering and subsequent saves, concurrent targeted mutations, reloads, descendant rejection, disk failure rollback, saved/pending credential cleanup, correlated folder protocol operations, path encoding and consistent preflight/code generation. The localhost integration suite verifies actual path bytes. React tests exercise folder forms and failed-write retry, valid destinations, moving the current request scope, deleting a dirty descendant with active execution, editing/saving/sending request variables and path parameters, and rejecting obsolete previews. Tests wait for deferred panels to finish loading before interacting.

Package inventory and installed VSIX checks include every generated webview chunk and license file. The local browser smoke review uses synthetic data, production assets and the generated nonce-only CSP; it is separate from VS Code extension-host tests and does not claim a screen-reader or cross-platform manual review.
