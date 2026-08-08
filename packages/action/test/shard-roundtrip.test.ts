import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

import { writeShardReport } from "../src/cli/run.js";
import { main as merge } from "../src/cli/merge.js";
import { partitionComponents, type ShardReport } from "../src/shard.js";

/**
 * The seam that matters: what `run --shard` writes must be what `merge` reads.
 * Unit tests cover each side; this pins the contract between them, so a change
 * to the `shard.json` shape can't pass by satisfying only one of them.
 */

const COMPONENTS = [
  "ui/A.kt#One",
  "ui/B.kt#Two",
  "ui/C.kt#Three",
  "ui/D.kt#Four",
  "ui/E.kt#Five",
];

const restore: Array<() => void> = [];
afterEach(() => {
  for (const r of restore.splice(0)) r();
});

/** Run `merge`, capturing its log instead of printing it. */
async function runMerge(args: string[]): Promise<{ code: number; log: string }> {
  let log = "";
  const out = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => ((log += chunk), true));
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  restore.push(() => {
    out.mockRestore();
    err.mockRestore();
  });
  return { code: await merge(args), log };
}

/** Stand in for a shard's `run`: write its reports, then its `shard.json`. */
async function runShard(root: string, index: number, total: number): Promise<string> {
  const mine = partitionComponents(COMPONENTS, { index, total });
  const outDir = join(root, `shard-${index}`);
  const entries = [];
  for (const code of mine) {
    const slug = code.replace(/[^a-z0-9_]+/gi, "-");
    await mkdir(join(outDir, slug), { recursive: true });
    await writeFile(join(outDir, slug, "report.html"), `<html>${code}</html>`);
    entries.push({
      code,
      source: "figma" as const,
      status: "pass" as const,
      reportPath: `${slug}/report.html`,
    });
  }
  await writeShardReport(
    outDir,
    { index, total },
    mine,
    {
      direction: "design-led",
      status: "pass",
      blocked: false,
      // Deliberately identical across shards: a warning about a shared input is
      // emitted by every shard that loaded it.
      warnings: ["tokensFile: unreadable, ignored"],
      indexEntries: entries,
    },
  );
  return outDir;
}

describe("run --shard → merge round trip", () => {
  it("reassembles the exhaustive run from its shards", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-round-"));
    const dirs = [];
    for (const index of [1, 2, 3]) dirs.push(await runShard(root, index, 3));
    const out = join(root, "merged");

    const { code, log } = await runMerge(["merge", ...dirs, "--out", out]);

    expect(code).toBe(0);
    expect(log).toMatch(/Merged 3\/3 shard\(s\): 5 component\(s\)/);
    const index = await readFile(join(out, "index.html"), "utf8");
    // Every component the run started with is on the merged landing page —
    // the coverage claim this whole design exists to keep.
    for (const component of COMPONENTS) {
      expect(index).toContain(component.slice(component.indexOf("/") + 1));
    }
    // All three shards reported the same shared-input warning; the merge says
    // it once.
    expect(log.match(/tokensFile: unreadable/g) ?? []).toHaveLength(1);
    expect(log).toMatch(/1 warning\(s\)/);
  });

  it("writes a shard.json for an empty slice, so a dead shard stays distinguishable", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-round-"));
    // 3 shards, 2 components: shard 3's slice is empty.
    const dirs = [];
    for (const index of [1, 2, 3]) {
      const mine = partitionComponents(["ui/A.kt#One", "ui/B.kt#Two"], {
        index,
        total: 3,
      });
      const outDir = join(root, `shard-${index}`);
      await writeShardReport(outDir, { index, total: 3 }, mine, {
        direction: "design-led",
        status: "pass",
        blocked: false,
        warnings: [],
        indexEntries: [],
      });
      dirs.push(outDir);
    }
    const doc = JSON.parse(
      await readFile(join(root, "shard-3", "shard.json"), "utf8"),
    ) as ShardReport;
    expect(doc.components).toEqual([]);

    // The empty shard still counts as reported, so the merge proceeds.
    const { code } = await runMerge(["merge", ...dirs, "--out", join(root, "merged")]);
    expect(code).toBe(0);
  });
});
