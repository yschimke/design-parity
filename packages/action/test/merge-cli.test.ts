import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

import { parseArgs, readShardReport, main } from "../src/cli/merge.js";
import { SHARD_FORMAT_VERSION, type ShardReport } from "../src/shard.js";

/** Write one shard's out dir: `shard.json` plus a report subdir per component. */
async function writeShardDir(
  root: string,
  index: number,
  total: number,
  components: string[],
  over: Partial<ShardReport> = {},
): Promise<string> {
  const dir = join(root, `parity-shard-${index}`);
  await mkdir(dir, { recursive: true });
  for (const code of components) {
    const slug = code.replace(/[^a-z0-9_]+/gi, "-");
    await mkdir(join(dir, slug), { recursive: true });
    await writeFile(join(dir, slug, "report.html"), `<html>${code}</html>`);
  }
  // Each shard writes its own partial landing page; the merge must replace
  // these rather than let the last one copied win.
  await writeFile(join(dir, "index.html"), "<html>partial</html>");
  await writeFile(join(dir, "README.md"), "partial");
  const doc: ShardReport = {
    formatVersion: SHARD_FORMAT_VERSION,
    index,
    total,
    components,
    direction: "design-led",
    status: "pass",
    blocked: false,
    warnings: [],
    entries: components.map((code) => ({
      code,
      status: "pass" as const,
      reportPath: `${code.replace(/[^a-z0-9_]+/gi, "-")}/report.html`,
    })),
    ...over,
  };
  await writeFile(join(dir, "shard.json"), JSON.stringify(doc, null, 2));
  return dir;
}

const restore: Array<() => void> = [];
afterEach(() => {
  for (const r of restore.splice(0)) r();
});

/** Run `main()` with a stubbed argv, capturing stdout/stderr. */
async function runMerge(args: string[]): Promise<{
  code: number;
  out: string;
  err: string;
}> {
  let out = "";
  let err = "";
  const stdout = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => ((out += chunk), true));
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array) => ((err += chunk), true));
  restore.push(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });
  const code = await main(args);
  return { code, out, err };
}

describe("merge CLI args", () => {
  it("collects shard dirs positionally and takes --out/-o", () => {
    expect(parseArgs(["merge", "a", "b", "-o", "out"])).toMatchObject({
      shardDirs: ["a", "b"],
      outDir: "out",
    });
  });

  it("threads the landing-page link context through", () => {
    expect(
      parseArgs([
        "merge", "a",
        "--out", "out",
        "--repo-slug", "owner/repo",
        "--branch", "design-parity/main",
        "--source-commit", "abc123",
        "--bundle-image", "candidates.bundle.png",
      ]),
    ).toMatchObject({
      repoSlug: "owner/repo",
      branch: "design-parity/main",
      sourceCommit: "abc123",
      bundleImage: "candidates.bundle.png",
    });
  });
});

describe("readShardReport", () => {
  it("names the path when the dir is not a shard out dir", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    await expect(readShardReport(root)).rejects.toThrow(/no shard.json/);
  });
});

describe("merge", () => {
  it("unions the shards into the artifact set a serial run would have written", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const a = await writeShardDir(root, 1, 2, ["ui/A.kt#One", "ui/C.kt#Three"]);
    const b = await writeShardDir(root, 2, 2, ["ui/B.kt#Two"]);
    const out = join(root, "merged");

    const { code, out: log } = await runMerge([
      "merge", a, b,
      "--out", out,
      "--repo-slug", "owner/repo",
      "--branch", "design-parity/main",
    ]);

    expect(code).toBe(0);
    expect(log).toMatch(/Merged 2\/2 shard\(s\): 3 component\(s\)/);

    const entries = (await readdir(out)).sort();
    expect(entries).toEqual([
      "README.md",
      "index.html",
      "ui-A-kt-One",
      "ui-B-kt-Two",
      "ui-C-kt-Three",
    ]);
    // Every component's report survives the copy, from both shards.
    expect(await readFile(join(out, "ui-B-kt-Two", "report.html"), "utf8")).toContain(
      "ui/B.kt#Two",
    );
    // The merged landing page replaces the shards' partial ones and lists all
    // three components in component order, not shard-completion order.
    const index = await readFile(join(out, "index.html"), "utf8");
    expect(index).not.toContain("partial");
    expect(index.indexOf("A.kt#One")).toBeLessThan(index.indexOf("B.kt#Two"));
    expect(index.indexOf("B.kt#Two")).toBeLessThan(index.indexOf("C.kt#Three"));
  });

  it("accepts a shard.json path as well as its directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const a = await writeShardDir(root, 1, 1, ["ui/A.kt#One"]);
    const { code } = await runMerge([
      "merge",
      join(a, "shard.json"),
      "--out",
      join(root, "merged"),
    ]);
    expect(code).toBe(0);
  });

  // The whole point of verification: this runs after every shard has spent its
  // full budget, so a partial publish is the expensive failure.
  it("refuses to publish when a shard never reported", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const a = await writeShardDir(root, 1, 3, ["ui/A.kt#One"]);
    const { code, err } = await runMerge(["merge", a, "--out", join(root, "merged")]);
    expect(code).toBe(1);
    expect(err).toMatch(/refusing to publish a partial run/);
    expect(err).toMatch(/shard\(s\) 2, 3 of 3 did not report/);
  });

  // Artifacts first, verdict last — a blocking run still publishes the reports
  // that explain it.
  it("writes the artifacts before failing on a blocking verdict", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const a = await writeShardDir(root, 1, 2, ["ui/A.kt#One"]);
    const b = await writeShardDir(root, 2, 2, ["ui/B.kt#Two"], {
      status: "fail",
      blocked: true,
    });
    const out = join(root, "merged");

    const { code, out: log } = await runMerge(["merge", a, b, "--out", out]);

    expect(code).toBe(1);
    expect(log).toMatch(/Parity fail \(design-led\) — blocking/);
    expect(await readFile(join(out, "index.html"), "utf8")).toContain("A.kt#One");
    expect(await readdir(out)).toContain("ui-B-kt-Two");
  });

  it("prints usage and exits 2 without an --out", async () => {
    const { code, out } = await runMerge(["merge", "somewhere"]);
    expect(code).toBe(2);
    expect(out).toMatch(/design-parity merge/);
  });
});
