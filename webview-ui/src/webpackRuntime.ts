// Webpack propagates this nonce to scripts created by dynamic imports.
// The public path is inferred from bundle.js, keeping every chunk inside the local extension.
declare let __webpack_nonce__: string;
const script = document.currentScript;
if (script instanceof HTMLScriptElement) { __webpack_nonce__ = script.nonce ?? ''; }
