/**
 * The committed contract. Validation matters more for a generated file than a
 * hand-authored one: nobody proof-reads it, and a half-written index fails as a
 * resolver that silently finds nothing — reported as "no counterpart in the
 * kit" about a kit full of counterparts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseKitIndex, validateKitIndex } from "../src/index.js";

const fixture = readFileSync(
  new URL("./fixtures/m3-kit-index.json", import.meta.url),
  "utf8",
);

describe("validateKitIndex", () => {
  it("accepts the committed fixture", () => {
    expect(validateKitIndex(JSON.parse(fixture))).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("accepts a minimal index", () => {
    expect(
      validateKitIndex({ fileKey: "k", sets: {}, standalone: {} }).valid,
    ).toBe(true);
  });

  it("rejects an index with no file key", () => {
    // Node ids are unique per file only, so an index that does not name its
    // file cannot be checked against the refs that use it.
    const result = validateKitIndex({ sets: {}, standalone: {} });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/fileKey/);
  });

  it("rejects a VARIANT component property", () => {
    // Variant axes live in each variant's name. Recording them here too gives
    // the index two sources of truth that can disagree.
    const result = validateKitIndex({
      fileKey: "k",
      standalone: {},
      sets: {
        "1:1": {
          name: "Button",
          variants: [{ id: "1:2", name: "Size=Small" }],
          properties: { Size: { type: "VARIANT", default: "Small" } },
        },
      },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects an instance with an incomplete shape", () => {
    const result = validateKitIndex({
      fileKey: "k",
      standalone: {},
      sets: {
        "1:1": {
          name: "Button",
          variants: [{ id: "1:2", name: "Size=Small" }],
          instances: [{ id: "1:3", properties: {} }],
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/componentId/);
  });
});

describe("parseKitIndex", () => {
  it("round-trips the fixture", () => {
    expect(parseKitIndex(fixture).fileKey).toBe("ocdacdEsnHipMJD3egzxKb");
  });

  it("names the input in a JSON error", () => {
    expect(() => parseKitIndex("{ nope", "kit.json")).toThrow(/kit\.json.*not valid JSON/);
  });

  it("reports every schema error at once", () => {
    expect(() => parseKitIndex(`{"sets":{},"standalone":{}}`, "kit.json")).toThrow(
      /failed schema validation/,
    );
  });
});
