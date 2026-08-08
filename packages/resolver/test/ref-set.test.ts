import type { DesignMap } from "@design-parity/core";
import { describe, it, expect } from "vitest";

import { buildReverseIndex, codeForRef } from "../src/reverse-index.js";

/**
 * `refSet` exists because per-variant refs miss real usage. Measured on the
 * Material 3 kit: a screen's list items and carousel were instances of *sibling
 * variants* of components the catalog already mapped, so matching on the mapped
 * variant alone linked 3 of 11 instances. Indexing the family closes that.
 */
const FILE = "AbCdEf123456";

const withSet: DesignMap = {
  components: [
    {
      code: "ui/Lists.kt#ListItemSticker",
      source: "figma",
      // The one concrete variant parity diffs against…
      ref: `figma:${FILE}/51964:65404`,
      // …and the family every other variant on a screen belongs to.
      refSet: `figma:${FILE}/51964:63037`,
    },
  ],
};

describe("refSet in the reverse index", () => {
  it("resolves the family to the same code as its variant", () => {
    const index = buildReverseIndex(withSet);
    expect(codeForRef(index, `figma:${FILE}/51964:63037`)).toEqual(["ui/Lists.kt#ListItemSticker"]);
    expect(codeForRef(index, `figma:${FILE}/51964:65404`)).toEqual(["ui/Lists.kt#ListItemSticker"]);
  });

  it("does not displace the variant ref — both stay indexed", () => {
    const index = buildReverseIndex(withSet);
    // Parity still finds the concrete node it needs to diff against.
    expect(codeForRef(index, `figma:${FILE}/51964:65404`)).toHaveLength(1);
  });

  it("is optional — an entry without one behaves exactly as before", () => {
    const index = buildReverseIndex({
      components: [{ code: "ui/Button.kt#Primary", source: "figma", ref: `figma:${FILE}/1:2` }],
    });
    expect(codeForRef(index, `figma:${FILE}/1:2`)).toEqual(["ui/Button.kt#Primary"]);
    expect(codeForRef(index, `figma:${FILE}/9:9`)).toEqual([]);
  });

  it("lets two components share a family without collapsing them", () => {
    // Distinct codes mapping the same set is a real shape (a catalog picturing
    // several variants as separate stickers). Both must come back, sorted.
    const index = buildReverseIndex({
      components: [
        {
          code: "ui/TopAppBars.kt#SmallTopAppBar",
          source: "figma",
          ref: `figma:${FILE}/58114:20585`,
          refSet: `figma:${FILE}/58114:20565`,
        },
        {
          code: "ui/TopAppBars.kt#MediumTopAppBarSticker",
          source: "figma",
          ref: `figma:${FILE}/58114:20592`,
          refSet: `figma:${FILE}/58114:20565`,
        },
      ],
    });
    expect(codeForRef(index, `figma:${FILE}/58114:20565`)).toEqual([
      "ui/TopAppBars.kt#MediumTopAppBarSticker",
      "ui/TopAppBars.kt#SmallTopAppBar",
    ]);
    // The exact-variant lookup stays unambiguous, which is what keeps parity
    // pointed at one node even though the family is shared.
    expect(codeForRef(index, `figma:${FILE}/58114:20592`)).toEqual([
      "ui/TopAppBars.kt#MediumTopAppBarSticker",
    ]);
  });
});
