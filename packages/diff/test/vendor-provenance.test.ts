import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error — plain JS helper, shared with the sync script so the two cannot disagree.
import { toUpstream, toVendored } from "./vendor-transform.mjs";

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
    ['import { x } from "./a.mjs";', 'import { x } from "./a.js";'],
    ["import { x } from './a.mjs';", "import { x } from './a.js';"],
    ['import "./side-effect.mjs";', 'import "./side-effect.js";'],
    ['const m = await import("./dyn.mjs");', 'const m = await import("./dyn.js");'],
    ['export { y } from "../up/b.mjs";', 'export { y } from "../up/b.js";'],
    ['const nested = "./deep/dir/c.mjs";', 'const nested = "./deep/dir/c.js";'],
    // Not a relative specifier, so not the transform's business — and rewriting it would corrupt
    // a string the module means literally.
    ['const notAPath = "keep.mjs";', 'const notAPath = "keep.mjs";'],
  ])("rewrites %s and inverts exactly", (upstream: string, expected: string) => {
    // The transform is *declared*, so it has to cover every relative-specifier form ESM allows —
    // not merely the one upstream happens to use today. A form it misses passes the round-trip and
    // the digest check unchanged (both are built from this same pattern) while the emitted module
    // resolves a `.mjs` file the build never writes: green sync, runtime failure.
    const vendored: string = toVendored(upstream);
    expect(vendored).toBe(`// @ts-nocheck\n${expected}`);
    expect(toUpstream(vendored)).toBe(upstream);
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
