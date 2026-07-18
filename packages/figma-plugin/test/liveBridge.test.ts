import { describe, expect, it } from "vitest";

import { liveBridgeTarget, matchPreview, parseLivePreview } from "../src/liveBridge.js";
import type { Preview } from "../src/previews.js";

const preview = (id: string, label: string): Preview => ({ id, label, modes: [], overrides: [] });

describe("parseLivePreview", () => {
  it("splits a livePreview deep link into server base, preview id, and system", () => {
    expect(
      parseLivePreview("https://preview.coo.ee/p/button-filled__ideal__default__light?session=compose-m3"),
    ).toEqual({
      serverBase: "https://preview.coo.ee",
      previewId: "button-filled__ideal__default__light",
      system: "compose-m3",
    });
  });

  it("decodes percent-encoding and tolerates extra query params", () => {
    expect(parseLivePreview("http://h:8723/p/a%2Fb?x=1&session=my%20sys")).toEqual({
      serverBase: "http://h:8723",
      previewId: "a/b",
      system: "my sys",
    });
  });

  it("returns undefined when the URL isn't a /p/ deep link", () => {
    expect(parseLivePreview("https://cdn.example/images/x.png")).toBeUndefined();
  });
});

describe("liveBridgeTarget", () => {
  it("drives server + system + exact preview id from the livePreview link", () => {
    const target = liveBridgeTarget(
      "Button/Filled",
      "compose-m3",
      "https://preview.coo.ee/p/button-filled__ideal__default__light?session=compose-m3",
    );
    expect(target).toEqual({
      componentId: "Button/Filled",
      system: "compose-m3",
      serverBase: "https://preview.coo.ee",
      previewId: "button-filled__ideal__default__light",
    });
  });

  it("falls back to just the catalog system when there's no livePreview", () => {
    expect(liveBridgeTarget("Button/Filled", "compose-m3")).toEqual({
      componentId: "Button/Filled",
      system: "compose-m3",
    });
  });
});

describe("matchPreview", () => {
  const previews = [
    preview("switch-on__ideal__on__light", "Switch/On"),
    preview("button-filled__ideal__default__light", "Button/Filled"),
  ];

  it("prefers the exact preview id from the deep link", () => {
    const target = liveBridgeTarget(
      "Button/Filled",
      "compose-m3",
      "https://h/p/button-filled__ideal__default__light?session=compose-m3",
    );
    expect(matchPreview(previews, target)?.id).toBe("button-filled__ideal__default__light");
  });

  it("matches by label, then component slug, when there's no exact id", () => {
    expect(matchPreview([preview("x1", "Button/Filled")], { componentId: "Button/Filled", system: "s" })?.id).toBe("x1");
    expect(
      matchPreview([preview("button-filled", "Filled Button")], { componentId: "Button/Filled", system: "s" })?.id,
    ).toBe("button-filled");
    expect(
      matchPreview([preview("button-filled__default", "Filled")], { componentId: "Button/Filled", system: "s" })?.id,
    ).toBe("button-filled__default");
  });

  it("returns undefined when nothing plausibly matches", () => {
    expect(matchPreview([preview("card", "Card")], { componentId: "Button/Filled", system: "s" })).toBeUndefined();
  });
});
