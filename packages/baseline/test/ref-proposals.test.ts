/**
 * Ranking design-reference proposals by name.
 *
 * The cases that matter are the ones where a *plausible* candidate is the wrong
 * one — an icon glyph that shares more tokens with a component's name than the
 * component set does, a building block at the wrong altitude. Those are what
 * the weighting exists for, and they are pinned here with the real names that
 * produced them.
 */
import { describe, expect, it } from "vitest";

import {
  candidatesFromTree,
  candidateWeight,
  confidenceOf,
  isBuildingBlock,
  isIcon,
  isPrivate,
  isXr,
  rankCandidates,
  score,
  subjectFor,
  subjectsFromPreviewManifest,
  type KitCandidate,
} from "../src/ref-proposals.js";

const candidate = (name: string, nodeId = "1:1", containing = ""): KitCandidate => ({
  name,
  nodeId,
  containing,
});

describe("score", () => {
  it("is the shared fraction of the shorter name", () => {
    expect(score("Button Filled", "Filled button")).toBe(1);
    expect(score("Button", "Button segment")).toBe(1);
    expect(score("Checkbox", "Radio button")).toBe(0);
  });

  it("ignores punctuation and case", () => {
    expect(score("Button/Tonal", "Button - tonal")).toBe(1);
  });

  it("is zero when either side has no tokens", () => {
    expect(score("", "Button")).toBe(0);
    expect(score("Button", "   ")).toBe(0);
  });

  it("sees through the plural a kit names a family with", () => {
    expect(score("Checkbox", "Checkboxes")).toBe(1);
    expect(score("Radio button", "Radio buttons")).toBe(1);
  });

  it("sees through a participle spelled as an adjective", () => {
    expect(score("Button Outlined", "Button - outline")).toBe(1);
    expect(score("Button Elevated", "Button - elevated")).toBe(1);
  });

  it("does not merge words that merely look alike", () => {
    // `-es` after a non-sibilant is one letter of plural, not two: stemming
    // `badges` to `badg` while `badge` stays put is a miss, not a match.
    expect(score("Badge Dot", "Badges")).toBe(1);
    // Short words are left alone; `grid` must not become `gri`.
    expect(score("Grid", "Grip")).toBe(0);
    expect(score("Card", "Cards")).toBe(1);
  });
});

describe("candidate classification", () => {
  it("recognises a Material Symbols glyph", () => {
    expect(isIcon("radio_button_checked")).toBe(true);
    expect(isIcon("do_not_disturb_on")).toBe(true);
    expect(isIcon("Radio button")).toBe(false);
    // A single lowercase word is a plausible component name, not a glyph.
    expect(isIcon("button")).toBe(false);
  });

  it("recognises building blocks by name or by trail", () => {
    expect(isBuildingBlock(".Building Blocks/Segment", "")).toBe(true);
    expect(isBuildingBlock("Segment", "Buttons / Building blocks")).toBe(true);
    expect(isBuildingBlock("Button", "Buttons")).toBe(false);
  });

  it("recognises another platform's components", () => {
    expect(isXr("XR/XR Navigation bar", "")).toBe(true);
    expect(isXr("Navigation bar", "XR")).toBe(true);
    expect(isXr("Navigation bar", "Navigation")).toBe(false);
  });

  it("recognises a kit's private components", () => {
    expect(isPrivate(".Tonal palettes")).toBe(true);
    expect(isPrivate("Tonal palettes")).toBe(false);
  });

  it("drops icons outright and demotes the rest", () => {
    expect(candidateWeight("radio_button_checked", "")).toBe(0);
    expect(candidateWeight("Button", "")).toBe(1);
    expect(candidateWeight(".Building Blocks/Segment", "")).toBeLessThan(1);
    expect(candidateWeight("XR/XR Navigation bar", "")).toBeLessThan(1);
  });
});

describe("rankCandidates", () => {
  it("does not let an icon beat the component it is named after", () => {
    // The failure this weighting exists for: `radio_button_checked` shares more
    // tokens with "Checkbox Checked" than the real `Checkbox` set does.
    const ranked = rankCandidates("Selection Checkbox", [
      candidate("radio_button_checked", "1:1"),
      candidate("Checkbox", "2:2"),
    ]);
    expect(ranked[0]?.name).toBe("Checkbox");
    expect(ranked.map((r) => r.name)).not.toContain("radio_button_checked");
  });

  it("prefers the component over the part it is assembled from", () => {
    const ranked = rankCandidates("Buttons Button/Segmented", [
      candidate(".Building Blocks/Button segment", "1:1"),
      candidate("Segmented button", "2:2"),
    ]);
    expect(ranked[0]?.name).toBe("Segmented button");
  });

  it("scores against the containing trail when the name alone is generic", () => {
    const ranked = rankCandidates("Navigation Navigation/Rail", [
      candidate("Rail", "1:1", "Navigation"),
      candidate("Chip", "2:2", "Chips"),
    ]);
    expect(ranked[0]?.name).toBe("Rail");
  });

  it("prefers the candidate accounting for more of the subject", () => {
    // Both score 1.0 — `Button` covers its one word, `Button - elevated` covers
    // both of its. The specific one is what a human picks, and taking the
    // shorter name here instead is what made a kit's whole button family
    // propose the bare `Button` set.
    const ranked = rankCandidates("Buttons Button/Elevated", [
      candidate("Button", "1:1"),
      candidate("Button - elevated", "2:2"),
    ]);
    expect(ranked[0]?.nodeId).toBe("2:2");
  });

  it("breaks a remaining tie toward the plainer name", () => {
    const ranked = rankCandidates("Button", [
      candidate("Button segment", "1:1"),
      candidate("Button", "2:2"),
    ]);
    expect(ranked[0]?.nodeId).toBe("2:2");
  });

  it("returns nothing when every candidate is filtered out", () => {
    expect(rankCandidates("Checkbox", [candidate("check_box_outline", "1:1")])).toEqual([]);
  });

  it("keeps at most the requested number", () => {
    const many = Array.from({ length: 8 }, (_, i) => candidate(`Button ${i}`, `${i}:0`));
    expect(rankCandidates("Button", many)).toHaveLength(3);
    expect(rankCandidates("Button", many, { limit: 5 })).toHaveLength(5);
  });
});

describe("confidenceOf", () => {
  it("labels the bands", () => {
    expect(confidenceOf({ ...candidate("x"), score: 0.9 })).toBe("GOOD");
    expect(confidenceOf({ ...candidate("x"), score: 0.5 })).toBe("MAYBE");
    expect(confidenceOf({ ...candidate("x"), score: 0.2 })).toBe("LOW");
    expect(confidenceOf(undefined)).toBe("LOW");
  });
});

describe("subjectsFromPreviewManifest", () => {
  const manifest = {
    previews: [
      { catalog: { role: "COMPONENT", componentId: "Button/Tonal", group: "Buttons" } },
      // A second preview of the same component: one reference, not two subjects.
      { catalog: { role: "COMPONENT", componentId: "Button/Tonal", group: "Buttons" } },
      { catalog: { role: "SCREEN", componentId: "Home", group: "Screens" } },
      { catalog: { role: "COMPONENT", componentId: "Checkbox", group: "Selection" } },
      // Not everything in a manifest is catalogued at all.
      {},
    ],
  };

  it("keeps one subject per catalogued component, sorted", () => {
    expect(subjectsFromPreviewManifest(manifest)).toEqual([
      { label: "Button/Tonal", text: "Buttons Button Tonal" },
      { label: "Checkbox", text: "Selection Checkbox" },
    ]);
  });

  it("tolerates a manifest with no previews", () => {
    expect(subjectsFromPreviewManifest({})).toEqual([]);
  });
});

describe("candidatesFromTree", () => {
  const page = {
    id: "0:1",
    name: "Buttons",
    type: "CANVAS",
    children: [
      {
        id: "1:0",
        name: "Common buttons",
        type: "FRAME",
        children: [
          {
            id: "1:1",
            name: "Button",
            type: "COMPONENT_SET",
            // The variants inside a set: real components, wrong altitude.
            children: [
              { id: "1:2", name: "Size=Small, Style=Filled", type: "COMPONENT" },
              { id: "1:3", name: "Size=Large, Style=Filled", type: "COMPONENT" },
            ],
          },
        ],
      },
      { id: "2:0", name: "Divider", type: "COMPONENT" },
      { id: "3:0", name: "Spec sheet", type: "FRAME", children: [] },
    ],
  };

  it("stops at the first component on each branch", () => {
    const found = candidatesFromTree(page);
    expect(found.map((c) => c.nodeId)).toEqual(["1:1", "2:0"]);
  });

  it("heads every trail with the page name", () => {
    const [set, standalone] = candidatesFromTree(page);
    expect(set?.containing).toBe("Buttons / Common buttons");
    expect(standalone?.containing).toBe("Buttons");
  });

  it("returns nothing for a page with no components", () => {
    expect(candidatesFromTree({ id: "0:1", name: "Cover", type: "CANVAS" })).toEqual([]);
  });
});

describe("subjectFor", () => {
  it("carries the group and de-slashes the id", () => {
    // A kit names by its own taxonomy, and the group often carries the word the
    // leaf drops: `Button/Tonal` is `Button - tonal` there.
    expect(subjectFor("Button/Tonal", "Buttons")).toBe("Buttons Button Tonal");
    expect(subjectFor("Button/Tonal")).toBe("Button Tonal");
  });
});
