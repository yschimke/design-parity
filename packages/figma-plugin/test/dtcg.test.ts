import { tokensToDtcg } from "@design-parity/core";
import type { DesignTokens } from "@design-parity/core";
import { describe, expect, it } from "vitest";

import { readDtcgTokensLite } from "../src/dtcg.js";

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
