import { describe, expect, it } from "vitest";

import { buildRenderUrl } from "../src/render.js";
import {
  declarationText,
  knobOverrides,
  parsePreviewsResponse,
  previewsUrl,
  renderSourceForPreview,
  seedKey,
  servesOverrides,
  type OverrideDeclaration,
  type Preview,
} from "../src/previews.js";

// A realistic v2 /api/previews body, matching the server's PreviewDto shape.
const body = {
  schema: "compose-preview-serve/v2",
  module: "compose-m3",
  trust: "branch:yschimke/compose-ai-tools@design-artifacts/compose-m3",
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
          key: "count",
          type: "int",
          label: "Count",
          default: { type: "int", value: 3 },
          index: 0,
        },
      ],
    },
    { id: "Switch/On", label: "Switch", modes: ["snapshot"], overrides: [] },
  ],
};

describe("previewsUrl", () => {
  it("targets the per-system API route with the token when gated", () => {
    expect(previewsUrl("http://127.0.0.1:8723/", "compose-m3", "tok")).toBe(
      "http://127.0.0.1:8723/compose-m3/api/previews?token=tok",
    );
  });
  it("omits the token for a public server", () => {
    expect(previewsUrl("http://h:1", "wear-m3")).toBe("http://h:1/wear-m3/api/previews");
  });
});

describe("servesOverrides", () => {
  it("recognizes v2 and rejects v1", () => {
    expect(servesOverrides("compose-preview-serve/v2")).toBe(true);
    expect(servesOverrides("compose-preview-serve/v1")).toBe(false);
  });
});

describe("parsePreviewsResponse", () => {
  it("parses previews and their override declarations", () => {
    const res = parsePreviewsResponse(body)!;
    expect(res.schema).toBe("compose-preview-serve/v2");
    expect(res.module).toBe("compose-m3");
    expect(res.previews.map((p) => p.id)).toEqual(["Button/Filled", "Switch/On"]);
    const filled = res.previews[0]!;
    expect(filled.overrides.map((o) => o.key)).toEqual(["label", "count"]);
    expect(filled.overrides[0]!.current).toEqual({ type: "string", value: "Save" });
    expect(filled.overrides[1]!.index).toBe(0);
    expect(res.previews[1]!.overrides).toEqual([]);
  });

  it("degrades a missing overrides array to [] and drops unknown knob kinds", () => {
    const res = parsePreviewsResponse({
      schema: "compose-preview-serve/v2",
      module: "m",
      previews: [
        { id: "A" }, // no overrides field
        {
          id: "B",
          overrides: [
            { key: "ok", type: "string", default: { type: "string", value: "x" } },
            { key: "weird", type: "matrix", default: { type: "string", value: "y" } },
          ],
        },
      ],
    })!;
    expect(res.previews[0]!.overrides).toEqual([]);
    expect(res.previews[1]!.overrides.map((o) => o.key)).toEqual(["ok"]);
  });

  it("returns undefined for a non-previews body", () => {
    expect(parsePreviewsResponse({ hello: 1 })).toBeUndefined();
    expect(parsePreviewsResponse(null)).toBeUndefined();
  });
});

describe("declarationText + seedKey", () => {
  const decls = parsePreviewsResponse(body)!.previews[0]!.overrides;
  it("seeds a control from current, else default", () => {
    expect(declarationText(decls[0]!)).toBe("Save"); // current
    expect(declarationText(decls[1]!)).toBe("3"); // default
  });
  it("composes the wire key for indexed knobs", () => {
    expect(seedKey(decls[0]!)).toBe("label");
    expect(seedKey(decls[1]!)).toBe("count[0]");
  });
});

describe("knobOverrides", () => {
  const decls = parsePreviewsResponse(body)!.previews[0]!.overrides;
  it("encodes edited knobs as knob.<seedKey>=<kind>:<value>, dropping blanks", () => {
    const map = knobOverrides(decls, { label: "Ship it", "count[0]": "  ", other: "z" });
    expect(map).toEqual({ "knob.label": "string:Ship it" });
  });
});

describe("renderSourceForPreview", () => {
  const preview: Preview = parsePreviewsResponse(body)!.previews[0]!;

  it("merges knob edits + fixed axes into a render source, and its URL round-trips", () => {
    const source = renderSourceForPreview(preview, {
      serverBase: "http://127.0.0.1:8723",
      basePath: "compose-m3",
      token: "tok",
      format: "png",
      knobEdits: { label: "Save" },
      axes: { uiMode: "dark", fontScale: "1.5", device: "" },
    });
    expect(source.previewId).toBe("Button/Filled");
    expect(source.overrides).toEqual({
      "knob.label": "string:Save",
      uiMode: "dark",
      fontScale: "1.5",
    });
    expect(buildRenderUrl(source)).toBe(
      "http://127.0.0.1:8723/compose-m3/render/Button%2FFilled.png?token=tok&knob.label=string%3ASave&uiMode=dark&fontScale=1.5",
    );
  });

  it("carries svg format for the (upcoming) editable mode", () => {
    const source = renderSourceForPreview(preview, {
      serverBase: "http://h:1",
      token: "t",
      format: "svg",
    });
    expect(source.format).toBe("svg");
    expect(buildRenderUrl(source)).toBe("http://h:1/render/Button%2FFilled.svg?token=t");
  });
});
