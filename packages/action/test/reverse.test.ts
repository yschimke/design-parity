import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runReverse } from "../src/reverse.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dp-reverse-"));
  await writeFile(
    join(dir, "design-map.json"),
    JSON.stringify({
      components: [
        { code: "ui/Card.kt#OfferCard", source: "stitch", ref: "stitch:proj/card" },
        {
          code: "ui/Device.kt#DeviceScreen",
          source: "figma",
          ref: [
            { ref: "figma:K/10:2", state: "default" },
            { ref: "figma:K/10:8", state: "error" },
          ],
        },
      ],
    }),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("runReverse", () => {
  it("prints the code implementing a ref, including a multi-node frame", async () => {
    const c = capture();
    expect(await runReverse(["figma:K/10:8"], c.io, dir)).toBe(0);
    expect(c.out).toEqual(["ui/Device.kt#DeviceScreen"]);
  });

  it("resolves a string ref too", async () => {
    const c = capture();
    expect(await runReverse(["stitch:proj/card"], c.io, dir)).toBe(0);
    expect(c.out).toEqual(["ui/Card.kt#OfferCard"]);
  });

  it("returns 1 with a message for a ref that maps to nothing", async () => {
    const c = capture();
    expect(await runReverse(["figma:K/0:0"], c.io, dir)).toBe(1);
    expect(c.out).toEqual([]);
    expect(c.err.join("")).toContain("no code maps to 'figma:K/0:0'");
  });

  it("dumps the whole ref → code map, sorted, when no ref is given", async () => {
    const c = capture();
    expect(await runReverse([], c.io, dir)).toBe(0);
    expect(c.out).toEqual([
      "figma:K/10:2\tui/Device.kt#DeviceScreen",
      "figma:K/10:8\tui/Device.kt#DeviceScreen",
      "stitch:proj/card\tui/Card.kt#OfferCard",
    ]);
  });

  it("honours --repo and returns 2 when there is no design-map.json", async () => {
    const empty = await mkdtemp(join(tmpdir(), "dp-empty-"));
    const c = capture();
    expect(await runReverse(["x", "--repo", empty], c.io, dir)).toBe(2);
    expect(c.err.join("")).toContain("no readable design-map.json");
    await rm(empty, { recursive: true, force: true });
  });
});
