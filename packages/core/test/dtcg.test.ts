import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  loadDtcgTokens,
  readDtcgTokens,
  validateDtcgTokens,
  tokensToDtcg,
  dtcgTokensSchema,
  type DesignTokens,
} from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = (p: string) => resolve(repoRoot, p);

describe("dtcg schema", () => {
  it("exposes a draft-07 schema", () => {
    expect(dtcgTokensSchema.$schema).toContain("draft-07");
  });

  it("rejects an unknown $type", () => {
    const r = validateDtcgTokens({ a: { $type: "elevation", $value: 1 } });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/type/);
  });

  it("accepts a document with a leading $schema", () => {
    const r = validateDtcgTokens({
      $schema: "x",
      a: { $type: "color", $value: "#fff" },
    });
    expect(r.valid).toBe(true);
  });
});

describe("dtcg writer (tokensToDtcg)", () => {
  const tokens: DesignTokens = {
    colors: { primary: "#6750A4", "on-surface": "#1C1B1F" },
    spacing: { padding: 16 },
    radius: { corner: 12, sm: 4 },
    typography: { body: { fontFamily: "Inter", fontSize: 14, fontWeight: 400 } },
  };

  it("emits a schema-valid DTCG document grouped by category", () => {
    const doc = tokensToDtcg(tokens) as Record<string, Record<string, unknown>>;
    expect(validateDtcgTokens(doc).valid).toBe(true);
    expect(doc.$schema).toContain("dtcg-tokens.schema.json");
    expect(doc.color.primary).toEqual({ $type: "color", $value: "#6750A4" });
    expect(doc.spacing.padding).toEqual({ $type: "dimension", $value: 16 });
    expect(doc.radius.corner).toEqual({ $type: "dimension", $value: 12 });
    expect(doc.type.body).toEqual({
      $type: "typography",
      $value: { fontFamily: "Inter", fontSize: 14, fontWeight: 400 },
    });
  });

  it("round-trips through the reader, routing radius vs spacing by group", () => {
    const { tokens: back, warnings } = readDtcgTokens(tokensToDtcg(tokens));
    expect(warnings).toEqual([]);
    expect(back.colors).toEqual({
      "color/primary": "#6750A4",
      "color/on-surface": "#1C1B1F",
    });
    expect(back.spacing).toEqual({ "spacing/padding": 16 });
    // A radius token named `sm` still routes to radius because of its group path.
    expect(back.radius).toEqual({ "radius/corner": 12, "radius/sm": 4 });
    expect(back.typography?.["type/body"]).toMatchObject({ fontSize: 14 });
  });

  it("omits absent categories", () => {
    const doc = tokensToDtcg({ colors: { primary: "#fff" } });
    expect(doc).not.toHaveProperty("spacing");
    expect(doc).not.toHaveProperty("type");
  });
});

describe("dtcg reader", () => {
  it("reads and normalizes the fixture, resolving an alias", async () => {
    const { tokens, warnings } = await loadDtcgTokens(
      fixture("fixtures/tokens.tokens.json"),
    );
    expect(warnings).toEqual([]);
    expect(tokens.colors?.["color/primary"]).toBe("#6750A4");
    // `color/brand` is `{color.primary}` — resolved to the primary value.
    expect(tokens.colors?.["color/brand"]).toBe("#6750A4");
    // dimensions: string unit and {value,unit} both normalize to a number.
    expect(tokens.spacing?.["space/gutter"]).toBe(16);
    expect(tokens.spacing?.["space/inset"]).toBe(8);
  });

  it("routes corner-radius-shaped dimensions into radius", async () => {
    const { tokens } = await loadDtcgTokens(
      fixture("fixtures/tokens.tokens.json"),
    );
    expect(tokens.radius?.["shape/corner-radius"]).toBe(12);
    expect(tokens.spacing?.["shape/corner-radius"]).toBeUndefined();
  });

  it("reads composite typography", async () => {
    const { tokens } = await loadDtcgTokens(
      fixture("fixtures/tokens.tokens.json"),
    );
    expect(tokens.typography?.["type/body-large"]).toEqual({
      fontFamily: "Roboto",
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 24,
      letterSpacing: 0.5,
    });
  });

  it("inherits $type from an ancestor group", () => {
    const { tokens } = readDtcgTokens({
      palette: { $type: "color", danger: { $value: "#B3261E" } },
    });
    expect(tokens.colors?.["palette/danger"]).toBe("#B3261E");
  });

  it("warns and skips an unknown $type rather than throwing", () => {
    const { tokens, warnings } = readDtcgTokens({
      motion: { $type: "duration", quick: { $value: "200ms" } },
    });
    expect(tokens.colors).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/unsupported \$type 'duration'/);
  });

  it("warns on an unresolved alias", () => {
    const { warnings } = readDtcgTokens({
      a: { $type: "color", $value: "{color.missing}" },
    });
    expect(warnings.join(" ")).toMatch(/unresolved alias/);
  });

  it("warns on an alias cycle without hanging", () => {
    const { warnings } = readDtcgTokens({
      a: { $type: "color", $value: "{b}" },
      b: { $type: "color", $value: "{a}" },
    });
    expect(warnings.join(" ")).toMatch(/cycle/);
  });

  it("throws on a non-object root", () => {
    expect(() => readDtcgTokens([1, 2, 3])).toThrow(/JSON object/);
  });

  it("throws a readable error for a missing file", async () => {
    await expect(loadDtcgTokens(fixture("nope.tokens.json"))).rejects.toThrow(
      /cannot read/,
    );
  });
});
