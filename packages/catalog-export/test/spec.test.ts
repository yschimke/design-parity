import { describe, expect, it } from "vitest";

import type { CandidateRender } from "@design-parity/core";

import { catalogFromCandidates, screenGraphIssues } from "../src/spec.js";
import type { CatalogSpec } from "../src/spec.js";

function candidate(previewId: string, fn: string): CandidateRender {
  return {
    componentId: previewId,
    previewId: `${previewId}.${fn}`,
    images: [{ state: "default", theme: "light", uri: `${fn}.png`, width: 10, height: 10 }],
    semantics: {
      root: { children: [{ role: "button", label: fn, bounds: { x: 0, y: 0, width: 80, height: 48 } }] },
      themeTokens: { colors: { primary: "#6750a4" } },
    },
  };
}

const spec: CatalogSpec = {
  system: "compose-m3",
  title: "Compose Material 3",
  library: ["androidx.compose.material3:material3"],
  groups: [
    {
      name: "Buttons",
      components: [
        { componentId: "Button/Filled", preview: "FilledButton", caption: "Primary" },
        { componentId: "Button/Text", preview: "TextButtonSticker" },
      ],
    },
  ],
};

describe("screenGraphIssues", () => {
  it("is empty when every screen ref names a declared component", () => {
    const ok: CatalogSpec = {
      ...spec,
      screens: [{ id: "Button/Filled", related: ["Button/Text"] }],
    };
    expect(screenGraphIssues(ok)).toEqual([]);
  });

  it("is empty when there is no screen graph", () => {
    expect(screenGraphIssues(spec)).toEqual([]);
  });

  it("flags a screen id and a related id that no group declares", () => {
    const bad: CatalogSpec = {
      ...spec,
      screens: [{ id: "Screen/Ghost", related: ["Button/Text", "Dialog/Missing"] }],
    };
    expect(screenGraphIssues(bad)).toEqual([
      'screen "Screen/Ghost" is not a declared component',
      'screen "Screen/Ghost" relates to undeclared component "Dialog/Missing"',
    ]);
  });
});

describe("catalogFromCandidates", () => {
  it("joins candidates to spec components by preview function name", () => {
    const { catalog, missing } = catalogFromCandidates(
      [candidate("com.example.CKt", "FilledButton"), candidate("com.example.CKt", "TextButtonSticker")],
      spec,
      { renderer: "compose-preview 0.16.2", generatedAt: "2026-06-23T00:00:00Z" },
    );

    expect(missing).toEqual([]);
    expect(catalog.meta).toMatchObject({ system: "compose-m3", renderer: "compose-preview 0.16.2" });
    expect(catalog.components.map((c) => c.componentId)).toEqual(["Button/Filled", "Button/Text"]);
    const filled = catalog.components[0]!;
    expect(filled.group).toBe("Buttons");
    expect(filled.caption).toBe("Primary");
    expect(filled.variants.ideal).toHaveLength(1);
    // greenline derived from the interactive node in the candidate semantics
    expect(filled.greenlines.some((g) => g.detail?.["role"] === "button")).toBe(true);
  });

  it("lifts the system token set from a candidate's themeTokens", () => {
    const { catalog } = catalogFromCandidates(
      [candidate("com.example.CKt", "FilledButton"), candidate("com.example.CKt", "TextButtonSticker")],
      spec,
    );
    expect(catalog.themeTokens).toEqual({ colors: { primary: "#6750a4" } });
  });

  it("carries an optional screen graph through to catalog meta", () => {
    const withScreens: CatalogSpec = {
      ...spec,
      screens: [{ id: "Button/Filled", title: "Primary action", related: ["Button/Text"] }],
    };
    const { catalog } = catalogFromCandidates(
      [candidate("com.example.CKt", "FilledButton"), candidate("com.example.CKt", "TextButtonSticker")],
      withScreens,
    );
    expect(catalog.meta.screens).toEqual([
      { id: "Button/Filled", title: "Primary action", related: ["Button/Text"] },
    ]);
  });

  it("omits screens from meta when the spec declares none", () => {
    const { catalog } = catalogFromCandidates([candidate("com.example.CKt", "FilledButton")], spec);
    expect(catalog.meta.screens).toBeUndefined();
  });

  it("carries optional display hints (surface + hero) through to catalog meta", () => {
    const withDisplay: CatalogSpec = {
      ...spec,
      display: { surface: "dark", hero: "Button/Filled" },
    };
    const { catalog } = catalogFromCandidates(
      [candidate("com.example.CKt", "FilledButton")],
      withDisplay,
    );
    expect(catalog.meta.display).toEqual({ surface: "dark", hero: "Button/Filled" });
  });

  it("omits display from meta when the spec declares none", () => {
    const { catalog } = catalogFromCandidates([candidate("com.example.CKt", "FilledButton")], spec);
    expect(catalog.meta.display).toBeUndefined();
  });

  it("reports spec components with no rendered preview as missing", () => {
    const { catalog, missing } = catalogFromCandidates(
      [candidate("com.example.CKt", "FilledButton")],
      spec,
    );
    expect(missing).toEqual(["Button/Text"]);
    expect(catalog.components.map((c) => c.componentId)).toEqual(["Button/Filled"]);
  });

  it("folds a function's theme multipreview variants into one component", () => {
    // The real bundle reader emits one candidate per multipreview variant: the
    // ids carry a `_Light` / `_Dark` suffix the spec doesn't, and `functionName`
    // carries the stable identity. Both must fold onto one sticker with both
    // theme images — keying off the suffixed previewId tail would match neither
    // (regression: catalogFromCandidates matched 0/N before functionName).
    const variant = (fn: string, theme: "light" | "dark"): CandidateRender => ({
      componentId: `com.example.CKt.${fn}_${theme === "light" ? "Light" : "Dark"}`,
      previewId: `com.example.CKt.${fn}_${theme === "light" ? "Light" : "Dark"}`,
      functionName: fn,
      images: [{ state: "default", theme, uri: `${fn}_${theme}.png`, width: 10, height: 10 }],
      semantics: {
        theme,
        root: { children: [{ role: "button", label: fn, bounds: { x: 0, y: 0, width: 80, height: 48 } }] },
        ...(theme === "light" ? { themeTokens: { colors: { primary: "#6750a4" } } } : {}),
      },
    });

    const { catalog, missing, withoutSemantics } = catalogFromCandidates(
      [
        variant("FilledButton", "light"),
        variant("FilledButton", "dark"),
        variant("TextButtonSticker", "light"),
        variant("TextButtonSticker", "dark"),
      ],
      spec,
    );

    expect(missing).toEqual([]);
    expect(withoutSemantics).toEqual([]);
    expect(catalog.components.map((c) => c.componentId)).toEqual(["Button/Filled", "Button/Text"]);
    // Both theme captures land on the one sticker, not just the last one.
    expect(catalog.components[0]!.variants.ideal).toHaveLength(2);
    expect(catalog.components[0]!.variants.ideal.map((i) => i.theme).sort()).toEqual(["dark", "light"]);
    // The light tree is kept for tokens/greenlines.
    expect(catalog.themeTokens).toEqual({ colors: { primary: "#6750a4" } });
  });

  it("folds a component's state variants onto its sticker, re-tagged by state", () => {
    const specWithVariants: CatalogSpec = {
      system: "compose-m3",
      title: "Compose Material 3",
      groups: [
        {
          name: "Buttons",
          components: [
            {
              componentId: "Button/Filled",
              preview: "FilledButton",
              variants: [
                { state: "pressed", preview: "FilledButtonPressed" },
                { state: "disabled", preview: "FilledButtonDisabled" },
              ],
            },
          ],
        },
      ],
    };

    const { catalog, missing } = catalogFromCandidates(
      [
        candidate("com.example.CKt", "FilledButton"),
        candidate("com.example.CKt", "FilledButtonPressed"),
        candidate("com.example.CKt", "FilledButtonDisabled"),
      ],
      specWithVariants,
    );

    expect(missing).toEqual([]);
    // 1 default + 1 pressed + 1 disabled, all on the one component.
    const ideal = catalog.components[0]!.variants.ideal;
    expect(ideal.map((i) => i.state)).toEqual(["default", "pressed", "disabled"]);
  });

  it("folds a content-axis variant (label vs icon+label) via props", () => {
    const specWithVariants: CatalogSpec = {
      system: "compose-m3",
      title: "Compose Material 3",
      groups: [
        {
          name: "Buttons",
          components: [
            {
              componentId: "Button/Filled",
              preview: "FilledButton",
              variants: [{ props: { content: "icon+label" }, preview: "FilledButtonIconLabel" }],
            },
          ],
        },
      ],
    };

    const { catalog, missing } = catalogFromCandidates(
      [
        candidate("com.example.CKt", "FilledButton"),
        candidate("com.example.CKt", "FilledButtonIconLabel"),
      ],
      specWithVariants,
    );

    expect(missing).toEqual([]);
    const ideal = catalog.components[0]!.variants.ideal;
    // The default carries no props; the variant carries the content axis.
    expect(ideal[0]!.props).toBeUndefined();
    expect(ideal[1]!.props).toEqual({ content: "icon+label" });
  });

  it("reports a props-only variant that didn't render, labelled by its axes", () => {
    const spec2: CatalogSpec = {
      ...spec,
      groups: [
        {
          name: "Buttons",
          components: [
            { componentId: "Button/Filled", preview: "FilledButton", variants: [{ props: { content: "icon+label" }, preview: "Missing" }] },
          ],
        },
      ],
    };
    const { missing } = catalogFromCandidates([candidate("com.example.CKt", "FilledButton")], spec2);
    expect(missing).toEqual(["Button/Filled [content=icon+label]"]);
  });

  it("reports a variant whose preview did not render, keyed by state", () => {
    const specWithVariants: CatalogSpec = {
      system: "compose-m3",
      title: "Compose Material 3",
      groups: [
        {
          name: "Buttons",
          components: [
            {
              componentId: "Button/Filled",
              preview: "FilledButton",
              variants: [{ state: "focused", preview: "FilledButtonFocused" }],
            },
          ],
        },
      ],
    };

    const { catalog, missing } = catalogFromCandidates(
      [candidate("com.example.CKt", "FilledButton")],
      specWithVariants,
    );
    expect(missing).toEqual(["Button/Filled [focused]"]);
    expect(catalog.components[0]!.variants.ideal.map((i) => i.state)).toEqual(["default"]);
  });

  it("flags rendered components whose semantics are the empty fallback", () => {
    const noSem: CandidateRender = {
      componentId: "x",
      previewId: "com.example.CKt.TextButtonSticker",
      images: [{ state: "default", uri: "x.png", width: 1, height: 1 }],
      semantics: { root: {} }, // pixels but no semantics sidecar
    };
    const { missing, withoutSemantics } = catalogFromCandidates(
      [candidate("com.example.CKt", "FilledButton"), noSem],
      spec,
    );
    expect(missing).toEqual([]);
    expect(withoutSemantics).toEqual(["Button/Text"]);
  });
});
