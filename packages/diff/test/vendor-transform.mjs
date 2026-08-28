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
 * The rewrite, scoped to **module specifiers only**.
 *
 * Two failure modes, and this pattern is the narrow path between them.
 *
 * Matching only double-quoted static `from` clauses — the first version — misses a side-effect
 * `import "./x.mjs"`, a dynamic `import("./x.mjs")` and any single-quoted specifier. Those pass
 * through untouched, and since the inverse and the digest check are built from this same pattern,
 * the round-trip still verifies while the emitted module resolves a `.mjs` file the build never
 * writes: a green sync, a runtime failure.
 *
 * Matching *any* quoted relative `.mjs` path — the over-correction — is worse, because it is
 * silent in both directions. An ordinary runtime string such as `const fixture = "./case.mjs"` is
 * a filename the module means literally; rewriting it changes what the module opens at runtime,
 * and the inverse restores it perfectly, so every test still passes and the digest still matches.
 * Nothing anywhere reports it.
 *
 * So anchor on the syntax that actually makes a string a specifier — `from`, or `import` with or
 * without its call parenthesis — and require the quote to open immediately after it. A literal
 * that merely contains the word (`"copied from ./a.mjs"`) has no quote in that position and is
 * left alone.
 *
 * "Immediately after" has to mean *after the comments too*. A comment is legal between the keyword
 * and its specifier — `import /* why *\/ "./a.mjs"`, and webpack's
 * `import(/* webpackChunkName: "x" *\/ "./a.mjs")` in particular, which puts one inside the
 * parenthesis. A gap of whitespace alone reached neither, so such a specifier kept its `.mjs` and
 * the vendored module resolved a file the TypeScript build never emits — the same silent runtime
 * failure the narrow first version had, reintroduced by the fix for it. The anchor is unchanged, so
 * nothing else is admitted.
 */
const GAP = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\n]*\n)*`;

const specifier = (extension) =>
  new RegExp(
    String.raw`(\b(?:from|import)${GAP}\(?${GAP})(["'\x60])(\.{1,2}/[A-Za-z0-9._\-/]+)\.${extension}\2`,
    "g",
  );

/** Upstream `.mjs` source → the vendored `.ts` text. */
export function toVendored(source) {
  return `${MARKER}${source.replace(specifier("mjs"), "$1$2$3.js$2")}`;
}

/** The exact inverse of {@link toVendored}. Throws if the input is not a vendored file. */
export function toUpstream(vendored) {
  if (!vendored.startsWith(MARKER)) {
    throw new Error("not a vendored module: missing the `// @ts-nocheck` line");
  }
  return vendored.slice(MARKER.length).replace(specifier("js"), "$1$2$3.mjs$2");
}
