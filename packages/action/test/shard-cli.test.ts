import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

import { parseArgs, main, parsePreviewUniverse } from "../src/cli/shard-cli.js";
import { partitionComponents } from "../src/shard.js";

const MAP = {
  components: [
    { code: "ui/A.kt#One", source: "figma", ref: "figma:F/1:1", previewId: "a-one" },
    { code: "ui/B.kt#Two", source: "figma", ref: "figma:F/1:2", previewId: "b-two" },
    { code: "ui/C.kt#Three", source: "figma", ref: "figma:F/1:3", previewId: "c-three" },
    {
      code: "ui/D.kt#Four",
      source: "figma",
      ref: "figma:F/1:4",
      // Two variants of one component: both must travel with it, or a shard
      // renders half a triptych.
      previewId: [
        { previewId: "d-four-light", theme: "light" },
        { previewId: "d-four-dark", theme: "dark" },
      ],
    },
  ],
};

async function repoWithMap(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dp-shard-"));
  await writeFile(join(root, "design-map.json"), JSON.stringify(MAP, null, 2));
  return root;
}

const restore: Array<() => void> = [];
afterEach(() => {
  for (const r of restore.splice(0)) r();
});

async function runShard(
  args: string[],
): Promise<{ code: number; lines: string[]; err: string }> {
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
  return { code, lines: out.split("\n").filter(Boolean), err };
}

describe("shard CLI args", () => {
  it("parses the selector, field and complement flags", () => {
    expect(
      parseArgs(["shard", "--shard", "2/6", "--field", "previewId", "--complement"]),
    ).toMatchObject({
      shard: { index: 2, total: 6 },
      field: "previewId",
      complement: true,
    });
  });

  it("defaults the field to the component handle", () => {
    expect(parseArgs(["shard", "--shard", "1/2"]).field).toBe("code");
  });
});

describe("shard", () => {
  it("prints usage and exits 2 without a selector", async () => {
    const { code, lines } = await runShard(["shard"]);
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("design-parity shard --shard");
  });

  it("defaults the universe to every component in the committed design map", async () => {
    const repo = await repoWithMap();
    const all: string[] = [];
    for (const index of [1, 2]) {
      const { lines } = await runShard(["shard", "--shard", `${index}/2`, "--repo", repo]);
      all.push(...lines);
    }
    expect(all.sort()).toEqual([
      "ui/A.kt#One",
      "ui/B.kt#Two",
      "ui/C.kt#Three",
      "ui/D.kt#Four",
    ]);
  });

  // The invariant the whole design rests on: the render step and
  // `run --shard` must select the same components, so they share one
  // implementation rather than two that can drift.
  it("agrees exactly with partitionComponents", async () => {
    const repo = await repoWithMap();
    const codes = MAP.components.map((c) => c.code);
    for (const index of [1, 2, 3]) {
      const { lines } = await runShard(["shard", "--shard", `${index}/3`, "--repo", repo]);
      expect(lines).toEqual(partitionComponents(codes, { index, total: 3 }));
    }
  });

  it("maps the slice to render ids, keeping a component's variants together", async () => {
    const repo = await repoWithMap();
    const owner = [1, 2, 3, 4].find((index) =>
      partitionComponents(
        MAP.components.map((c) => c.code),
        { index, total: 4 },
      ).includes("ui/D.kt#Four"),
    )!;
    const { lines } = await runShard([
      "shard", "--shard", `${owner}/4`, "--repo", repo, "--field", "previewId",
    ]);
    expect(lines).toEqual(["d-four-light", "d-four-dark"]);
  });

  // The exclusion list a render step needs: what this shard must NOT draw.
  it("prints the complement, disjoint from the slice and covering the rest", async () => {
    const repo = await repoWithMap();
    const mine = (await runShard(["shard", "--shard", "1/2", "--repo", repo])).lines;
    const theirs = (
      await runShard(["shard", "--shard", "1/2", "--repo", repo, "--complement"])
    ).lines;
    expect(mine.filter((c) => theirs.includes(c))).toEqual([]);
    expect([...mine, ...theirs].sort()).toEqual(MAP.components.map((c) => c.code).sort());
  });

  it("takes an explicit component list over the design map", async () => {
    const { lines } = await runShard([
      "shard", "--shard", "1/1", "--components", "z/Z.kt#Z,a/A.kt#A",
    ]);
    expect(lines).toEqual(["a/A.kt#A", "z/Z.kt#Z"]);
  });

  it("prints nothing for an empty slice — a no-op shard, not a failure", async () => {
    const { code, lines } = await runShard([
      "shard", "--shard", "3/3", "--components", "a/A.kt#A",
    ]);
    expect(code).toBe(0);
    expect(lines).toEqual([]);
  });
});

describe("parsePreviewUniverse", () => {
  it("reads a compose-preview discovery manifest", () => {
    expect(
      parsePreviewUniverse(
        JSON.stringify({ previews: [{ id: "a-one" }, { id: "z-nine" }] }),
      ),
    ).toEqual(["a-one", "z-nine"]);
  });

  it("reads a bare id array and a newline-delimited list alike", () => {
    expect(parsePreviewUniverse('["a-one","z-nine"]')).toEqual(["a-one", "z-nine"]);
    expect(parsePreviewUniverse("a-one\n z-nine \n\n")).toEqual(["a-one", "z-nine"]);
  });

  it("de-duplicates and keeps manifest order", () => {
    expect(parsePreviewUniverse("b\na\nb\n")).toEqual(["b", "a"]);
  });

  it("treats an empty file as an empty universe rather than throwing", () => {
    expect(parsePreviewUniverse("  \n ")).toEqual([]);
  });
});

// The bug this flag exists to fix: a catalog module draws far more previews than
// any component maps to, and a complement taken against the design map can never
// name the unmapped ones — so every shard renders the whole module and sharding
// divides nothing.
describe("shard --complement --preview-universe", () => {
  // 5 previews drawn; 4 of them (a-one, b-two, c-three, d-four-*) are mapped, so
  // `unmapped-x` stands in for m3-catalog's 1,018.
  const UNIVERSE = ["a-one", "b-two", "c-three", "d-four-light", "d-four-dark", "unmapped-x"];

  async function repoWithUniverse(): Promise<string> {
    const root = await repoWithMap();
    await writeFile(
      join(root, "previews.json"),
      JSON.stringify({ previews: UNIVERSE.map((id) => ({ id })) }),
    );
    return root;
  }

  it("excludes previews no component maps to — the whole point of the flag", async () => {
    const repo = await repoWithUniverse();
    const { lines } = await runShard([
      "shard", "--shard", "1/1", "--repo", repo,
      "--field", "previewId", "--complement",
      "--preview-universe", join(repo, "previews.json"),
    ]);
    // Identity partition: this shard owns every component, so the only thing
    // left to exclude is the unmapped preview. Without the flag this list is
    // EMPTY and the render draws all six.
    expect(lines).toEqual(["unmapped-x"]);
  });

  it("without the flag the complement misses the unmapped previews entirely", async () => {
    const repo = await repoWithUniverse();
    const { lines } = await runShard([
      "shard", "--shard", "1/1", "--repo", repo, "--field", "previewId", "--complement",
    ]);
    expect(lines).toEqual([]);
    expect(lines).not.toContain("unmapped-x");
  });

  it("each shard excludes the other shards' previews AND every unmapped one", async () => {
    const repo = await repoWithUniverse();
    const excluded: Record<number, string[]> = {};
    const kept: Record<number, string[]> = {};
    for (const i of [1, 2]) {
      excluded[i] = (
        await runShard([
          "shard", "--shard", `${i}/2`, "--repo", repo,
          "--field", "previewId", "--complement",
          "--preview-universe", join(repo, "previews.json"),
        ])
      ).lines;
      kept[i] = (
        await runShard([
          "shard", "--shard", `${i}/2`, "--repo", repo, "--field", "previewId",
        ])
      ).lines;
    }
    for (const i of [1, 2]) {
      // Exclusion and selection partition the universe exactly.
      expect([...kept[i], ...excluded[i]].sort()).toEqual([...UNIVERSE].sort());
      expect(excluded[i]).toContain("unmapped-x");
    }
    // Between them the two shards render every mapped preview, once.
    expect([...kept[1], ...kept[2]].sort()).toEqual(
      UNIVERSE.filter((id) => id !== "unmapped-x").sort(),
    );
  });

  it("keeps a component's variants together — never split across shards", async () => {
    const repo = await repoWithUniverse();
    for (const i of [1, 2]) {
      const kept = (
        await runShard([
          "shard", "--shard", `${i}/2`, "--repo", repo, "--field", "previewId",
        ])
      ).lines;
      const light = kept.includes("d-four-light");
      expect(kept.includes("d-four-dark")).toBe(light);
    }
  });

  it("warns, but still excludes, when the map names a preview the module never draws", async () => {
    const repo = await repoWithMap();
    await writeFile(
      join(repo, "previews.json"),
      // `c-three` was renamed or deleted in the module but is still mapped.
      JSON.stringify({ previews: [{ id: "a-one" }, { id: "b-two" }, { id: "stale" }] }),
    );
    const { code, lines, err } = await runShard([
      "shard", "--shard", "1/1", "--repo", repo,
      "--field", "previewId", "--complement",
      "--preview-universe", join(repo, "previews.json"),
    ]);
    // A stale annotation degrades one component's comparison; it must not take
    // the fan-out down with it.
    expect(code).toBe(0);
    expect(err).toContain("absent from the preview universe");
    expect(lines).toEqual(["stale"]);
  });
});
