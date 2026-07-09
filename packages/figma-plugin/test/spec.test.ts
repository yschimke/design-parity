import { describe, expect, it } from "vitest";

import {
  A11Y_CONTRACT,
  buildFrameSpec,
  defaultComponentId,
  specToIssueBody,
  specToJson,
  suggestKind,
  type FrameRead,
} from "../src/spec.js";

const read: FrameRead = {
  name: "Filled Button",
  width: 200,
  height: 48,
  layout: { paddingTop: 10, paddingBottom: 10, paddingLeft: 24, paddingRight: 24, gap: 8, cornerRadius: 20 },
  texts: ["Save", "  ", "Cancel"],
  variables: ["md.sys.color.primary", ""],
  components: [],
};

const screenRead: FrameRead = {
  name: "Contact List",
  width: 412,
  height: 900,
  texts: [],
  variables: [],
  components: ["TopAppBar", "Button/Filled", "TopAppBar", "ContactRow"],
};

describe("defaultComponentId", () => {
  it("PascalCases each slash-separated segment and drops punctuation", () => {
    expect(defaultComponentId("Filled Button")).toBe("FilledButton");
    expect(defaultComponentId("Button / Filled")).toBe("Button/Filled");
    expect(defaultComponentId("contact_row (v2)")).toBe("ContactRowV2");
    expect(defaultComponentId("   ")).toBe("Component");
  });
});

describe("suggestKind", () => {
  it("defaults to 'new' for a plain frame and 'screen' when it composes ≥2 components", () => {
    expect(suggestKind(read)).toBe("new");
    expect(suggestKind({ ...read, components: ["Button/Filled"] })).toBe("new");
    expect(suggestKind(screenRead)).toBe("screen");
  });
});

describe("buildFrameSpec", () => {
  it("derives kind/id/title, filters blanks, dedupes uses, carries layout", () => {
    const spec = buildFrameSpec(read);
    expect(spec.kind).toBe("new");
    expect(spec.targetId).toBe("FilledButton");
    expect(spec.title).toBe("New component: FilledButton");
    expect(spec.texts).toEqual(["Save", "Cancel"]); // blank dropped
    expect(spec.variables).toEqual(["md.sys.color.primary"]); // blank dropped
    expect(spec.uses).toEqual([]);
    expect(spec.layout).toEqual(read.layout);
    expect(spec.a11y).toBe(A11Y_CONTRACT);
    expect(spec.notes).toBeUndefined();
  });

  it("defaults a multi-component frame to a screen and dedupes its uses", () => {
    const spec = buildFrameSpec(screenRead);
    expect(spec.kind).toBe("screen");
    expect(spec.targetId).toBe("ContactList");
    expect(spec.title).toBe("New screen: ContactList");
    expect(spec.uses).toEqual(["TopAppBar", "Button/Filled", "ContactRow"]); // deduped, in order
  });

  it("honours explicit kind (edit), target id, uses, and notes", () => {
    const spec = buildFrameSpec(read, {
      kind: "edit",
      targetId: "Button/Filled",
      uses: ["Icon", " Icon ", ""],
      notes: "  primary action  ",
    });
    expect(spec.kind).toBe("edit");
    expect(spec.title).toBe("Edit Button/Filled to match the Figma spec");
    expect(spec.uses).toEqual(["Icon"]); // trimmed + deduped
    expect(spec.notes).toBe("primary action");
  });

  it("omits an empty layout", () => {
    const spec = buildFrameSpec({ name: "X", width: 1, height: 1, texts: [], variables: [], components: [] });
    expect(spec.layout).toBeUndefined();
  });
});

describe("specToJson", () => {
  it("round-trips to the same spec", () => {
    const spec = buildFrameSpec(screenRead);
    expect(JSON.parse(specToJson(spec))).toEqual(spec);
  });
});

describe("specToIssueBody", () => {
  it("a NEW component leads with its kind, frame, redlines, and a11y checklist", () => {
    const body = specToIssueBody(buildFrameSpec(read, { notes: "primary action" }));
    expect(body).toContain("## New component spec: `FilledButton`");
    expect(body).toContain("Implement a **new** Compose component");
    expect(body).toContain("**Frame:** `Filled Button` — 200×48 dp");
    expect(body).toContain("- Padding: top 10 · right 24 · bottom 10 · left 24 dp");
    expect(body).toContain("- Gap between children: 8 dp");
    expect(body).toContain('- "Save"');
    expect(body).toContain("- [ ] Contrast ≥ 4.5:1 normal text / 3:1 large text (WCAG AA)");
    expect(body).toContain("- [ ] RTL mirroring");
    expect(body).toContain("Proposed component id: `FilledButton`");
    expect(body).toContain("primary action");
    // No components referenced ⇒ no uses block for a non-screen.
    expect(body).not.toContain("Components referenced");
  });

  it("an EDIT frames the existing component and lists referenced components as context", () => {
    const body = specToIssueBody(
      buildFrameSpec(read, { kind: "edit", targetId: "Button/Filled", uses: ["Icon", "Label"] }),
    );
    expect(body).toContain("## Component edit spec: `Button/Filled`");
    expect(body).toContain("Update the **existing** component `Button/Filled`");
    expect(body).toContain("### Components referenced (context)");
    expect(body).toContain("- `Icon`");
    expect(body).toContain("Existing component id: `Button/Filled`");
  });

  it("a SCREEN lists the components it composes and uses screen correspondence", () => {
    const body = specToIssueBody(buildFrameSpec(screenRead));
    expect(body).toContain("## Screen spec: `ContactList`");
    expect(body).toContain("Implement a **screen** composed of the components below");
    expect(body).toContain("### Components used");
    expect(body).toContain("- `TopAppBar`");
    expect(body).toContain("- `ContactRow`");
    expect(body).toContain("Screen id: `ContactList`");
  });

  it("shows a placeholder when a screen has no components yet, and the token hint when bare", () => {
    const screenNoUses = specToIssueBody(buildFrameSpec({ ...screenRead, components: [] }, { kind: "screen" }));
    expect(screenNoUses).toContain("_List the existing components this screen composes._");

    const bare = specToIssueBody(buildFrameSpec({ name: "X", width: 1, height: 1, texts: [], variables: [], components: [] }));
    expect(bare).toContain("_None captured — bind Figma variables");
    expect(bare).not.toContain("### Layout");
    expect(bare).not.toContain("### Text content");
    expect(bare).not.toContain("### Notes");
  });
});
