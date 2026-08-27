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

const MARKER = "// @ts-nocheck\n";

/**
 * Every relative-specifier form the rewrite has to reach.
 *
 * An earlier version matched only double-quoted static `from` clauses, which covered what upstream
 * happens to contain today and nothing more. That is not good enough for a *declared* transform:
 * a side-effect `import "./x.mjs"`, a dynamic `import("./x.mjs")` or a single-quoted specifier
 * would pass straight through, and — because the inverse and the digest check are built from this
 * same pattern — the round-trip would still verify. The sync would report success while emitting a
 * module that resolves a `.mjs` file the build never writes, failing only at runtime.
 *
 * So match the specifier by its delimiters rather than by the syntax around it: an opening quote or
 * backtick, `./` or `../`, a path, the extension, the matching closing delimiter.
 */
const specifier = (extension) =>
  new RegExp(String.raw`(["'\x60])(\.{1,2}/[A-Za-z0-9._\-/]+)\.${extension}\1`, "g");

/** Upstream `.mjs` source → the vendored `.ts` text. */
export function toVendored(source) {
  return `${MARKER}${source.replace(specifier("mjs"), "$1$2.js$1")}`;
}

/** The exact inverse of {@link toVendored}. Throws if the input is not a vendored file. */
export function toUpstream(vendored) {
  if (!vendored.startsWith(MARKER)) {
    throw new Error("not a vendored module: missing the `// @ts-nocheck` line");
  }
  return vendored.slice(MARKER.length).replace(specifier("js"), "$1$2.mjs$1");
}
