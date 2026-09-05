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

describe("toFigmaVariables with alternate themes", () => {
  const system = {
    colors: { "surface.light": "#fff", "surface.dark": "#000", accent: "#f00" },
    radius: { sm: 8 },
  };
  const electric = {
    id: "com.example.AppTheme.ELECTRIC",
    name: "Electric",
    dark: true,
    tokens: { colors: { surface: "#0ff" } },
  };

  it("gives each theme its own mode alongside light/dark", () => {
    const c = toFigmaVariables(system, "Pocket Casts", [electric]);
    expect(c.modes).toEqual({
      light: "light",
      dark: "dark",
      "com.example.AppTheme.ELECTRIC": "Electric",
    });
    expect(c.defaultModeId).toBe("light");
    const surface = c.variables.find((v) => v.name === "color/surface")!;
    expect(surface.valuesByMode["com.example.AppTheme.ELECTRIC"]).toBe("#0ff");
    expect(surface.valuesByMode["light"]).toBe("#fff");
    expect(surface.valuesByMode["dark"]).toBe("#000");
  });

  it("labels a mode from the id's last segment when the theme names none", () => {
    const c = toFigmaVariables(system, "S", [{ id: "a.b.Dracula", tokens: {} }]);
    expect(c.modes["a.b.Dracula"]).toBe("Dracula");
  });

  it("picks the arm matching the theme's own light/dark stance", () => {
    const themed = { colors: { "surface.light": "#eee", "surface.dark": "#111" } };
    const dark = toFigmaVariables(system, "S", [{ id: "t", dark: true, tokens: themed }]);
    const light = toFigmaVariables(system, "S", [{ id: "t", tokens: themed }]);
    expect(dark.variables.find((v) => v.name === "color/surface")!.valuesByMode["t"]).toBe("#111");
    expect(light.variables.find((v) => v.name === "color/surface")!.valuesByMode["t"]).toBe("#eee");
  });

  it("leaves no mode without a value, so Figma can resolve every variable", () => {
    const c = toFigmaVariables(system, "S", [electric]);
    for (const variable of c.variables) {
      for (const mode of Object.keys(c.modes)) {
        expect(variable.valuesByMode[mode], `${variable.name} @ ${mode}`).toBeDefined();
      }
    }
  });

  it("inherits an undeclared token from the default mode rather than dropping it", () => {
    const c = toFigmaVariables(system, "S", [electric]);
    // `accent` and `radius/sm` are system-only; the theme restates neither.
    expect(c.variables.find((v) => v.name === "color/accent")!.valuesByMode["com.example.AppTheme.ELECTRIC"]).toBe("#f00");
    expect(c.variables.find((v) => v.name === "radius/sm")!.valuesByMode["com.example.AppTheme.ELECTRIC"]).toBe(8);
  });

  it("carries a colour only the theme declares", () => {
    const c = toFigmaVariables(system, "S", [
      { id: "t", tokens: { colors: { glow: "#0f0" } } },
    ]);
    const glow = c.variables.find((v) => v.name === "color/glow")!;
    expect(glow.valuesByMode["t"]).toBe("#0f0");
    // Every other mode still resolves, by inheriting what the variable does have.
    expect(glow.valuesByMode["light"]).toBe("#0f0");
  });

  it("lets a theme override a float", () => {
    const c = toFigmaVariables(system, "S", [{ id: "t", tokens: { radius: { sm: 16 } } }]);
    const sm = c.variables.find((v) => v.name === "radius/sm")!;
    expect(sm.valuesByMode["t"]).toBe(16);
    expect(sm.valuesByMode["light"]).toBe(8);
  });

  it("drops a duplicate or empty theme id instead of silently overwriting a mode", () => {
    const c = toFigmaVariables(system, "S", [
      { id: "t", name: "First", tokens: {} },
      { id: "t", name: "Second", tokens: {} },
      { id: "", name: "Nameless", tokens: {} },
      { id: "light", name: "Collides with a system mode", tokens: {} },
    ]);
    expect(c.modes).toEqual({ light: "light", dark: "dark", t: "First" });
  });

  it("produces exactly the pre-themes collection when none are passed", () => {
    expect(toFigmaVariables(system, "S", [])).toEqual(toFigmaVariables(system, "S"));
  });
});
