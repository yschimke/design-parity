import { describe, it, expect } from "vitest";

import { computeCacheKey, decideSkip } from "../src/cache.js";
import type { RunManifest } from "../src/run-manifest.js";

const manifest = (over: Partial<RunManifest> = {}): RunManifest => ({
  formatVersion: 1,
  direction: "design-led",
  status: "pass",
  blocked: false,
  entries: [{ code: "a/A.kt#A", status: "pass" }],
  ...over,
});

describe("computeCacheKey", () => {
  it("is stable and order-independent", () => {
    expect(computeCacheKey({ a: "1", b: "2" })).toBe(
      computeCacheKey({ b: "2", a: "1" }),
    );
  });

  it("changes when any ingredient changes", () => {
    const base = computeCacheKey({ repo: "abc", figma: "v1" });
    expect(computeCacheKey({ repo: "abd", figma: "v1" })).not.toBe(base);
    expect(computeCacheKey({ repo: "abc", figma: "v2" })).not.toBe(base);
  });

  it("changes when an ingredient is added", () => {
    expect(computeCacheKey({ repo: "abc" })).not.toBe(
      computeCacheKey({ repo: "abc", renderer: "0.19.45" }),
    );
  });

  it("does not collide across the name/value boundary", () => {
    // Without self-delimiting parts these two hash the same string.
    expect(computeCacheKey({ a: "b=c" })).not.toBe(computeCacheKey({ "a=b": "c" }));
  });
});

describe("decideSkip", () => {
  it("skips when the key matches a complete previous board", () => {
    const d = decideSkip({
      previous: manifest({ cacheKey: "k", blocked: true }),
      key: "k",
    });
    expect(d).toEqual({
      skip: true,
      reason: "inputs unchanged since the previous run",
      blocked: true,
    });
  });

  it("carries the stored verdict, so a skip cannot go green by doing nothing", () => {
    const d = decideSkip({ previous: manifest({ cacheKey: "k", blocked: true }), key: "k" });
    expect(d.blocked).toBe(true);
  });

  it("runs when the key differs", () => {
    const d = decideSkip({ previous: manifest({ cacheKey: "old" }), key: "new" });
    expect(d.skip).toBe(false);
    expect(d.reason).toMatch(/inputs changed/);
  });

  it("runs when there is no previous board", () => {
    expect(decideSkip({ previous: undefined, key: "k" }).skip).toBe(false);
  });

  it("runs when the previous board recorded no key", () => {
    const d = decideSkip({ previous: manifest(), key: "k" });
    expect(d.skip).toBe(false);
    expect(d.reason).toMatch(/no cache key/);
  });

  it("runs when forced, even on an exact match", () => {
    const d = decideSkip({ previous: manifest({ cacheKey: "k" }), key: "k", force: true });
    expect(d).toEqual({ skip: false, reason: "forced" });
  });

  it("refuses to skip a partial board, which would freeze stale rows", () => {
    const previous = manifest({
      cacheKey: "k",
      entries: [
        { code: "a/A.kt#A", status: "pass" },
        { code: "b/B.kt#B", status: "pass", carriedFrom: "older" },
      ],
    });
    const d = decideSkip({ previous, key: "k" });
    expect(d.skip).toBe(false);
    expect(d.reason).toMatch(/partial \(1 row\(s\) carried forward\)/);
  });
});
