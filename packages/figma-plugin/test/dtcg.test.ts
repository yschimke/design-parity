import { tokensToDtcg } from "@design-parity/core";
import type { DesignTokens } from "@design-parity/core";
import { describe, expect, it } from "vitest";

import { readDtcgTokensLite, resolveThemeTokens } from "../src/dtcg.js";

describe("readDtcgTokensLite", () => {
  it("reads color, radius, and spacing groups from a DTCG document", () => {
    const doc = {
      $schema: "https://design-tokens.org/schema.json",
      color: {
        primary: { $type: "color", $value: "#6750A4" },
        "surface.light": { $type: "color", $value: "#FFFBFE" },
        "surface.dark": { $type: "color", $value: "#1C1B1F" },
      },
      radius: { medium: { $type: "dimension", $value: 12 } },
      spacing: { gutter: { $type: "dimension", $value: 16 } },
    };
    expect(readDtcgTokensLite(doc)).toEqual({
      colors: {
        primary: "#6750A4",
        "surface.light": "#FFFBFE",
        "surface.dark": "#1C1B1F",
      },
      radius: { medium: 12 },
      spacing: { gutter: 16 },
    });
  });

  it("round-trips the dot-suffixed themed keys core's tokensToDtcg writes", () => {
    // The DTCG file the plugin fetches is written by core's tokensToDtcg; the
    // slim reader must recover the same dot-suffixed color keys so the Figma
    // variable projection can split them into light/dark modes.
    const tokens: DesignTokens = {
      colors: { "surface.light": "#FFFFFF", "surface.dark": "#000000" },
      radius: { medium: 12 },
    };
    const recovered = readDtcgTokensLite(tokensToDtcg(tokens));
    expect(recovered.colors).toEqual(tokens.colors);
    expect(recovered.radius).toEqual(tokens.radius);
  });

  it("accepts the W3C dimension object form and numeric strings", () => {
    const doc = {
      radius: { sm: { $type: "dimension", $value: { value: 4, unit: "px" } } },
      spacing: { s: { $type: "dimension", $value: "8" } },
    };
    const tokens = readDtcgTokensLite(doc);
    expect(tokens.radius).toEqual({ sm: 4 });
    expect(tokens.spacing).toEqual({ s: 8 });
  });

  it("ignores $-prefixed keys, non-token nodes, and non-objects", () => {
    expect(readDtcgTokensLite(null)).toEqual({});
    expect(readDtcgTokensLite({ color: { note: "not a token node" } })).toEqual({});
    expect(readDtcgTokensLite({})).toEqual({});
  });
});

describe("resolveThemeTokens", () => {
  const themes = [
    { id: "a.Dracula", name: "Dracula", dark: true, tokensFile: "themes/dracula.dtcg.json" },
    { id: "a.Solarized", tokensFile: "themes/solarized.dtcg.json" },
  ];
  const doc = (hex: string) => ({ color: { surface: { $type: "color", $value: hex } } });

  it("reads each theme's sibling token file and keeps its label and stance", async () => {
    const resolved = await resolveThemeTokens(themes, async (path) =>
      path === "themes/dracula.dtcg.json" ? doc("#282a36") : doc("#fdf6e3"),
    );
    expect(resolved).toEqual([
      { id: "a.Dracula", name: "Dracula", dark: true, tokens: { colors: { surface: "#282a36" } } },
      { id: "a.Solarized", tokens: { colors: { surface: "#fdf6e3" } } },
    ]);
  });

  it("skips a theme whose file will not read rather than failing the import", async () => {
    const resolved = await resolveThemeTokens(themes, async (path) => {
      if (path === "themes/dracula.dtcg.json") throw new Error("404");
      return doc("#fdf6e3");
    });
    expect(resolved.map((t) => t.id)).toEqual(["a.Solarized"]);
  });

  it("skips a theme the reader has nothing for", async () => {
    expect(await resolveThemeTokens(themes, async () => undefined)).toEqual([]);
  });

  it("skips an entry with no id or no token file, and handles no themes at all", async () => {
    const resolved = await resolveThemeTokens(
      [{ id: "", tokensFile: "a.json" }, { id: "b", tokensFile: "" }],
      async () => doc("#fff"),
    );
    expect(resolved).toEqual([]);
    expect(await resolveThemeTokens(undefined, async () => doc("#fff"))).toEqual([]);
  });
});
