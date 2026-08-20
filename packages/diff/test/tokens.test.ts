import { describe, it, expect } from "vitest";

import type { DesignTokens, SemanticNode } from "@design-parity/core";

import { defaultDiffConfig } from "../src/config.js";
import {
  collectDerivedInsets,
  collectRadiusBoxes,
  collectTokens,
  diffTokens,
} from "../src/tokens.js";

describe("collectTokens", () => {
  it("flattens a tree, merging distinctly-keyed tokens from every node", () => {
    const root: SemanticNode = {
      role: "button",
      tokens: {
        spacing: { padding: 12 },
        colors: { container: "#000000" },
      },
      children: [
        {
          role: "text",
          tokens: {
            colors: { label: "#FFFFFF" },
            typography: { label: { fontSize: 14 } },
          },
        },
      ],
    };
    expect(collectTokens(root)).toEqual<DesignTokens>({
      spacing: { padding: 12 },
      colors: { container: "#000000", label: "#FFFFFF" },
      typography: { label: { fontSize: 14 } },
    });
  });

  it("preserves distinct same-role values across nodes, deduping repeats", () => {
    // Every node resolves its colour/radius/spacing under the same generic role
    // keys; a plain spread would let the last node win and the rest vanish. Keep
    // each distinct value (newcomers under `<key>#<n>`); drop an exact repeat.
    const root: SemanticNode = {
      tokens: { colors: { bg: "#111111" }, radius: { corner: 8 }, spacing: { gap: 8 } },
      children: [
        {
          tokens: { colors: { bg: "#222222" }, radius: { corner: 12 }, spacing: { gap: 12 } },
        },
        { tokens: { colors: { bg: "#111111" } } }, // exact repeat → deduped
      ],
    };
    const out = collectTokens(root);
    expect(new Set(Object.values(out.colors ?? {}))).toEqual(new Set(["#111111", "#222222"]));
    expect(new Set(Object.values(out.radius ?? {}))).toEqual(new Set([8, 12]));
    expect(new Set(Object.values(out.spacing ?? {}))).toEqual(new Set([8, 12]));
  });

  it("lets a named spec colour match a value carried by a non-last node (#1908)", () => {
    // The surface colour is on the parent; a child re-uses `bg` for white. Before
    // distinct-value preservation the child clobbered it and `surface` reported
    // missing — now the parent value survives under `bg` and matches by role.
    const root: SemanticNode = {
      tokens: { colors: { bg: "#F4FBF8" } },
      children: [{ tokens: { colors: { bg: "#FFFFFF" } } }],
    };
    const cand = collectTokens(root);
    expect(diffTokens({ colors: { surface: "#F4FBF8" } }, cand, defaultDiffConfig)).toEqual([]);
  });

  it("keeps typography tokens that differ only by a #1934 field distinct", () => {
    // Two `text` nodes that agree on size but draw different faces (one italic)
    // must both survive the merge, not dedupe to one.
    const root: SemanticNode = {
      tokens: { typography: { text: { fontSize: 14 } } },
      children: [{ tokens: { typography: { text: { fontSize: 14, fontStyle: "italic" } } } }],
    };
    expect(collectTokens(root).typography).toEqual({
      text: { fontSize: 14 },
      "text#2": { fontSize: 14, fontStyle: "italic" },
    });
  });
});

describe("diffTokens", () => {
  const spec: DesignTokens = {
    spacing: { padding: 16 },
    radius: { corner: 8 },
    colors: { label: "#FFFFFF" },
  };

  it("is empty when the candidate matches the spec", () => {
    expect(diffTokens(spec, spec, defaultDiffConfig)).toEqual([]);
  });

  describe("fully-rounded corners", () => {
    // A corner is judged against the box IT rounds, which is a descendant node —
    // not the sticker frame around it. Building the tree the way the renderer
    // does is the point of these fixtures: the first cut of this check read the
    // root's bounds and silently normalised nothing in the real pipeline.
    const tree = (radius: number, box: { width: number; height: number }): SemanticNode => ({
      role: "frame",
      bounds: { x: 0, y: 0, width: 137, height: 84 },
      children: [
        {
          role: "switch",
          bounds: { x: 0, y: 0, ...box },
          tokens: { radius: { corner: radius } },
        },
      ],
    });
    const rounded: DesignTokens = { radius: { corner: 100 } };
    const boxesOf = (radius: number, box: { width: number; height: number }) =>
      collectRadiusBoxes(tree(radius, box));

    it.each([
      ["Badge/Dot", 3.05, { width: 3, height: 3 }],
      ["Badge/Number", 3.81, { width: 7, height: 7 }],
      ["Switch/On", 16, { width: 32, height: 20 }],
    ])("%s: %d on its own box is the kit's 100", (_n, radius, box) => {
      const findings = diffTokens(
        rounded,
        { radius: { corner: radius } },
        defaultDiffConfig,
        undefined,
        boxesOf(radius, box),
      );
      expect(findings).toEqual([]);
    });

    it("is not fooled by the frame the node sits in", () => {
      // 16 vs half of the 137x84 FRAME is not a pill; vs half of the 32x20
      // track it is. Reading the frame is the bug this pins.
      const boxes = boxesOf(16, { width: 32, height: 20 });
      expect([...boxes.get(16)!.map((b) => `${b.width}x${b.height}`)]).toEqual(["32x20"]);
    });

    it("still reports a radius short of its own clamp", () => {
      const findings = diffTokens(
        { radius: { corner: 16 } },
        { radius: { corner: 4 } },
        defaultDiffConfig,
        undefined,
        boxesOf(4, { width: 30, height: 17 }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: "error" });
    });

    it("does not normalise when only the candidate is past the clamp", () => {
      const findings = diffTokens(
        { radius: { corner: 4 } },
        { radius: { corner: 16 } },
        defaultDiffConfig,
        undefined,
        boxesOf(16, { width: 32, height: 20 }),
      );
      expect(findings).toHaveLength(1);
    });

    it("reports normally when no node carried bounds, rather than guessing", () => {
      const findings = diffTokens(rounded, { radius: { corner: 16 } }, defaultDiffConfig);
      expect(findings).toHaveLength(1);
    });

    it("normalises a dp radius against px bounds when the tree names its density", () => {
      // The real pipeline's two units disagree: compose/semantics emits `bounds`
      // in render pixels and `tokens` in dp (the producer applies density to one
      // and not the other). A Wear icon button is 52dp with a 26dp corner,
      // captured at dpi 320 — so its box arrives as 104x104 while the corner is
      // still 26, and the clamp test read 26 >= 52 as "not a pill". That is what
      // put `radius.corner: 26 vs spec 200 (Δ174)` on every icon button in
      // wear-m3-catalog while the renders differed by ~1% of pixels.
      const px: SemanticNode = {
        role: "frame",
        bounds: { x: 0, y: 0, width: 104, height: 104 },
        children: [
          {
            role: "button",
            bounds: { x: 0, y: 0, width: 104, height: 104 },
            tokens: { radius: { corner: 26 } },
          },
        ],
      };
      const findings = diffTokens(
        { radius: { corner: 200 } },
        { radius: { corner: 26 } },
        defaultDiffConfig,
        undefined,
        collectRadiusBoxes(px, 2),
      );
      expect(findings).toEqual([]);
    });

    it("leaves spacing alone — only a corner can be clamped", () => {
      const findings = diffTokens(
        { spacing: { padding: 100 } },
        { spacing: { padding: 16 } },
        defaultDiffConfig,
        undefined,
        boxesOf(16, { width: 32, height: 20 }),
      );
      expect(findings).toHaveLength(1);
    });
  });

  describe("an inset the render draws but does not declare", () => {
    // Wear's `IconButton`, measured off the kit: cell 34732:103015 is a 52x52
    // frame declaring `padding: 12` around a 26x26 icon at (13,13). Compose
    // draws the same button by CENTRING the icon — no padding modifier — so the
    // candidate reports `padding: 0`. Captured at dpi 320, its bounds arrive as
    // px: a 104x104 button around a 52x52 icon.
    const iconButton = (iconPx: number): SemanticNode => ({
      role: "button",
      bounds: { x: 0, y: 0, width: 104, height: 104 },
      tokens: { spacing: { padding: 0 } },
      children: [
        {
          role: "image",
          bounds: {
            x: (104 - iconPx) / 2,
            y: (104 - iconPx) / 2,
            width: iconPx,
            height: iconPx,
          },
        },
      ],
    });

    it("measures the drawn inset in dp, not render pixels", () => {
      // 52px of margin either side of a 52px icon in a 104px box is 26px — but
      // the spec is in dp, so the answer must be 13.
      expect(collectDerivedInsets(iconButton(52), 2).map((i) => i.inset)).toEqual([13]);
      expect(collectDerivedInsets(iconButton(52)).map((i) => i.inset)).toEqual([26]);
    });

    it("satisfies the spec without a declared padding, and says how", () => {
      const findings = diffTokens(
        { spacing: { padding: 12 } },
        { spacing: { padding: 0 } },
        defaultDiffConfig,
        undefined,
        undefined,
        collectDerivedInsets(iconButton(52), 2),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "info",
        detail: { via: "measured-geometry", expected: 12, actual: 13 },
      });
    });

    it("reports the miss in the measured number, not the declared zero", () => {
      // The same button drawing a 24dp icon instead of the kit's 26dp insets 14,
      // not 13 — past the 1dp allowance. The error must quote THAT: "0 vs spec
      // 12" names a modifier the code was never going to have, and asserting
      // only that some error exists would pass against the unfixed code too.
      const findings = diffTokens(
        { spacing: { padding: 12 } },
        { spacing: { padding: 0 } },
        defaultDiffConfig,
        undefined,
        undefined,
        collectDerivedInsets(iconButton(48), 2),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "error",
        message: "spacing.padding: renders 14 vs spec 12 (Δ2)",
        detail: { expected: 12, actual: 14, delta: 2, via: "measured-geometry" },
      });
    });

    it("lets the container that declares padding speak, not a nested box", () => {
      // The component reports `padding: 0` — a claim about its own padding. A
      // decorative child that happens to inset near the spec is incidental
      // geometry, and letting it answer would demote a real error to an info.
      const nested: SemanticNode = {
        role: "button",
        bounds: { x: 0, y: 0, width: 200, height: 200 },
        tokens: { spacing: { padding: 0 } },
        children: [
          {
            role: "box",
            bounds: { x: 40, y: 40, width: 120, height: 120 },
            children: [{ role: "image", bounds: { x: 52, y: 52, width: 96, height: 96 } }],
          },
        ],
      };
      const insets = collectDerivedInsets(nested);
      // Both are measured: the button insets 40, the inner box insets 12.
      expect(insets.map((i) => i.inset).sort((a, b) => a - b)).toEqual([12, 40]);
      const findings = diffTokens(
        { spacing: { padding: 12 } },
        { spacing: { padding: 0 } },
        defaultDiffConfig,
        undefined,
        undefined,
        insets,
      );
      // The declaring container's 40 answers, and it misses — the inner 12 is
      // an exact match on paper but says nothing about the component.
      expect(findings[0]).toMatchObject({
        severity: "error",
        detail: { actual: 40, expected: 12 },
      });
    });

    it("answers an inset spec even when the candidate resolved no spacing at all", () => {
      // `unverifiableGroup` short-circuits a candidate with an empty spacing
      // group — which is the *true* "declares nothing" case, and the one the
      // geometry check is for. It must not be unreachable there.
      const findings = diffTokens(
        { spacing: { padding: 12 } },
        {},
        defaultDiffConfig,
        undefined,
        undefined,
        collectDerivedInsets(iconButton(52), 2),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "info",
        detail: { via: "measured-geometry", actual: 13 },
      });
    });

    it("still says 'not evaluated' when there is no geometry to measure", () => {
      const findings = diffTokens({ spacing: { padding: 12 } }, {}, defaultDiffConfig);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: "info", detail: { unverified: true } });
    });

    it("keeps inset meaning through a token alias that renames it", () => {
      // `space/inset` aliased to code `gutter`: `applyAlias` rewrites the key
      // before the inset predicate sees it, so classifying on the code name
      // alone would switch the geometry check off for precisely the projects
      // that configured an alias.
      const findings = diffTokens(
        { spacing: { "space/inset": 12 } },
        { spacing: { gutter: 0 } },
        defaultDiffConfig,
        { spacing: { gutter: "space/inset" } },
        undefined,
        collectDerivedInsets(iconButton(52), 2),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: "info", detail: { via: "measured-geometry" } });
    });

    it("does not overrule a declared value that already satisfies the spec", () => {
      // wear-m3-catalog's `TextToggle` went warn → fail on this: it declares
      // `padding: 0` against a spec of 1, which is inside the 1dp tolerance and
      // was passing, and the geometry pass overrode that pass with a measured 8.
      // Geometry is a second opinion for a token the declared value cannot
      // answer, never a way to overrule one that already did.
      const findings = diffTokens(
        { spacing: { padding: 1 } },
        { spacing: { padding: 0 } },
        defaultDiffConfig,
        undefined,
        undefined,
        [{ inset: 8, declaresSpacing: true }],
      );
      expect(findings).toEqual([]);
    });

    it("drops an inset that rounds to nothing rather than quoting it", () => {
      // A child sitting flush measures a sub-dp sliver off the px→dp conversion.
      // `measuredSpacing` rounds for this reason; quoting "renders 0.5" reads as
      // a measurement when it is an artifact — wear-m3-catalog's `DateWheels`
      // reported exactly that against a spec of 14.
      const flush: SemanticNode = {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [{ bounds: { x: 0.5, y: 0.5, width: 99, height: 99 } }],
      };
      expect(collectDerivedInsets(flush)).toEqual([]);
    });

    it("does not let a measured inset answer a gap spec", () => {
      // A gap is the space BETWEEN siblings; an inset is the space around them.
      // Satisfying one with the other compares two different measurements that
      // merely share a vocabulary.
      const findings = diffTokens(
        { spacing: { gap: 12 } },
        { spacing: { gap: 0 } },
        defaultDiffConfig,
        undefined,
        undefined,
        [{ inset: 13, declaresSpacing: true }],
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: "error", detail: { actual: 0 } });
    });

    it("reports only a uniform inset — an off-centre child is a different shape", () => {
      const offCentre: SemanticNode = {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [{ bounds: { x: 10, y: 30, width: 80, height: 40 } }],
      };
      expect(collectDerivedInsets(offCentre)).toEqual([]);
    });

    it("drops a child that fills or overflows its parent", () => {
      const fills: SemanticNode = {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [{ bounds: { x: 0, y: 0, width: 100, height: 100 } }],
      };
      const overflows: SemanticNode = {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [{ bounds: { x: -5, y: -5, width: 110, height: 110 } }],
      };
      expect(collectDerivedInsets(fills)).toEqual([]);
      expect(collectDerivedInsets(overflows)).toEqual([]);
    });
  });

  it("flags numeric drift beyond tolerance as an error", () => {
    const findings = diffTokens(
      spec,
      { ...spec, spacing: { padding: 12 } },
      defaultDiffConfig,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "token", severity: "error" });
  });

  it("respects a configured spacing tolerance", () => {
    const lenient = { ...defaultDiffConfig, spacingTolerance: 4 };
    const findings = diffTokens(
      spec,
      { ...spec, spacing: { padding: 12 } },
      lenient,
    );
    expect(findings).toEqual([]);
  });

  it("flags colour drift as a warning, case-insensitively for matches", () => {
    const matchLower = diffTokens(
      spec,
      { ...spec, colors: { label: "#ffffff" } },
      defaultDiffConfig,
    );
    expect(matchLower).toEqual([]);

    const drift = diffTokens(
      spec,
      { ...spec, colors: { label: "#EEEEEE" } },
      defaultDiffConfig,
    );
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ kind: "token", severity: "warn" });
  });

  it("flags an absent token: numeric is a hard error, unmappable colour is advisory (#102)", () => {
    // The candidate resolved *some* radius and colour (so both groups are
    // verifiable), just not the ones the spec names.
    const findings = diffTokens(
      spec,
      { spacing: { padding: 16 }, radius: { other: 20 }, colors: { fg: "#000000" } },
      defaultDiffConfig,
    );
    // radius.corner (numeric) stays strict → error; colors.label maps to no
    // Material role and didn't value-match → non-blocking advisory.
    expect(findings).toHaveLength(2);
    const radius = findings.find((f) => f.detail?.token === "radius.corner");
    const label = findings.find((f) => f.detail?.token === "colors.label");
    expect(radius).toMatchObject({ severity: "error" });
    expect(label).toMatchObject({ severity: "info", detail: { unmapped: true } });
  });

  it("matches a colour that differs only by a full-alpha suffix (issue #74)", () => {
    // `argbToCssHex` emits `#RRGGBBAA`; `#FF161D1B` (ARGB) becomes `#161d1bff`.
    const colourSpec: DesignTokens = { colors: { onSurface: "#161D1B" } };
    expect(
      diffTokens(colourSpec, { colors: { onSurface: "#161d1bff" } }, defaultDiffConfig),
    ).toEqual([]);
  });

  it("satisfies a named spec colour from a generic role key of the same role (issue #74)", () => {
    // No resolved theme → the value lands under the role key `fg`, not `onSurface`.
    const colourSpec: DesignTokens = { colors: { onSurface: "#161D1B" } };
    expect(
      diffTokens(colourSpec, { colors: { fg: "#161d1bff" } }, defaultDiffConfig),
    ).toEqual([]);
  });

  it("does not let a background candidate value satisfy a foreground spec token", () => {
    const colourSpec: DesignTokens = { colors: { onSurface: "#161D1B" } };
    const findings = diffTokens(
      colourSpec,
      { colors: { bg: "#161d1bff" } },
      defaultDiffConfig,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      detail: { token: "colors.onSurface", actual: null },
    });
  });

  it("matches an accent base role (primary) against either-ground candidate value", () => {
    // `primary` is an M3 accent used as a fill *and* as accent text/icon, so the
    // candidate may resolve it under `fg` or `bg`; either satisfies the spec.
    const accent: DesignTokens = { colors: { primary: "#006A60" } };
    expect(
      diffTokens(accent, { colors: { fg: "#006a60ff", bg: "#ffffffff" } }, defaultDiffConfig),
    ).toEqual([]);
    expect(
      diffTokens(accent, { colors: { bg: "#006a60ff" } }, defaultDiffConfig),
    ).toEqual([]);
  });

  it("satisfies a named spec spacing token from a within-tolerance value match (#1897)", () => {
    // The candidate carries resolved padding under generic keys, not the
    // reference's `screenPadding` name — a value match still satisfies the spec.
    const padSpec: DesignTokens = { spacing: { screenPadding: 16 } };
    expect(
      diffTokens(
        padSpec,
        { spacing: { paddingStart: 16, padding: 16 } },
        defaultDiffConfig,
      ),
    ).toEqual([]);
  });

  it("satisfies a named spec radius token from a value match (#1897)", () => {
    const radSpec: DesignTokens = { radius: { card: 12 } };
    expect(
      diffTokens(radSpec, { radius: { corner: 12 } }, defaultDiffConfig),
    ).toEqual([]);
  });

  it("reports a numeric token missing when no candidate value is within tolerance (#1897)", () => {
    const padSpec: DesignTokens = { spacing: { screenPadding: 16 } };
    const findings = diffTokens(
      padSpec,
      { spacing: { padding: 4 } },
      defaultDiffConfig,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      detail: { token: "spacing.screenPadding", actual: null },
    });
  });

  describe("token alias map (issue #78)", () => {
    it("matches a design-named token to its code counterpart across kinds", () => {
      const designSpec: DesignTokens = {
        colors: { "color/on-surface": "#161D1B" },
        typography: { "type/body/large": { fontSize: 16 } },
        spacing: { "space/gutter": 16 },
        radius: { "radius/card": 8 },
      };
      const candidate: DesignTokens = {
        colors: { onSurface: "#161d1b" },
        typography: { bodyLarge: { fontSize: 16 } },
        spacing: { gutter: 16 },
        radius: { card: 8 },
      };
      const alias = {
        colors: { onSurface: "color/on-surface" },
        typography: { bodyLarge: "type/body/large" },
        spacing: { gutter: "space/gutter" },
        radius: { card: "radius/card" },
      };
      expect(diffTokens(designSpec, candidate, defaultDiffConfig, alias)).toEqual([]);
    });

    it("still flags drift after aliasing (value compare is unchanged)", () => {
      const designSpec: DesignTokens = { colors: { "color/on-surface": "#161D1B" } };
      const candidate: DesignTokens = { colors: { onSurface: "#101413" } };
      const alias = { colors: { onSurface: "color/on-surface" } };
      const findings = diffTokens(designSpec, candidate, defaultDiffConfig, alias);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "warn",
        detail: { token: "colors.onSurface" },
      });
    });

    it("falls back to the Material role heuristic when no alias is supplied (issue #87)", () => {
      // `color/on-surface` denotes the Material role `onSurface`; with values in
      // agreement the heuristic satisfies the spec without an explicit alias.
      const designSpec: DesignTokens = { colors: { "color/on-surface": "#161D1B" } };
      const candidate: DesignTokens = { colors: { onSurface: "#161d1b" } };
      expect(diffTokens(designSpec, candidate, defaultDiffConfig)).toEqual([]);
    });
  });

  describe("Material role heuristic (issue #87)", () => {
    it("matches a design-vocabulary colour to the candidate's resolved role", () => {
      const designSpec: DesignTokens = {
        colors: { "color/on-surface-variant": "#44483E" },
      };
      const candidate: DesignTokens = { colors: { onSurfaceVariant: "#44483e" } };
      expect(diffTokens(designSpec, candidate, defaultDiffConfig)).toEqual([]);
    });

    it("flags a role-mapped colour mismatch as a low-confidence warning", () => {
      const designSpec: DesignTokens = { colors: { "color/on-surface": "#161D1B" } };
      const candidate: DesignTokens = { colors: { onSurface: "#101413" } };
      const findings = diffTokens(designSpec, candidate, defaultDiffConfig);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "warn",
        detail: { token: "colors.color/on-surface", role: "onSurface", via: "role-heuristic" },
      });
    });

    it("matches a design-vocabulary typography token to its Material type role", () => {
      const designSpec: DesignTokens = {
        typography: { "type/body/large": { fontSize: 16 } },
      };
      const candidate: DesignTokens = { typography: { bodyLarge: { fontSize: 16 } } };
      expect(diffTokens(designSpec, candidate, defaultDiffConfig)).toEqual([]);
    });

    it("reports a colour that maps to no Material role as advisory, not missing (#102)", () => {
      // `label` is not a colour role; with no value match it's unverifiable, so
      // a non-blocking advisory rather than a false `missing` error.
      // The candidate resolved *some* colour (so the group is verifiable), just
      // not one that lines up with `label`.
      const designSpec: DesignTokens = { colors: { label: "#FFFFFF" } };
      const findings = diffTokens(designSpec, { colors: { bg: "#000000" } }, defaultDiffConfig);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "info",
        detail: { token: "colors.label", unmapped: true },
      });
    });

    it("keeps a role-mapped colour the candidate lacks as a hard error (#102)", () => {
      // `onSurface` IS a Material role; a candidate that resolved other colours
      // but genuinely lacks this one is a real gap, not an unmappable one.
      const designSpec: DesignTokens = { colors: { onSurface: "#161D1B" } };
      const findings = diffTokens(designSpec, { colors: { bg: "#000000" } }, defaultDiffConfig);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: "error", detail: { actual: null } });
    });

    it("reports an unmappable typography token as advisory (#102)", () => {
      const designSpec: DesignTokens = { typography: { caption: { fontSize: 12 } } };
      const findings = diffTokens(
        designSpec,
        { typography: { bodyLarge: { fontSize: 16 } } },
        defaultDiffConfig,
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "info",
        detail: { token: "typography.caption", unmapped: true },
      });
    });

    it("collapses a group the candidate resolved nothing for into one note, not N errors", () => {
      // The geometry-only-capture case: the candidate surfaces no colours at all,
      // so comparing the whole palette would emit an identical `missing` error per
      // token. Instead of a dozen hard errors (and a false fail), one non-blocking
      // note says compliance couldn't be evaluated — an extraction gap, not proof
      // the candidate is wrong (issue #102, extended to whole groups).
      const designSpec: DesignTokens = {
        colors: { onSurface: "#161D1B", primary: "#006A60", secondary: "#4A635F" },
      };
      const findings = diffTokens(designSpec, {}, defaultDiffConfig);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        kind: "token",
        severity: "info",
        detail: { token: "colors.*", unverified: true, specCount: 3 },
      });
    });

    it("still verifies a group the candidate did resolve, even if another is empty", () => {
      // Colours are absent (→ one note) but radius is present and correct (→ no
      // finding): the empty group must not suppress the group that can be checked.
      const designSpec: DesignTokens = {
        colors: { onSurface: "#161D1B", primary: "#006A60" },
        radius: { corner: 16 },
      };
      const findings = diffTokens(designSpec, { radius: { corner: 16 } }, defaultDiffConfig);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ detail: { token: "colors.*", unverified: true } });
    });

    it("lets an explicit alias override the heuristic", () => {
      // The alias renames the spec to a non-role code name the candidate carries;
      // the heuristic (which would map to `onSurface`) is never consulted.
      const designSpec: DesignTokens = { colors: { "color/on-surface": "#161D1B" } };
      const candidate: DesignTokens = { colors: { brandFg: "#161d1b" } };
      const alias = { colors: { brandFg: "color/on-surface" } };
      expect(diffTokens(designSpec, candidate, defaultDiffConfig, alias)).toEqual([]);
    });
  });

  describe("resolved typography (compose-ai-tools#1934)", () => {
    it("ignores candidate typography the spec doesn't declare", () => {
      // The candidate now resolves fontStyle / variation axes per #1934; a
      // reference that only pins family + size must not flag those extras as drift.
      const spec: DesignTokens = {
        typography: { bodyLarge: { fontFamily: "Orbitron", fontSize: 16 } },
      };
      const candidate: DesignTokens = {
        typography: {
          bodyLarge: {
            fontFamily: "Orbitron",
            fontSize: 16,
            fontStyle: "normal",
            fontVariationSettings: "wght 400.0",
          },
        },
      };
      expect(diffTokens(spec, candidate, defaultDiffConfig)).toEqual([]);
    });

    it("flags a resolved font family that fell back from the spec", () => {
      // The headline #1934 case: the candidate silently rendered a different face
      // than the spec declared — now detectable from the data, not just the eye.
      const spec: DesignTokens = {
        typography: { bodyLarge: { fontFamily: "Orbitron", fontSize: 16 } },
      };
      const candidate: DesignTokens = {
        typography: { bodyLarge: { fontFamily: "sans-serif", fontSize: 16 } },
      };
      const findings = diffTokens(spec, candidate, defaultDiffConfig);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "warn",
        detail: { token: "typography.bodyLarge" },
      });
    });
  });
});
