#!/usr/bin/env node
/**
 * Widen the parameter types that declaration emit gets wrong for the vendored modules.
 *
 * The modules are untyped JavaScript under `// @ts-nocheck`, so TypeScript infers each parameter's
 * declared type from its default. For most that gives `any`. For a parameter that defaults to a
 * literal it gives the literal's type, and that rejects every real argument:
 *
 *   masks = []      →  masks?: never[]     (a non-empty array is TS2322)
 *   catalog = null  →  catalog?: null      (any catalog is TS2322)
 *
 * The fix belongs in the emitted `.d.ts`, not in `src/`: the sources are compose-ai-tools' bytes
 * under one declared transform (see `test/vendor-transform.mjs`), and editing them would break the
 * provenance check. Widening only these two shapes keeps every other inferred type, including the
 * `| null` on return types that callers need to see.
 *
 * Idempotent, and `test/declarations.test.ts` fails if either shape is published again.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

const files = readdirSync(DIST).filter((name) => name.endsWith(".d.ts"));
if (files.length === 0) {
  process.stderr.write(`no declarations in ${DIST}; run tsc --build first\n`);
  process.exit(1);
}

for (const name of files) {
  const path = join(DIST, name);
  const before = readFileSync(path, "utf8");
  const after = before
    // `x = []`: an optional parameter or destructured option typed as an empty-array literal.
    .replace(/\?: never\[\](?: \| undefined)?/g, "?: unknown[]")
    // `x = null`: the same, for a null default.
    .replace(/\?: null(?: \| undefined)?(?=[;,)])/g, "?: unknown");
  if (after !== before) writeFileSync(path, after);
}
