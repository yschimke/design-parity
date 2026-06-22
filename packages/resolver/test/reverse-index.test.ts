import { describe, it, expect } from "vitest";

import type { DesignMap } from "@design-parity/core";

import { buildReverseIndex, codeForRef } from "../src/index.js";

describe("buildReverseIndex", () => {
  const designMap: DesignMap = {
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
  };

  it("maps each ref (including every node of a multi-node binding) back to its code", () => {
    const index = buildReverseIndex(designMap);
    expect(codeForRef(index, "stitch:proj/card")).toEqual(["ui/Card.kt#OfferCard"]);
    expect(codeForRef(index, "figma:K/10:2")).toEqual(["ui/Device.kt#DeviceScreen"]);
    expect(codeForRef(index, "figma:K/10:8")).toEqual(["ui/Device.kt#DeviceScreen"]);
  });

  it("folds in Code Connect links", () => {
    const index = buildReverseIndex(undefined, {
      "ui/Button.kt#PrimaryButton": "figma:K/1:42",
    });
    expect(codeForRef(index, "figma:K/1:42")).toEqual(["ui/Button.kt#PrimaryButton"]);
  });

  it("returns every code for a shared ref, sorted and de-duplicated", () => {
    const shared: DesignMap = {
      components: [
        { code: "ui/B.kt#B", source: "figma", ref: "figma:K/9:9" },
        { code: "ui/A.kt#A", source: "figma", ref: "figma:K/9:9" },
      ],
    };
    expect(codeForRef(buildReverseIndex(shared), "figma:K/9:9")).toEqual([
      "ui/A.kt#A",
      "ui/B.kt#B",
    ]);
  });

  it("returns an empty list for an unknown ref", () => {
    expect(codeForRef(buildReverseIndex(designMap), "figma:K/0:0")).toEqual([]);
  });

  it("indexes a claude-design ref, including a .json synced-token artifact", () => {
    const map: DesignMap = {
      components: [
        {
          code: "ui/Card.kt#OfferCard",
          source: "claude-design",
          ref: "design/reference/offer-card.html",
        },
        {
          code: "ui/Theme.kt#AppTheme",
          source: "claude-design",
          ref: "design/design-system.tokens.json",
        },
      ],
    };
    const index = buildReverseIndex(map);
    expect(codeForRef(index, "design/reference/offer-card.html")).toEqual([
      "ui/Card.kt#OfferCard",
    ]);
    expect(codeForRef(index, "design/design-system.tokens.json")).toEqual([
      "ui/Theme.kt#AppTheme",
    ]);
  });
});
