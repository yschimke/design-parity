import { describe, expect, it } from "vitest";

import { toFigmaTextStyles, toFigmaVariables } from "../src/figma.js";

describe("toFigmaVariables", () => {
  it("uses a single default mode for an un-themed palette", () => {
    const c = toFigmaVariables({ colors: { primary: "#6750a4" }, radius: { sm: 8 } }, "M3");
    expect(c.name).toBe("M3");
    expect(c.modes).toEqual({ value: "Value" });
    expect(c.defaultModeId).toBe("value");
    const primary = c.variables.find((v) => v.name === "color/primary");
    expect(primary).toMatchObject({ resolvedType: "COLOR", valuesByMode: { value: "#6750a4" } });
    const sm = c.variables.find((v) => v.name === "radius/sm");
    expect(sm).toMatchObject({ resolvedType: "FLOAT", valuesByMode: { value: 8 } });
  });

  it("merges name.light / name.dark into one COLOR variable with light/dark modes", () => {
    const c = toFigmaVariables(
      { colors: { "primary.light": "#fff", "primary.dark": "#000" } },
      "M3",
    );
    expect(Object.keys(c.modes).sort()).toEqual(["dark", "light"]);
    expect(c.defaultModeId).toBe("light");
    const primary = c.variables.find((v) => v.name === "color/primary");
    expect(primary?.valuesByMode).toEqual({ light: "#fff", dark: "#000" });
  });

  it("applies an un-suffixed token to every mode and projects spacing/radius as floats", () => {
    const c = toFigmaVariables(
      { colors: { "bg.light": "#fff", "bg.dark": "#000", accent: "#f0f" }, spacing: { gap: 4 } },
      "Sys",
    );
    const accent = c.variables.find((v) => v.name === "color/accent");
    expect(accent?.valuesByMode).toEqual({ light: "#f0f", dark: "#f0f" });
    const gap = c.variables.find((v) => v.name === "spacing/gap");
    expect(gap?.valuesByMode).toEqual({ light: 4, dark: 4 });
  });
});

describe("toFigmaTextStyles", () => {
  it("preserves symbolic typography roles and Compose code syntax", () => {
    expect(toFigmaTextStyles({ typography: {
      labelLarge: { fontFamily: "Roboto", fontSize: 14, fontWeight: 500, lineHeight: 20 },
    } })).toEqual([{
      name: "typography/labelLarge",
      fontFamily: "Roboto",
      fontSize: 14,
      fontWeight: 500,
      lineHeight: 20,
      androidCodeSyntax: "MaterialTheme.typography.labelLarge",
    }]);
  });
});
