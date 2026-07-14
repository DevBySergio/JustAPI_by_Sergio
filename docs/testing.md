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
| `npm run test:extension` | Activates the extension, validates commands, and exercises its webview lifecycle. |
| `npm run lint` | Lints extension and webview TypeScript with zero warnings allowed. |
| `npm run typecheck:extension` | Strictly type-checks the extension and tests. |
| `npm run typecheck:webview` | Strictly type-checks the React webview. |
| `npm run validate:static` | Runs policy, lint, both type-checks, Node suites, build, and both audits. |
| `npm run validate` | Adds extension-host tests, VSIX creation, and package-content validation. |

The regression catalogue labels implemented checks as `active`. A `contract` fixture records the required behavior and owning remediation task without pretending that unfinished product behavior passes. Owners promote those fixtures to active tests as their implementation lands.

## CI contract

The GitHub Actions workflow installs with `npm ci`, caches only npm's download cache, runs the complete static gate, runs extension tests under Xvfb, creates the VSIX, validates its allowlist, and uploads the package. Generated output and `node_modules` are never restored as caches or committed artifacts.
