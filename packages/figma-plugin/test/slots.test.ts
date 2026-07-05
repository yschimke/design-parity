import { describe, expect, it } from "vitest";

import {
  buildSlotsUrl,
  parseSlotsResponse,
  slotHeight,
  slotWidth,
  type PreviewSlot,
} from "../src/slots.js";
import type { RenderSource } from "../src/render.js";

const base: RenderSource = {
  serverBase: "http://127.0.0.1:8723",
  basePath: "compose-m3",
  token: "tok",
  previewId: "Card/Elevated",
  overrides: {},
  format: "png",
};

describe("buildSlotsUrl (mirrors buildRenderUrl, .slots lane)", () => {
  it("builds /<system>/render/<id>.slots?token=… with the id as an encoded segment", () => {
    expect(buildSlotsUrl({ ...base, previewId: "com.x.Foo#bar baz" })).toBe(
      "http://127.0.0.1:8723/compose-m3/render/com.x.Foo%23bar%20baz.slots?token=tok",
    );
  });

  it("ignores source.format — slots are metadata, not a render format", () => {
    const png = buildSlotsUrl({ ...base, format: "png" });
    const svg = buildSlotsUrl({ ...base, format: "svg" });
    expect(png).toBe(svg);
    expect(png).toBe(
      "http://127.0.0.1:8723/compose-m3/render/Card%2FElevated.slots?token=tok",
    );
  });

  it("appends non-blank overrides in order, encoding values (not keys); drops blanks", () => {
    const url = buildSlotsUrl({
      ...base,
      previewId: "Card",
      overrides: { uiMode: "dark", device: "", fontScale: "1.5", localeTag: "fr-FR" },
    });
    expect(url).toBe(
      "http://127.0.0.1:8723/compose-m3/render/Card.slots?token=tok&uiMode=dark&fontScale=1.5&localeTag=fr-FR",
    );
  });

  it("omits the mount segment when there is no basePath", () => {
    const url = buildSlotsUrl({ ...base, basePath: undefined, previewId: "Card" });
    expect(url).toBe("http://127.0.0.1:8723/render/Card.slots?token=tok");
  });
});

describe("parseSlotsResponse (mirrors the server PreviewSlotsPayload wire shape)", () => {
  it("parses previewId + named, bounded slots in order", () => {
    const parsed = parseSlotsResponse({
      previewId: "Card/Elevated",
      slots: [
        { name: "leadingIcon", bounds: { left: 8, top: 8, right: 40, bottom: 40 } },
        { name: "headline", bounds: { left: 48, top: 44, right: 192, bottom: 64 } },
      ],
    });
    expect(parsed).toEqual({
      previewId: "Card/Elevated",
      slots: [
        { name: "leadingIcon", bounds: { left: 8, top: 8, right: 40, bottom: 40 } },
        { name: "headline", bounds: { left: 48, top: 44, right: 192, bottom: 64 } },
      ],
    });
  });

  it("drops slots with a blank name or malformed bounds, never throwing", () => {
    const parsed = parseSlotsResponse({
      previewId: "Card",
      slots: [
        { name: "", bounds: { left: 0, top: 0, right: 10, bottom: 10 } }, // blank name
        { name: "noBounds" }, // missing bounds
        { name: "badBounds", bounds: { left: 0, top: 0, right: "x", bottom: 4 } }, // non-numeric
        { name: "partial", bounds: { left: 1, top: 2, right: 3 } }, // missing bottom
        { name: "ok", bounds: { left: 1, top: 2, right: 3, bottom: 4 } },
      ],
    });
    expect(parsed?.slots.map((s) => s.name)).toEqual(["ok"]);
  });

  it("defaults previewId to \"\" when absent, keeping any valid slots", () => {
    const parsed = parseSlotsResponse({
      slots: [{ name: "only", bounds: { left: 0, top: 0, right: 2, bottom: 2 } }],
    });
    expect(parsed).toEqual({
      previewId: "",
      slots: [{ name: "only", bounds: { left: 0, top: 0, right: 2, bottom: 2 } }],
    });
  });

  it("is undefined when the body has no slots array", () => {
    expect(parseSlotsResponse({ previewId: "Card" })).toBeUndefined();
    expect(parseSlotsResponse(null)).toBeUndefined();
    expect(parseSlotsResponse("nope")).toBeUndefined();
    expect(parseSlotsResponse([])).toBeUndefined();
  });

  it("yields empty slots for a marker-free preview", () => {
    expect(parseSlotsResponse({ previewId: "Plain", slots: [] })).toEqual({
      previewId: "Plain",
      slots: [],
    });
  });
});

describe("slotWidth / slotHeight", () => {
  it("are the box's right-left and bottom-top", () => {
    const slot: PreviewSlot = { name: "icon", bounds: { left: 8, top: 8, right: 40, bottom: 40 } };
    expect(slotWidth(slot)).toBe(32);
    expect(slotHeight(slot)).toBe(32);
  });
});
