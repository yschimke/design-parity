import { describe, expect, it } from "vitest";

import {
  A11Y_CONTRACT,
  buildFrameSpec,
  defaultComponentId,
  specToIssueBody,
  specToJson,
  type FrameRead,
} from "../src/spec.js";

const read: FrameRead = {
  name: "Filled Button",
  width: 200,
  height: 48,
  layout: { paddingTop: 10, paddingBottom: 10, paddingLeft: 24, paddingRight: 24, gap: 8, cornerRadius: 20 },
  texts: ["Save", "  ", "Cancel"],
  variables: ["md.sys.color.primary", ""],
};

describe("defaultComponentId", () => {
  it("PascalCases each slash-separated segment and drops punctuation", () => {
    expect(defaultComponentId("Filled Button")).toBe("FilledButton");
    expect(defaultComponentId("Button / Filled")).toBe("Button/Filled");
    expect(defaultComponentId("contact_row (v2)")).toBe("ContactRowV2");
    expect(defaultComponentId("   ")).toBe("Component");
  });
});

describe("buildFrameSpec", () => {
  it("derives the id/title, filters blank texts/vars, and carries layout", () => {
    const spec = buildFrameSpec(read);
    expect(spec.componentId).toBe("FilledButton");
    expect(spec.title).toBe("Implement FilledButton to match the Figma spec");
    expect(spec.name).toBe("Filled Button");
    expect(spec.texts).toEqual(["Save", "Cancel"]); // blank dropped
    expect(spec.variables).toEqual(["md.sys.color.primary"]); // blank dropped
    expect(spec.layout).toEqual(read.layout);
    expect(spec.a11y).toBe(A11Y_CONTRACT);
    expect(spec.notes).toBeUndefined();
  });

  it("honours an explicit component id and notes", () => {
    const spec = buildFrameSpec(read, { componentId: "Button/Filled", notes: "  primary action  " });
    expect(spec.componentId).toBe("Button/Filled");
    expect(spec.title).toBe("Implement Button/Filled to match the Figma spec");
    expect(spec.notes).toBe("primary action");
  });

  it("omits an empty layout", () => {
    const spec = buildFrameSpec({ name: "X", width: 1, height: 1, texts: [], variables: [] });
    expect(spec.layout).toBeUndefined();
  });
});

describe("specToJson", () => {
  it("round-trips to the same spec", () => {
    const spec = buildFrameSpec(read);
    expect(JSON.parse(specToJson(spec))).toEqual(spec);
  });
});

describe("specToIssueBody", () => {
  const body = specToIssueBody(buildFrameSpec(read, { notes: "primary action" }));

  it("leads with the target and the frame", () => {
    expect(body).toContain("## Design spec: `FilledButton`");
    expect(body).toContain("**Frame:** `Filled Button` — 200×48 dp");
    expect(body).toContain("Attach the exported frame PNG");
  });

  it("renders layout redlines, text, and the a11y/i18n acceptance checklist", () => {
    expect(body).toContain("- Padding: top 10 · right 24 · bottom 10 · left 24 dp");
    expect(body).toContain("- Gap between children: 8 dp");
    expect(body).toContain("- Corner radius: 20 dp");
    expect(body).toContain('- "Save"');
    expect(body).toContain("- [ ] Contrast ≥ 4.5:1 normal text / 3:1 large text (WCAG AA)");
    expect(body).toContain("- [ ] Touch targets ≥ 48 dp");
    expect(body).toContain("- [ ] RTL mirroring");
    expect(body).toContain("Notes");
    expect(body).toContain("primary action");
  });

  it("shows the token hint when no variables were captured", () => {
    const bare = specToIssueBody(buildFrameSpec({ name: "X", width: 1, height: 1, texts: [], variables: [] }));
    expect(bare).toContain("_None captured — bind Figma variables");
    // Empty sections are omitted.
    expect(bare).not.toContain("### Layout");
    expect(bare).not.toContain("### Text content");
    expect(bare).not.toContain("### Notes");
  });
});
