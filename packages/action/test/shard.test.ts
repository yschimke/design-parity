import { describe, expect, it } from "vitest";

import {
  mergeShards,
  parseShard,
  partitionComponents,
  verifyShardReports,
  SHARD_FORMAT_VERSION,
  type ShardReport,
} from "../src/shard.js";

const COMPONENTS = [
  "ui/Buttons.kt#Filled",
  "ui/Buttons.kt#Outlined",
  "ui/Cards.kt#Elevated",
  "ui/Cards.kt#Filled",
  "ui/Chips.kt#Assist",
  "ui/Chips.kt#Input",
  "ui/Dialogs.kt#Basic",
];

function shard(over: Partial<ShardReport> = {}): ShardReport {
  return {
    formatVersion: SHARD_FORMAT_VERSION,
    index: 1,
    total: 2,
    components: [],
    direction: "design-led",
    status: "pass",
    blocked: false,
    warnings: [],
    entries: [],
    ...over,
  };
}

describe("parseShard", () => {
  it("parses <index>/<total> and the : spelling", () => {
    expect(parseShard("2/6")).toEqual({ index: 2, total: 6 });
    expect(parseShard(" 3 : 4 ")).toEqual({ index: 3, total: 4 });
  });

  it("is absent for no flag", () => {
    expect(parseShard(undefined)).toBeUndefined();
    expect(parseShard("")).toBeUndefined();
  });

  // A typo'd selector that silently compared everything (or nothing) would
  // publish a merged index that looks complete, so it must fail loudly.
  it("rejects malformed and out-of-range selectors", () => {
    expect(() => parseShard("2")).toThrow(/expects <index>\/<total>/);
    expect(() => parseShard("a/b")).toThrow(/expects <index>\/<total>/);
    expect(() => parseShard("0/4")).toThrow(/outside 1\.\.4/);
    expect(() => parseShard("5/4")).toThrow(/outside 1\.\.4/);
  });
});

describe("partitionComponents", () => {
  it("covers every component exactly once across the shards", () => {
    const total = 3;
    const slices = [1, 2, 3].map((index) =>
      partitionComponents(COMPONENTS, { index, total }),
    );
    expect(slices.flat().sort()).toEqual([...COMPONENTS].sort());
    const seen = new Set(slices.flat());
    expect(seen.size).toBe(COMPONENTS.length);
  });

  it("is deterministic and order-independent — every shard derives the same partition", () => {
    const forward = partitionComponents(COMPONENTS, { index: 2, total: 3 });
    const shuffled = [...COMPONENTS].reverse();
    expect(partitionComponents(shuffled, { index: 2, total: 3 })).toEqual(forward);
  });

  it("de-duplicates a repeated component so two shards cannot both claim it", () => {
    const dupes = [...COMPONENTS, COMPONENTS[0]!];
    const all = [1, 2].flatMap((index) => partitionComponents(dupes, { index, total: 2 }));
    expect(all.filter((c) => c === COMPONENTS[0]).length).toBe(1);
  });

  it("interleaves rather than blocking, so one heavy file does not land in one shard", () => {
    // Both `Buttons.kt` previews sort adjacently; a contiguous partition would
    // put them in the same shard, which is the straggler this avoids.
    const first = partitionComponents(COMPONENTS, { index: 1, total: 2 });
    const second = partitionComponents(COMPONENTS, { index: 2, total: 2 });
    expect(first).toContain("ui/Buttons.kt#Filled");
    expect(second).toContain("ui/Buttons.kt#Outlined");
  });

  it("hands the tail shards an empty slice when there are more shards than components", () => {
    expect(partitionComponents(["a", "b"], { index: 3, total: 4 })).toEqual([]);
    expect(partitionComponents(["a", "b"], { index: 1, total: 4 })).toEqual(["a"]);
  });

  it("is a no-op at one shard", () => {
    expect(partitionComponents(COMPONENTS, { index: 1, total: 1 })).toEqual(
      [...COMPONENTS].sort(),
    );
  });
});

describe("verifyShardReports", () => {
  it("accepts a complete, disjoint run", () => {
    const reports = [1, 2].map((index) =>
      shard({ index, components: partitionComponents(COMPONENTS, { index, total: 2 }) }),
    );
    expect(verifyShardReports(reports)).toEqual([]);
  });

  // The expensive failure: a lost upload leaves the merged index missing a
  // slice, which reads as "clean" rather than "not checked".
  it("catches a shard that never reported", () => {
    const reports = [shard({ index: 1, total: 3 }), shard({ index: 3, total: 3 })];
    expect(verifyShardReports(reports)).toContainEqual(
      expect.stringContaining("shard(s) 2 of 3 did not report"),
    );
  });

  it("catches shards disagreeing on the run size", () => {
    const reports = [shard({ index: 1, total: 2 }), shard({ index: 2, total: 4 })];
    expect(verifyShardReports(reports).join("\n")).toMatch(/disagree on the run size/);
  });

  it("catches a duplicated shard and a doubly-claimed component", () => {
    const reports = [
      shard({ index: 1, components: ["ui/A.kt#One"] }),
      shard({ index: 1, components: ["ui/A.kt#One"] }),
    ];
    const problems = verifyShardReports(reports).join("\n");
    expect(problems).toMatch(/shard 1 was supplied 2 times/);
    expect(problems).toMatch(/'ui\/A.kt#One' was claimed by shards 1 and 1/);
  });

  it("catches a shard written at an incompatible format version", () => {
    const reports = [
      shard({ index: 1, formatVersion: SHARD_FORMAT_VERSION + 1 }),
      shard({ index: 2 }),
    ];
    expect(verifyShardReports(reports).join("\n")).toMatch(/formatVersion/);
  });

  it("rejects an empty set rather than merging nothing", () => {
    expect(verifyShardReports([])).toEqual(["no shard reports were supplied"]);
  });
});

describe("mergeShards", () => {
  it("takes the worst status and ORs blocked, as a serial run would", () => {
    const merged = mergeShards([
      shard({ index: 1, status: "pass" }),
      shard({ index: 2, status: "fail", blocked: true }),
    ]);
    expect(merged.status).toBe("fail");
    expect(merged.blocked).toBe(true);
  });

  it("keeps warn from escalating past fail and pass from masking warn", () => {
    expect(
      mergeShards([shard({ index: 1, status: "warn" }), shard({ index: 2 })]).status,
    ).toBe("warn");
  });

  it("orders entries by component, not by which shard finished first", () => {
    const merged = mergeShards([
      shard({ index: 2, entries: [{ code: "ui/B.kt#One", status: "pass" }] }),
      shard({ index: 1, entries: [{ code: "ui/A.kt#One", status: "pass" }] }),
    ]);
    expect(merged.entries.map((e) => e.code)).toEqual(["ui/A.kt#One", "ui/B.kt#One"]);
  });

  // Shared-input warnings (a bad tokensFile, a design-map issue) are emitted by
  // every shard that loaded them; six copies on the landing page is noise.
  it("de-duplicates warnings across shards but keeps distinct ones in shard order", () => {
    const merged = mergeShards([
      shard({ index: 1, warnings: ["bad tokensFile", "ui/A.kt#One: no candidate"] }),
      shard({ index: 2, warnings: ["bad tokensFile", "ui/B.kt#One: no candidate"] }),
    ]);
    expect(merged.warnings).toEqual([
      "bad tokensFile",
      "ui/A.kt#One: no candidate",
      "ui/B.kt#One: no candidate",
    ]);
  });

  it("refuses shards that ran against different directions", () => {
    expect(() =>
      mergeShards([
        shard({ index: 1, direction: "design-led" }),
        shard({ index: 2, direction: "code-led" }),
      ]),
    ).toThrow(/disagree on the parity direction/);
  });

  it("refuses to merge nothing", () => {
    expect(() => mergeShards([])).toThrow(/no shard reports/);
  });
});
