import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { DesignMap } from "@design-parity/core";

import { loadSpecTokens } from "../src/index.js";

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
    const tokens = byCode.get("ui/Offer.kt#OfferCard");
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
    expect(byCode.get("a#One")).toBe(byCode.get("b#Two")); // same cached object
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
