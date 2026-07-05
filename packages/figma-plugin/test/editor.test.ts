import { describe, expect, it } from "vitest";

import { EDITOR_AXES, knobControls } from "../src/editor.js";
import { parsePreviewsResponse } from "../src/previews.js";
import { SUPPORTED_OVERRIDE_KEYS } from "../src/render.js";

const preview = parsePreviewsResponse({
  schema: "compose-preview-serve/v2",
  module: "compose-m3",
  previews: [
    {
      id: "Button/Filled",
      label: "Filled button",
      modes: ["snapshot"],
      overrides: [
        {
          key: "label",
          type: "string",
          label: "Label",
          default: { type: "string", value: "Tap me" },
          current: { type: "string", value: "Save" },
        },
        {
          key: "enabled",
          type: "bool",
          label: "Enabled",
          default: { type: "bool", value: true },
        },
        {
          key: "count",
          type: "int",
          label: "Count",
          default: { type: "int", value: 3 },
          index: 0,
        },
      ],
    },
  ],
})!.previews[0]!;

describe("knobControls", () => {
  it("turns each declaration into a control seeded from current, else default", () => {
    const controls = knobControls(preview);
    expect(controls).toEqual([
      { seedKey: "label", label: "Label", kind: "string", value: "Save" },
      { seedKey: "enabled", label: "Enabled", kind: "bool", value: "true" },
      // Indexed knob → composite seed key; no current, so the default.
      { seedKey: "count[0]", label: "Count", kind: "int", value: "3" },
    ]);
  });

  it("is empty for a preview with no declared knobs", () => {
    const bare = parsePreviewsResponse({
      schema: "compose-preview-serve/v2",
      module: "m",
      previews: [{ id: "A", overrides: [] }],
    })!.previews[0]!;
    expect(knobControls(bare)).toEqual([]);
  });
});

describe("EDITOR_AXES", () => {
  it("exposes only supported /render override keys", () => {
    for (const axis of EDITOR_AXES) {
      expect(SUPPORTED_OVERRIDE_KEYS).toContain(axis.key);
    }
  });

  it("has no duplicate keys", () => {
    const keys = EDITOR_AXES.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
