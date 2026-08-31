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
        "merge",
        "a",
        "--out",
        "out",
        "--repo-slug",
        "owner/repo",
        "--branch",
        "design-parity/main",
        "--source-commit",
        "abc123",
        "--bundle-image",
        "candidates.bundle.png",
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
      "merge",
      a,
      b,
      "--out",
      out,
      "--repo-slug",
      "owner/repo",
      "--branch",
      "design-parity/main",
    ]);

    expect(code).toBe(0);
    expect(log).toMatch(/Merged 2\/2 shard\(s\): 3 component\(s\)/);

    const entries = (await readdir(out)).sort();
    expect(entries).toEqual(
      [
        "README.md",
        // The machine-readable twin of the two pages above: what the NEXT run
        // reads to carry forward whatever it cannot refresh.
        "run.json",
        "index.html",
        "ui-A-kt-One",
        "ui-B-kt-Two",
        "ui-C-kt-Three",
      ].sort(),
    );
    // Every component's report survives the copy, from both shards.
    expect(
      await readFile(join(out, "ui-B-kt-Two", "report.html"), "utf8"),
    ).toContain("ui/B.kt#Two");
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
    const { code, err } = await runMerge([
      "merge",
      a,
      "--out",
      join(root, "merged"),
    ]);
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
    expect(await readFile(join(out, "index.html"), "utf8")).toContain(
      "A.kt#One",
    );
    expect(await readdir(out)).toContain("ui-B-kt-Two");
  });

  it("prints usage and exits 2 without an --out", async () => {
    const { code, out } = await runMerge(["merge", "somewhere"]);
    expect(code).toBe(2);
    expect(out).toMatch(/design-parity merge/);
  });
});

/** One shard's `findings.json`, keyed the way `orchestrate` writes it. */
async function writeShardFindings(
  dir: string,
  previews: Record<string, Array<Record<string, unknown>>>,
): Promise<void> {
  await writeFile(
    join(dir, "findings.json"),
    JSON.stringify({ schema: "compose-preview-parity-findings/v1", previews }),
  );
}

const finding = (message: string) => ({
  status: "fail",
  findings: [{ kind: "token", severity: "error", message }],
});

describe("merge (parity findings)", () => {
  it("unions every shard's findings, which live outside the report dirs", async () => {
    // The failure this guards: `copyComponentDirs` moves the reports and leaves each shard's
    // verdict behind, so a sharded run — the CI path — publishes a board whose rows say `fail`
    // and whose comparisons say nothing.
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const a = await writeShardDir(root, 1, 2, ["a/A.kt#A"]);
    const b = await writeShardDir(root, 2, 2, ["b/B.kt#B"]);
    await writeShardFindings(a, { "a/A.kt#A": [finding("A drifted")] });
    await writeShardFindings(b, { "b/B.kt#B": [finding("B drifted")] });
    const out = join(root, "out");

    const { code, out: log } = await runMerge(["merge", a, b, "--out", out]);
    expect(code).toBe(0);
    expect(log).toContain("findings");

    const doc = JSON.parse(await readFile(join(out, "findings.json"), "utf8"));
    expect(doc.schema).toBe("compose-preview-parity-findings/v1");
    expect(Object.keys(doc.previews).sort()).toEqual(["a/A.kt#A", "b/B.kt#B"]);
  });

  it("refuses to publish when a shard's findings are unreadable", async () => {
    // Treating a truncated file like an absent one publishes `fail` rows with no machine-readable
    // explanation behind any of them, and `verifyShardReports` cannot see the loss — it validates
    // `shard.json` only. Same posture as that check: refuse rather than publish a partial run.
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const a = await writeShardDir(root, 1, 1, ["a/A.kt#A"]);
    await writeFile(join(a, "findings.json"), '{"previews": {"a/A.kt#A": [');
    const out = join(root, "out");

    const { code, err } = await runMerge(["merge", a, "--out", out]);
    expect(code).toBe(1);
    expect(err).toContain("findings could not be merged");
    expect(err).toContain("not valid JSON");
  });

  it("leaves nothing publishable when it refuses over unreadable findings", async () => {
    // The refusal has to happen BEFORE the first write to `out`. The wrapper workflow publishes
    // whenever `out/**` is non-empty and folds every nonzero exit into `blocked=true`, so a
    // refusal taken after the reports and indexes are on disk ships the partial board it just
    // refused — and without a `run.json`, which is written later still.
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const a = await writeShardDir(root, 1, 1, ["a/A.kt#A"]);
    await writeFile(join(a, "findings.json"), '{"previews": {"a/A.kt#A": [');
    const out = join(root, "out");

    const { code } = await runMerge(["merge", a, "--out", out]);
    expect(code).toBe(1);
    await expect(readdir(out)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a manifest that parses but omits its previews map", async () => {
    // A producer never emits this: `writeParityFindings` deletes the file rather than writing an
    // empty map. So it means a truncated or foreign artifact, and reading it as "nothing to
    // report" would delete the manifest and publish failing rows with no explanations.
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const a = await writeShardDir(root, 1, 1, ["a/A.kt#A"]);
    await writeFile(
      join(a, "findings.json"),
      JSON.stringify({ schema: "compose-preview-parity-findings/v1" }),
    );
    const out = join(root, "out");

    const { code, err } = await runMerge(["merge", a, "--out", out]);
    expect(code).toBe(1);
    expect(err).toContain("no readable 'previews' map");
  });

  it("refuses a preview whose sets are not a list", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const a = await writeShardDir(root, 1, 1, ["a/A.kt#A"]);
    await writeFile(
      join(a, "findings.json"),
      JSON.stringify({
        schema: "compose-preview-parity-findings/v1",
        previews: { "a/A.kt#A": { status: "fail" } },
      }),
    );
    const out = join(root, "out");

    const { code, err } = await runMerge(["merge", a, "--out", out]);
    expect(code).toBe(1);
    expect(err).toContain("non-list set for 'a/A.kt#A'");
  });

  it("removes a previous merge's findings once the run comes back clean", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const a = await writeShardDir(root, 1, 1, ["a/A.kt#A"]);
    await writeShardFindings(a, { "a/A.kt#A": [finding("A drifted")] });
    const out = join(root, "out");
    expect((await runMerge(["merge", a, "--out", out])).code).toBe(0);
    await readFile(join(out, "findings.json"), "utf8");

    // A second shard-1-of-1 in its own root: same run shape, this time with nothing to report.
    const cleanRoot = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const b = await writeShardDir(cleanRoot, 1, 1, ["a/A.kt#A"]);
    expect((await runMerge(["merge", b, "--out", out])).code).toBe(0);
    await expect(
      readFile(join(out, "findings.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("writes nothing when no shard reported a finding", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const a = await writeShardDir(root, 1, 1, ["a/A.kt#A"]);
    const out = join(root, "out");

    const { code } = await runMerge(["merge", a, "--out", out]);
    expect(code).toBe(0);
    await expect(
      readFile(join(out, "findings.json"), "utf8"),
    ).rejects.toThrow();
  });
});

/** A previous run's published branch: `run.json` plus each row's report dir. */
async function writePreviousDir(
  root: string,
  entries: Array<{
    code: string;
    status?: "pass" | "fail";
    carriedFrom?: string;
  }>,
  sourceCommit = "0000000previous",
): Promise<string> {
  const dir = join(root, "previous");
  await mkdir(dir, { recursive: true });
  for (const e of entries) {
    const slug = e.code.replace(/[^a-z0-9_]+/gi, "-");
    await mkdir(join(dir, slug), { recursive: true });
    await writeFile(
      join(dir, slug, "report.html"),
      `<html>old ${e.code}</html>`,
    );
  }
  await writeFile(
    join(dir, "run.json"),
    JSON.stringify({
      formatVersion: 1,
      sourceCommit,
      direction: "design-led",
      status: "pass",
      blocked: false,
      entries: entries.map((e) => ({
        code: e.code,
        status: e.status ?? "pass",
        reportPath: `${e.code.replace(/[^a-z0-9_]+/gi, "-")}/report.html`,
        ...(e.carriedFrom ? { carriedFrom: e.carriedFrom } : {}),
      })),
    }),
  );
  return dir;
}

describe("merge --previous (partial refresh)", () => {
  it("carries a previous run's findings for the rows it carries", async () => {
    // Same rule as the board above them: a finding does not stop being one because this run
    // could not re-measure it. A carried row whose panel went blank would put a `fail` on the
    // board over a comparison saying nothing.
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const shard = await writeShardDir(root, 1, 1, ["a/A.kt#A"]);
    await writeShardFindings(shard, { "a/A.kt#A": [finding("A drifted")] });
    const previous = await writePreviousDir(root, [
      { code: "a/A.kt#A" },
      // `pass` so the merge is not blocked; a passing verdict still carries warnings, which is
      // exactly the row whose panel must not go blank on a partial refresh.
      { code: "b/B.kt#B" },
    ]);
    await writeShardFindings(previous, {
      "a/A.kt#A": [finding("stale A")],
      "b/B.kt#B": [finding("B drifted")],
    });
    const out = join(root, "out");

    const { code } = await runMerge([
      "merge",
      shard,
      "--out",
      out,
      "--previous",
      previous,
      "--source-commit",
      "abc1234",
    ]);
    expect(code).toBe(0);

    const doc = JSON.parse(await readFile(join(out, "findings.json"), "utf8"));
    // The carried row keeps its verdict…
    expect(doc.previews["b/B.kt#B"][0].findings[0].message).toBe("B drifted");
    // …and the re-measured one is this run's, not the previous run's.
    expect(
      doc.previews["a/A.kt#A"].map(
        (s: { findings: Array<{ message: string }> }) => s.findings[0].message,
      ),
    ).toEqual(["A drifted"]);
  });

  it("carries forward rows this run did not produce, with their reports", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const shard = await writeShardDir(root, 1, 1, ["a/A.kt#A"]);
    const previous = await writePreviousDir(root, [
      { code: "a/A.kt#A" },
      { code: "b/B.kt#B" },
    ]);
    const out = join(root, "out");

    const { code, out: log } = await runMerge([
      "merge",
      shard,
      "--out",
      out,
      "--previous",
      previous,
      "--source-commit",
      "abc1234",
    ]);

    expect(code).toBe(0);
    expect(log).toContain("Carried 1 component(s) forward");

    const manifest = JSON.parse(await readFile(join(out, "run.json"), "utf8"));
    expect(manifest.entries.map((e: { code: string }) => e.code)).toEqual([
      "a/A.kt#A",
      "b/B.kt#B",
    ]);
    // Refreshed this run, so no age; the other keeps the commit it came from.
    expect(manifest.entries[0].carriedFrom).toBeUndefined();
    expect(manifest.entries[1].carriedFrom).toBe("0000000previous");
    // The carried row's report came along, or its link would 404.
    expect(
      await readFile(join(out, "b-B-kt-B", "report.html"), "utf8"),
    ).toContain("old");
  });

  it("keeps the original commit when a row is carried more than once", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const shard = await writeShardDir(root, 1, 1, ["a/A.kt#A"]);
    const previous = await writePreviousDir(
      root,
      [{ code: "b/B.kt#B", carriedFrom: "1111111original" }],
      "2222222lastrun",
    );
    const out = join(root, "out");

    await runMerge(["merge", shard, "--out", out, "--previous", previous]);

    const manifest = JSON.parse(await readFile(join(out, "run.json"), "utf8"));
    const carried = manifest.entries.find(
      (e: { code: string }) => e.code === "b/B.kt#B",
    );
    expect(carried.carriedFrom).toBe("1111111original");
  });

  it("blocks on a carried-forward failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const shard = await writeShardDir(root, 1, 1, ["a/A.kt#A"]);
    const previous = await writePreviousDir(root, [
      { code: "b/B.kt#B", status: "fail" },
    ]);
    const out = join(root, "out");

    const { code } = await runMerge([
      "merge",
      shard,
      "--out",
      out,
      "--previous",
      previous,
    ]);

    expect(code).toBe(1);
  });

  // A carried row must not block what the same row would not have blocked when
  // it was fresh: under `code-led` a failing verdict is information, not a gate.
  it("does not block on a carried failure when the direction does not block", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const shard = await writeShardDir(root, 1, 1, ["a/A.kt#A"], {
      direction: "code-led",
    });
    const previous = await writePreviousDir(root, [
      { code: "b/B.kt#B", status: "fail" },
    ]);
    const out = join(root, "out");

    const { code } = await runMerge([
      "merge",
      shard,
      "--out",
      out,
      "--previous",
      previous,
    ]);

    expect(code).toBe(0);
  });

  it("is a no-op when the previous dir has no usable manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const shard = await writeShardDir(root, 1, 1, ["a/A.kt#A"]);
    const out = join(root, "out");

    const { code, out: log } = await runMerge([
      "merge",
      shard,
      "--out",
      out,
      "--previous",
      join(root, "does-not-exist"),
    ]);

    expect(code).toBe(0);
    expect(log).not.toContain("Carried");
  });

  it("writes run.json even with no previous run, so the next one has a base", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const shard = await writeShardDir(root, 1, 1, ["a/A.kt#A"]);
    const out = join(root, "out");

    await runMerge([
      "merge",
      shard,
      "--out",
      out,
      "--source-commit",
      "deadbee",
    ]);

    const manifest = JSON.parse(await readFile(join(out, "run.json"), "utf8"));
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.sourceCommit).toBe("deadbee");
    expect(manifest.entries).toHaveLength(1);
  });
});

/**
 * Carry-forward bounded by the design map.
 *
 * Carrying a row the run could not refresh is right for a transient miss and
 * wrong for a component that no longer exists: the second kind can never be
 * refreshed, so it is republished verbatim on every future run and never leaves
 * (yschimke/compose-ai-tools#4878). The bound is the map the shards report,
 * which is why these fixtures set `universe` — a `shard.json` without it is the
 * older shape, covered by the last case here.
 */
describe("merge --previous (bounded by the design map)", () => {
  it("drops a carried row whose component is gone from the map", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    // The map holds only A now: B has been renamed, moved or deleted.
    const shard = await writeShardDir(root, 1, 1, ["a/A.kt#A"], {
      universe: ["a/A.kt#A"],
    });
    const previous = await writePreviousDir(root, [
      { code: "a/A.kt#A" },
      { code: "b/B.kt#B" },
    ]);
    const out = join(root, "out");

    const { code, out: log } = await runMerge([
      "merge",
      shard,
      "--out",
      out,
      "--previous",
      previous,
      "--source-commit",
      "abc1234",
    ]);

    expect(code).toBe(0);
    const manifest = JSON.parse(await readFile(join(out, "run.json"), "utf8"));
    expect(manifest.entries.map((e: { code: string }) => e.code)).toEqual([
      "a/A.kt#A",
    ]);
    // Named in the log, not merely counted: a dropped row is the one
    // carry-forward decision that leaves no trace on the board afterwards.
    expect(log).toContain("Dropped 1 carried row(s)");
    expect(log).toContain("b/B.kt#B");
  });

  it("still carries a row the run missed but the map still has", async () => {
    // The case carry-forward exists for, and the one the bound must not break:
    // B is in the map, so failing to produce it this run is a miss, not a
    // deletion.
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const shard = await writeShardDir(root, 1, 1, ["a/A.kt#A"], {
      universe: ["a/A.kt#A", "b/B.kt#B"],
    });
    const previous = await writePreviousDir(root, [
      { code: "a/A.kt#A" },
      { code: "b/B.kt#B" },
    ]);
    const out = join(root, "out");

    const { code, out: log } = await runMerge([
      "merge",
      shard,
      "--out",
      out,
      "--previous",
      previous,
      "--source-commit",
      "abc1234",
    ]);

    expect(code).toBe(0);
    expect(log).toContain("Carried 1 component(s) forward");
    expect(log).not.toContain("Dropped");
    const manifest = JSON.parse(await readFile(join(out, "run.json"), "utf8"));
    expect(manifest.entries.map((e: { code: string }) => e.code)).toEqual([
      "a/A.kt#A",
      "b/B.kt#B",
    ]);
    expect(manifest.entries[1].carriedFrom).toBe("0000000previous");
    // The report came with it, or the row's link would 404.
    expect(
      await readFile(join(out, "b-B-kt-B", "report.html"), "utf8"),
    ).toContain("old");
  });

  it("keeps rows a narrowed run deliberately skipped", async () => {
    // The bound is the MAP, not what the run compared. A run narrowed with
    // `--components` assigns a subset on purpose; bounding by the assignment
    // would read every component it skipped as deleted and strip the board down
    // to the slice.
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const shard = await writeShardDir(root, 1, 1, ["a/A.kt#A"], {
      universe: ["a/A.kt#A", "b/B.kt#B", "c/C.kt#C"],
    });
    const previous = await writePreviousDir(root, [
      { code: "a/A.kt#A" },
      { code: "b/B.kt#B" },
      { code: "c/C.kt#C" },
    ]);
    const out = join(root, "out");

    const { code, out: log } = await runMerge([
      "merge",
      shard,
      "--out",
      out,
      "--previous",
      previous,
    ]);

    expect(code).toBe(0);
    expect(log).not.toContain("Dropped");
    const manifest = JSON.parse(await readFile(join(out, "run.json"), "utf8"));
    expect(manifest.entries.map((e: { code: string }) => e.code)).toEqual([
      "a/A.kt#A",
      "b/B.kt#B",
      "c/C.kt#C",
    ]);
  });

  it("carries everything when a shard reports no map", async () => {
    // Unknown bound, not a partial one. A union missing a shard's map cannot be
    // told apart from a map that never had those components, so one silent
    // shard would drop live rows — the older behaviour is the safe answer.
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const one = await writeShardDir(root, 1, 2, ["a/A.kt#A"], {
      universe: ["a/A.kt#A"],
    });
    const two = await writeShardDir(root, 2, 2, ["c/C.kt#C"]);
    const previous = await writePreviousDir(root, [{ code: "b/B.kt#B" }]);
    const out = join(root, "out");

    const { code, out: log } = await runMerge([
      "merge",
      one,
      two,
      "--out",
      out,
      "--previous",
      previous,
    ]);

    expect(code).toBe(0);
    expect(log).not.toContain("Dropped");
    const manifest = JSON.parse(await readFile(join(out, "run.json"), "utf8"));
    expect(manifest.entries.map((e: { code: string }) => e.code)).toContain(
      "b/B.kt#B",
    );
  });
});

/**
 * Shards must agree on the map before it can bound anything.
 *
 * `design-map-command` runs independently in every shard, so `universe` is a
 * claim each one makes rather than a fact merge is handed. Two shards that
 * disagree have not established what the map is, and the union of their claims
 * would let whichever had the stalest map decide a deleted component still
 * exists — quietly reinstating the behaviour the bound exists to remove.
 */
describe("merge --previous (shards must agree on the map)", () => {
  it("drops on a bound both shards report identically", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const universe = ["a/A.kt#A", "c/C.kt#C"];
    const one = await writeShardDir(root, 1, 2, ["a/A.kt#A"], { universe });
    // Same set, different order — agreement is about content, not serialisation.
    const two = await writeShardDir(root, 2, 2, ["c/C.kt#C"], {
      universe: [...universe].reverse(),
    });
    const previous = await writePreviousDir(root, [{ code: "b/B.kt#B" }]);
    const out = join(root, "out");

    const { code, out: log, err } = await runMerge([
      "merge",
      one,
      two,
      "--out",
      out,
      "--previous",
      previous,
    ]);

    expect(code).toBe(0);
    expect(err).not.toContain("do not agree");
    expect(log).toContain("Dropped 1 carried row(s)");
    const manifest = JSON.parse(await readFile(join(out, "run.json"), "utf8"));
    expect(manifest.entries.map((e: { code: string }) => e.code)).not.toContain(
      "b/B.kt#B",
    );
  });

  it("carries everything, and says so, when shards disagree", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    // Shard 2's map is stale: it still lists B, which shard 1 says is gone.
    const one = await writeShardDir(root, 1, 2, ["a/A.kt#A"], {
      universe: ["a/A.kt#A", "c/C.kt#C"],
    });
    const two = await writeShardDir(root, 2, 2, ["c/C.kt#C"], {
      universe: ["a/A.kt#A", "b/B.kt#B", "c/C.kt#C"],
    });
    // TWO carried rows, and D is the one that makes this test mean something.
    //
    // B is in shard 2's map, so it survives a union of the two disagreeing maps
    // just as it survives the fallback — asserting on B alone cannot tell those
    // apart, and an implementation that emitted the warning while still bounding
    // by the union would pass. D is in NEITHER map: the union drops it, and only
    // a genuine fallback to "no bound" carries it. So D is what separates the fix
    // from a warning bolted onto the old behaviour.
    const previous = await writePreviousDir(root, [
      { code: "b/B.kt#B" },
      { code: "d/D.kt#D" },
    ]);
    const out = join(root, "out");

    const { code, out: log, err } = await runMerge([
      "merge",
      one,
      two,
      "--out",
      out,
      "--previous",
      previous,
    ]);

    expect(code).toBe(0);
    // Reported, not swallowed: a bound that quietly downgrades looks exactly
    // like a run with nothing to drop.
    expect(err).toContain("do not agree on the component universe");
    expect(log).not.toContain("Dropped");
    const manifest = JSON.parse(await readFile(join(out, "run.json"), "utf8"));
    const codes = manifest.entries.map((e: { code: string }) => e.code);
    expect(codes).toContain("b/B.kt#B");
    expect(codes).toContain("d/D.kt#D");
  });
});

/**
 * The end an emptied design map is asking for: the board clears.
 *
 * A map that declares no components makes every shard report an empty universe,
 * which the bound reads as "nothing exists any more" — so every previous row is
 * dropped rather than carried. This is the case `shard-cli` used to make
 * unreachable by refusing an empty map outright.
 */
describe("merge --previous (an emptied design map clears the board)", () => {
  it("drops every carried row when the map declares none", async () => {
    const root = await mkdtemp(join(tmpdir(), "dp-merge-"));
    const one = await writeShardDir(root, 1, 2, [], { universe: [] });
    const two = await writeShardDir(root, 2, 2, [], { universe: [] });
    const previous = await writePreviousDir(root, [
      { code: "a/A.kt#A" },
      { code: "b/B.kt#B" },
    ]);
    const out = join(root, "out");

    const { code, out: log } = await runMerge([
      "merge",
      one,
      two,
      "--out",
      out,
      "--previous",
      previous,
    ]);

    expect(code).toBe(0);
    expect(log).toContain("Dropped 2 carried row(s)");
    const manifest = JSON.parse(await readFile(join(out, "run.json"), "utf8"));
    expect(manifest.entries).toEqual([]);
  });
});
