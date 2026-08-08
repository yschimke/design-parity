import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type {
  CandidateRender,
  DesignReference,
  Image,
  ReferenceProperty,
} from "@design-parity/core";

import { diff, propertyConflicts } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
// A real 160×48 PNG so the visual stage runs; pairing is what we assert.
const PNG = "fixtures/figma/button-primary.light.png";

const img = (over: Partial<Image>): Image => ({
  state: "default",
  theme: "light",
  uri: PNG,
  width: 160,
  height: 48,
  ...over,
});
const ref = (images: Image[]): DesignReference => ({
  componentId: "ui/X.kt#X",
  source: "figma",
  linkMethod: "code-connect",
  referenceImages: images,
});
const cand = (images: Image[]): CandidateRender => ({
  componentId: "ui/X.kt#X",
  images,
  semantics: { theme: "light", root: { role: "button", label: "X" } },
});

const hasUnmatched = (findings: { message: string }[]) =>
  findings.some((f) => /no candidate render/.test(f.message));

describe("diff image pairing (#24)", () => {
  it("pairs when the candidate omits size (loose fallback)", async () => {
    const { verdict } = await diff(
      ref([img({ size: "compact" })]),
      cand([img({})]), // no size
      { repoRoot },
    );
    expect(hasUnmatched(verdict.findings)).toBe(false);
    expect(Object.keys(verdict.visualScores ?? {})).toContain(
      "default/light/compact",
    );
  });

  it("pairs across differently-spelled-but-equal sizes (normalized)", async () => {
    const { verdict } = await diff(
      ref([img({ size: "medium" })]),
      cand([img({ size: "700" })]), // 700dp → medium
      { repoRoot },
    );
    expect(hasUnmatched(verdict.findings)).toBe(false);
    expect(verdict.visualScores?.["default/light/medium"]).toBe(0);
  });

  it("flags a reference variant with no candidate counterpart (different known size)", async () => {
    const { verdict } = await diff(
      ref([img({ size: "expanded" })]),
      cand([img({ size: "compact" })]),
      { repoRoot },
    );
    const finding = verdict.findings.find((f) =>
      /no candidate render/.test(f.message),
    );
    expect(finding).toBeDefined();
    expect(finding!.kind).toBe("semantic");
    expect(finding!.message).toContain("default/light/expanded");
  });

  it("does not double-report when a whole theme is missing (theme-coverage owns that)", async () => {
    const { verdict } = await diff(
      ref([img({ theme: "dark", size: "compact" })]),
      cand([img({ theme: "light", size: "compact" })]),
      { repoRoot },
    );
    // theme-coverage reports the missing dark theme; the per-variant check stays quiet.
    expect(hasUnmatched(verdict.findings)).toBe(false);
    expect(
      verdict.findings.some((f) => /dark theme/.test(f.message)),
    ).toBe(true);
  });
});

/**
 * Property pairing (#296). A reference renders at its source's component
 * property defaults, and those defaults are named nowhere in the variant. When
 * the candidate says it is somewhere else in that property space, the two are
 * not a divergence to measure — they are a pair that should not have been made.
 */
const props = (...ps: ReferenceProperty[]): ReferenceProperty[] => ps;
const showIcon = (value: string): ReferenceProperty => ({
  name: "Show icon",
  type: "boolean",
  value,
});

const withProps = (
  images: Image[],
  properties: ReferenceProperty[],
): DesignReference => ({ ...ref(images), properties });

describe("property pairing (#296)", () => {
  it("does not diff a pair the reference's properties refute", async () => {
    const { verdict } = await diff(
      withProps([img({})], props(showIcon("true"))),
      cand([img({ props: { "Show icon": "false" } })]),
      { repoRoot },
    );

    const finding = verdict.findings.find((f) => f.kind === "pairing" && f.severity === "warn");
    expect(finding).toBeDefined();
    expect(finding!.message).toContain("Show icon=true vs false");
    expect(finding!.detail).toMatchObject({
      variant: "default/light",
      conflicts: [{ name: "Show icon", reference: "true", candidate: "false" }],
    });
    // Unpairable, so uncompared: no visual score for that variant.
    expect(verdict.visualScores?.["default/light"]).toBeUndefined();
  });

  it("warns rather than fails — the code is not what is wrong", async () => {
    const { verdict } = await diff(
      withProps([img({})], props(showIcon("true"))),
      cand([img({ props: { "Show icon": "false" } })]),
      { repoRoot },
    );
    expect(verdict.status).toBe("warn");
  });

  it("diffs normally when the candidate agrees (case- and space-insensitively)", async () => {
    const { verdict } = await diff(
      withProps([img({})], props(showIcon("true"))),
      cand([img({ props: { "show icon": " TRUE " } })]),
      { repoRoot },
    );
    expect(verdict.findings.some((f) => f.kind === "pairing" && f.severity === "warn")).toBe(false);
    expect(verdict.visualScores?.["default/light"]).toBe(0);
  });

  it("states what the reference depicts beyond its own name", async () => {
    const { verdict } = await diff(
      withProps(
        [img({})],
        props(showIcon("true"), { name: "Size", type: "variant", value: "Small" }),
      ),
      cand([img({})]),
      { repoRoot },
    );

    const note = verdict.findings.find((f) => f.kind === "pairing" && f.severity === "info");
    expect(note).toBeDefined();
    expect(note!.message).toContain("Show icon=true");
    // The variant axis is already in the variant key; repeating it says nothing.
    expect(note!.message).not.toContain("Size=Small");
  });
});

describe("propertyConflicts", () => {
  const image = (over: Partial<Image>): Image => img(over);

  it("treats candidate silence as no claim", () => {
    expect(propertyConflicts(props(showIcon("true")), image({}), image({}))).toEqual([]);
  });

  it("ignores properties the source does not expose", () => {
    expect(
      propertyConflicts(props(showIcon("true")), image({}), image({ props: { Density: "compact" } })),
    ).toEqual([]);
  });

  it("lets a reference image's own props override the reference-wide value", () => {
    expect(
      propertyConflicts(
        props(showIcon("true")),
        image({ props: { "Show icon": "false" } }), // this variant rendered without one
        image({ props: { "Show icon": "false" } }),
      ),
    ).toEqual([]);
  });

  it("reports the disagreement with both sides", () => {
    expect(
      propertyConflicts(props(showIcon("true")), image({}), image({ props: { "Show icon": "false" } })),
    ).toEqual([{ name: "Show icon", reference: "true", candidate: "false" }]);
  });
});
