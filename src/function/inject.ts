// Per-publish values injected by string replacement on the BUILT bundle (dist/function/k.js).
// Publish replaces each quoted placeholder with JSON.stringify(value), so these stay valid
// string literals. Non-secret config (pageId, pin digits, feature flags) comes from env vars
// set at publish; secrets (pin hash/salt, signing secret, model key) never get bundled.
//
// The defaults below are only used in dev/typecheck; a real deploy always replaces them.

export const PAGE_HTML = "__SIMPLY_HTML_PAGE_HTML__";
export const RUNTIME_JS = "__SIMPLY_HTML_RUNTIME_JS__";
