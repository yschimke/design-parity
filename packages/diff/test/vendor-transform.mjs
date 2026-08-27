/**
 * The one declared difference between an upstream engine module and its vendored copy.
 *
 * These files are *not* a port. They are `compose-ai-tools`'
 * `scripts/design-artifacts/*.mjs` byte-for-byte, with two mechanical edits applied so TypeScript
 * will accept them in this build:
 *
 * 1. a `// @ts-nocheck` line prepended — they are plain JavaScript with JSDoc, and typechecking
 *    them here would mean either annotating a copy we do not own or weakening this package's
 *    config for everything else;
 * 2. relative specifiers rewritten `./x.mjs` → `./x.js`, because the emitted output is `.js`.
 *
 * Nothing else. That is what makes {@link toUpstream} exact: the transform is injective, so the
 * upstream bytes can be *recovered* from a vendored file and hashed, and the provenance test can
 * prove a copy is genuinely upstream-at-the-pinned-commit without a checkout or a network call.
 * The moment someone edits a vendored file in place — the failure this exists to catch, and one
 * that has already happened here twice — the recovered bytes stop hashing to the recorded digest.
 *
 * If a future vendored module needs a third edit, add it here *and* to the inverse, or the drift it
 * introduces becomes invisible again.
 */

/** Upstream `.mjs` source → the vendored `.ts` text. */
export function toVendored(source) {
  return `// @ts-nocheck\n${source.replace(/(from\s*"\.\/[A-Za-z0-9._-]+)\.mjs"/g, '$1.js"')}`;
}

/** The exact inverse of {@link toVendored}. Throws if the input is not a vendored file. */
export function toUpstream(vendored) {
  const marker = "// @ts-nocheck\n";
  if (!vendored.startsWith(marker)) {
    throw new Error("not a vendored module: missing the `// @ts-nocheck` line");
  }
  return vendored
    .slice(marker.length)
    .replace(/(from\s*"\.\/[A-Za-z0-9._-]+)\.js"/g, '$1.mjs"');
}
