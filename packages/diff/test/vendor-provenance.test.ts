import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error — plain JS helper, shared with the sync script so the two cannot disagree.
import { toUpstream, toVendored } from "./vendor-transform.mjs";
// @ts-expect-error — plain JS helper, shared with the sync script so the two cannot disagree.
import { namesUpstream } from "./vendor-upstream.mjs";

const VENDOR_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "acceptance",
  "vendor",
);
const PROVENANCE = join(VENDOR_DIR, "PROVENANCE.json");

interface Provenance {
  repository: string;
  commit: string;
  fixtures: {
    upstream: string;
    archive: string;
    fileCount: number;
    archiveSha256: string;
  };
  files: Record<
    string,
    { upstream: string; upstreamSha256: string; vendoredSha256: string }
  >;
}

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

const provenance: Provenance = JSON.parse(readFileSync(PROVENANCE, "utf8"));
const onDisk = readdirSync(VENDOR_DIR)
  .filter((name) => name.endsWith(".ts"))
  .sort();

/**
 * The vendored engine is a *copy*, and until now nothing said so out loud.
 *
 * `src/acceptance/vendor/*.ts` are `compose-ai-tools`' `scripts/design-artifacts/*.mjs` with one
 * declared mechanical transform applied. Two copies of a scoring engine that can drift apart is
 * the exact failure the contract exists to prevent — a fix ported into one and not the other means
 * the two report different numbers for the same pixels, which is worse than either being wrong,
 * because each looks self-consistent.
 *
 * It has already happened here twice: a local hardening of `projectTagIndex` that a later
 * re-vendor silently reverted, and two modules that acquired a stray trailing newline. Neither was
 * visible to any test, because "vendored faithfully" and "vendored then edited" looked identical.
 *
 * The transform being *injective* is what buys the check. The upstream bytes can be recovered from
 * a vendored file and hashed, so this proves the copy is genuinely upstream-at-the-pinned-commit
 * without a checkout, a network call, or trusting whoever ran the sync last.
 */
describe("vendored known-differences engine provenance", () => {
  it("pins the conformance corpus to the same commit as the engine", () => {
    // A kernel change moves the expected scores across the corpus, so an engine and a corpus from
    // different revisions make the conformance result meaningless *while still passing*. One sync
    // writes both at one verified commit; this checks the archive on disk is the one it recorded.
    const archive = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "fixtures", "known-differences.zip"),
    );
    expect(createHash("sha256").update(archive).digest("hex")).toBe(
      provenance.fixtures.archiveSha256,
    );
    expect(provenance.fixtures.fileCount).toBeGreaterThan(0);
  });

  it.each([
    // Specifiers — every form ESM allows, in all three quote styles.
    ['import { x } from "./a.mjs";', 'import { x } from "./a.js";'],
    ["import { x } from './a.mjs';", "import { x } from './a.js';"],
    ["import { x } from `./a.mjs`;", "import { x } from `./a.js`;"],
    ['import "./side-effect.mjs";', 'import "./side-effect.js";'],
    ['const m = await import("./dyn.mjs");', 'const m = await import("./dyn.js");'],
    ['export { y } from "../up/b.mjs";', 'export { y } from "../up/b.js";'],
    ['export * from "./star.mjs";', 'export * from "./star.js";'],
    // Not specifiers — filenames the module means literally. Rewriting one changes what it opens
    // at runtime, and the inverse restores it perfectly, so the round-trip and the digest both
    // still pass: a change nothing anywhere reports. The word `from` inside a string is the same
    // trap from the other side.
    ['const fixture = "./fixtures/case.mjs";', 'const fixture = "./fixtures/case.mjs";'],
    ['const msg = "copied from ./a.mjs";', 'const msg = "copied from ./a.mjs";'],
    ['const notAPath = "keep.mjs";', 'const notAPath = "keep.mjs";'],
  ])("rewrites %s and inverts exactly", (upstream: string, expected: string) => {
    // The transform is *declared*, so it has to be exact in both directions: broad enough to reach
    // every specifier, narrow enough to leave every other string alone. Both failures are silent —
    // one emits a module resolving a file the build never writes, the other quietly changes a
    // filename — and neither is visible to the digest check, which is built from this same pattern.
    const vendored: string = toVendored(upstream);
    expect(vendored).toBe(`// @ts-nocheck\n${expected}`);
    expect(toUpstream(vendored)).toBe(upstream);
  });

  it.each([
    ["https://github.com/yschimke/compose-ai-tools.git", true],
    ["https://github.com/yschimke/compose-ai-tools", true],
    ["git@github.com:yschimke/compose-ai-tools.git", true],
    ["ssh://git@github.com/yschimke/compose-ai-tools", true],
    // The path suffix is right and the repository is not. A first version of this check accepted
    // all three: reachability then proves only that the commit exists on the impostor, so a
    // provenance record could look fully verified while naming bytes never landed upstream.
    ["https://evil.example/yschimke/compose-ai-tools.git", false],
    ["git@evil.example:yschimke/compose-ai-tools.git", false],
    ["/tmp/x/yschimke/compose-ai-tools", false],
    // A host that merely *starts* with the real one — why this parses the URL instead of matching
    // a pattern against it.
    ["https://github.com.evil.example/yschimke/compose-ai-tools", false],
    ["https://github.com/yschimke/design-parity", false],
  ])("%s names upstream: %s", (url: string, expected: boolean) => {
    expect(namesUpstream(url)).toBe(expected);
  });

  it("records every vendored module, and only vendored modules", () => {
    expect(Object.keys(provenance.files).sort()).toEqual(onDisk);
    expect(provenance.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it.each(onDisk)("%s is upstream at the pinned commit, modulo the transform", (name) => {
    const record = provenance.files[name];
    expect(record, `${name} is not in PROVENANCE.json — re-run the sync`).toBeDefined();

    const vendored = readFileSync(join(VENDOR_DIR, name), "utf8");

    // Recover the upstream bytes and hash them. A local edit to the vendored copy — the failure
    // mode this exists for — changes this digest even when it looks like an innocent one-line fix.
    const recovered: string = toUpstream(vendored);
    expect(
      sha256(recovered),
      `${name} is not ${provenance.commit}:${record.upstream}. Land the change upstream, then ` +
        `re-run: node packages/diff/test/sync-known-differences-vendor.mjs <compose-ai-tools-checkout>`,
    ).toBe(record.upstreamSha256);

    // And the vendored digest, so a change to the transform itself cannot pass unnoticed by
    // cancelling out on the way back.
    expect(sha256(vendored)).toBe(record.vendoredSha256);

    // The two directions genuinely invert on this file's real content, not just on a contrived one.
    expect(toVendored(recovered)).toBe(vendored);
  });
});
