import { describe, expect, it } from "vitest";

import {
  buildRenderUrl,
  encodeSegment,
  isSupportedOverrideKey,
  knobKey,
  knobValue,
  nonBlankOverrides,
  type RenderSource,
} from "../src/render.js";

describe("encodeSegment (parity with server WebEscaping.urlEncodeSegment)", () => {
  it("percent-encodes everything outside the RFC-3986 unreserved set", () => {
    // '#', space → %23, %20; also the chars encodeURIComponent leaves alone.
    expect(encodeSegment("com.x.Foo#bar baz")).toBe("com.x.Foo%23bar%20baz");
    expect(encodeSegment("a!'()*b")).toBe("a%21%27%28%29%2Ab");
  });

  it("leaves unreserved A-Za-z0-9-_.~ untouched", () => {
    expect(encodeSegment("Button-Filled__ideal.default~1")).toBe(
      "Button-Filled__ideal.default~1",
    );
  });
});

describe("buildRenderUrl (mirrors ServeUrls.renderUrl)", () => {
  const base: RenderSource = {
    serverBase: "http://127.0.0.1:8723",
    token: "tok",
    previewId: "com.x.Foo#bar baz",
    overrides: {},
    format: "png",
  };

  it("builds /render/<id>.png?token=… with the id as an encoded segment", () => {
    expect(buildRenderUrl(base)).toBe(
      "http://127.0.0.1:8723/render/com.x.Foo%23bar%20baz.png?token=tok",
    );
  });

  it("appends non-blank overrides in order, encoding values (not keys)", () => {
    const url = buildRenderUrl({
      ...base,
      previewId: "Button",
      overrides: { uiMode: "dark", device: "", fontScale: "1.5", localeTag: "fr-FR" },
    });
    expect(url).toBe(
      "http://127.0.0.1:8723/render/Button.png?token=tok&uiMode=dark&fontScale=1.5&localeTag=fr-FR",
    );
  });

  it("supports a per-system mount base path and the svg format", () => {
    expect(
      buildRenderUrl({ ...base, previewId: "Button", basePath: "/compose-m3/", format: "svg" }),
    ).toBe("http://127.0.0.1:8723/compose-m3/render/Button.svg?token=tok");
  });

  it("encodes a knob override value (kind:value)", () => {
    const url = buildRenderUrl({
      ...base,
      previewId: "Button",
      overrides: { [knobKey("label")]: knobValue("string", "Tap me") },
    });
    expect(url).toBe(
      "http://127.0.0.1:8723/render/Button.png?token=tok&knob.label=string%3ATap%20me",
    );
  });

  it("trims trailing slashes on the origin", () => {
    expect(buildRenderUrl({ ...base, serverBase: "http://h:1/", previewId: "B" })).toBe(
      "http://h:1/render/B.png?token=tok",
    );
  });
});

describe("override helpers", () => {
  it("recognizes fixed keys and knob.* as supported", () => {
    expect(isSupportedOverrideKey("uiMode")).toBe(true);
    expect(isSupportedOverrideKey("knob.count")).toBe(true);
    expect(isSupportedOverrideKey("nope")).toBe(false);
  });

  it("drops blank-valued overrides", () => {
    expect(nonBlankOverrides({ a: "1", b: "", c: "  ", d: "x" })).toEqual([
      ["a", "1"],
      ["d", "x"],
    ]);
  });
});
