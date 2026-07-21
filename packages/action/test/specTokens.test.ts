import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { DesignMap } from "@design-parity/core";

import { loadSpecTokens, specTokenKey } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

describe("loadSpecTokens", () => {
  it("returns an empty map for a missing design-map", async () => {
    const { byCode, warnings } = await loadSpecTokens(undefined, repoRoot);
    expect(byCode.size).toBe(0);
    expect(warnings).toEqual([]);
  });

  it("loads a component's DTCG tokensFile into the spec map", async () => {
    const designMap: DesignMap = {
      components: [
        {
          code: "ui/Offer.kt#OfferCard",
          source: "bundle",
          ref: "fixtures/bundle/offer-card.zip",
          tokensFile: "fixtures/tokens.tokens.json",
        },
      ],
    };
    const { byCode, warnings } = await loadSpecTokens(designMap, repoRoot);
    expect(warnings).toEqual([]);
    const tokens = byCode.get(specTokenKey("ui/Offer.kt#OfferCard", "bundle"));
    // The DTCG fixture resolves `color/brand` from the `{color.primary}` alias.
    expect(tokens?.colors?.["color/brand"]).toBe("#6750A4");
    expect(tokens?.radius?.["shape/corner-radius"]).toBe(12);
  });

  it("reads a token file shared across components once", async () => {
    const entry = (code: string) => ({
      code,
      source: "bundle" as const,
      ref: "x",
      tokensFile: "fixtures/tokens.tokens.json",
    });
    const designMap: DesignMap = {
      components: [entry("a#One"), entry("b#Two")],
    };
    const { byCode } = await loadSpecTokens(designMap, repoRoot);
    expect(byCode.get(specTokenKey("a#One", "bundle"))).toBe(
      byCode.get(specTokenKey("b#Two", "bundle")),
    ); // same cached object
  });

  it("keys spec tokens by source so same-code sources don't collide (#106)", async () => {
    const designMap: DesignMap = {
      components: [
        {
          code: "ui/Card.kt#OfferCard",
          source: "stitch",
          ref: "stitch:design/abc",
          tokensFile: "fixtures/tokens.tokens.json",
        },
        {
          code: "ui/Card.kt#OfferCard",
          source: "claude-design",
          ref: "design/offer.html",
        },
      ],
    };
    const { byCode } = await loadSpecTokens(designMap, repoRoot);
    // Only the stitch entry declares a tokensFile; the claude-design entry for
    // the same code keeps its own (empty) slot rather than inheriting it.
    expect(byCode.get(specTokenKey("ui/Card.kt#OfferCard", "stitch"))).toBeDefined();
    expect(
      byCode.get(specTokenKey("ui/Card.kt#OfferCard", "claude-design")),
    ).toBeUndefined();
  });

  it("warns and skips a component whose tokensFile is unreadable", async () => {
    const designMap: DesignMap = {
      components: [
        { code: "a#b", source: "bundle", ref: "x", tokensFile: "no/such.tokens.json" },
      ],
    };
    const { byCode, warnings } = await loadSpecTokens(designMap, repoRoot);
    expect(byCode.size).toBe(0);
    expect(warnings.join(" ")).toMatch(/cannot read/);
  });
});
