import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

import { parseArgs, main } from "../src/cli/shard-cli.js";
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

async function runShard(args: string[]): Promise<{ code: number; lines: string[] }> {
  let out = "";
  const stdout = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => ((out += chunk), true));
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  restore.push(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });
  const code = await main(args);
  return { code, lines: out.split("\n").filter(Boolean) };
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
