import { describe, it, expect } from "vitest";

import type { DesignTokens, SemanticNode, SemanticTree } from "@design-parity/core";

import { defaultDiffConfig } from "../src/config.js";
import {
  collectDerivedInsets,
  collectRadiusBoxes,
  collectTokens,
  diffTokens,
  referenceInsets,
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

    it("keeps a fractional inset for a project that tightened its tolerance", () => {
      // A 1px inset at density 2 is a real 0.5dp one, and a project running the
      // documented strict `spacingTolerance: 0` may genuinely spec `padding:
      // 0.5`. A blanket 1dp floor threw that evidence away and failed it on the
      // declared 0 — so the floor follows the tolerance.
      const flushish: SemanticNode = {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        tokens: { spacing: { padding: 0 } },
        children: [{ bounds: { x: 1, y: 1, width: 98, height: 98 } }],
      };
      expect(collectDerivedInsets(flushish, 2, 1)).toEqual([]);
      expect(collectDerivedInsets(flushish, 2, 0).map((i) => i.inset)).toEqual([0.5]);

      const strict = { ...defaultDiffConfig, spacingTolerance: 0 };
      const findings = diffTokens(
        { spacing: { padding: 0.5 } },
        { spacing: { padding: 0 } },
        strict,
        undefined,
        undefined,
        collectDerivedInsets(flushish, 2, Math.min(1, strict.spacingTolerance)),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "info",
        detail: { via: "measured-geometry", actual: 0.5 },
      });
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

    // wear-m3-catalog's `TextToggle`: `TextToggleButton` sized by
    // `touchTargetAwareSize` with a bare `Text` inside and no padding modifier
    // anywhere. The gap between the button edge and the text box is the string's
    // advance and line height, not an inset the code chose.
    const textButton = (): SemanticNode => ({
      role: "button",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      children: [
        {
          role: "text",
          label: "A",
          bounds: { x: 20, y: 20, width: 60, height: 60 },
          tokens: { typography: { label: { fontSize: 14 } } },
        },
      ],
    });

    it("does not measure an inset off a text child (#367)", () => {
      // Guard the guard: the geometry IS uniform and well clear of the floor, so
      // the fixture exercises the case — `measure` proves the only thing
      // stopping it is the glyph rule.
      expect(collectDerivedInsets(textButton(), 1, 1, "measure").map((i) => i.inset)).toEqual(
        [20],
      );
      expect(collectDerivedInsets(textButton())).toEqual([]);
    });

    it("falls back to 'not evaluated' rather than quoting a glyph as padding (#367)", () => {
      // The picker shape: the candidate declares no padding at all, and before
      // the glyph rule the text geometry answered for it — `renders 20 vs spec
      // 14 (Δ6)`, a confident-looking number about the font.
      const measured = diffTokens(
        { spacing: { padding: 14 } },
        {},
        defaultDiffConfig,
        undefined,
        undefined,
        collectDerivedInsets(textButton(), 1, 1, "measure"),
      );
      expect(measured[0]).toMatchObject({
        severity: "error",
        message: "spacing.padding: renders 20 vs spec 14 (Δ6)",
      });

      const findings = diffTokens(
        { spacing: { padding: 14 } },
        {},
        defaultDiffConfig,
        undefined,
        undefined,
        collectDerivedInsets(textButton()),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: "info", detail: { unverified: true } });
    });

    it("keeps an inset a box establishes even where a glyph shares the edge", () => {
      // The icon establishes all four extremes on its own; the label's top
      // happens to line up with it. Suppressing on "some text touches an
      // extreme" would throw away a real 12dp inset over a coincidence — where
      // a box agrees with the glyph, the number it gives is the same number.
      const shared: SemanticNode = {
        role: "button",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [
          { role: "image", bounds: { x: 12, y: 12, width: 76, height: 76 } },
          { role: "text", bounds: { x: 12, y: 12, width: 40, height: 20 } },
        ],
      };
      expect(collectDerivedInsets(shared).map((i) => i.inset)).toEqual([12]);

      // ...but an extreme NOTHING but text reaches is still dropped: push the
      // label a dp past the icon's left and that edge is font metrics.
      const glyphLeads: SemanticNode = {
        role: "button",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [
          { role: "image", bounds: { x: 12, y: 12, width: 76, height: 76 } },
          { role: "text", bounds: { x: 11, y: 12, width: 40, height: 20 } },
        ],
      };
      expect(collectDerivedInsets(glyphLeads)).toEqual([]);
    });

    it("still measures when a box sets the edges and text sits inside them", () => {
      // The rule is about which child SET the measurement, not whether any text
      // is present — an icon+label row insetting its icon to the container edge
      // is still evidence of padding, and dropping it would give back #364's win.
      const row: SemanticNode = {
        role: "button",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        tokens: { spacing: { padding: 0 } },
        children: [
          { role: "image", bounds: { x: 12, y: 12, width: 76, height: 76 } },
          { role: "text", bounds: { x: 30, y: 40, width: 40, height: 20 } },
        ],
      };
      expect(collectDerivedInsets(row).map((i) => i.inset)).toEqual([12]);
    });

    it("does not let a themed container count as a glyph", () => {
      // A row that resolves typography for its children still has a layout box
      // of its own; only a leaf that draws glyphs is font-shaped.
      const themed: SemanticNode = {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [
          {
            bounds: { x: 16, y: 16, width: 68, height: 68 },
            tokens: { typography: { body: { fontSize: 14 } } },
            children: [{ role: "image", bounds: { x: 20, y: 20, width: 60, height: 60 } }],
          },
        ],
      };
      expect(collectDerivedInsets(themed).map((i) => i.inset)).toContain(16);
    });

    // ---- #371: a glyph-set edge may be corroborated by the reference ----------
    //
    // The pair below is deliberately a pair, and neither half means anything
    // without the other: #367's fixture must stay dropped and #371's must be
    // measured, from geometry that is the SAME SHAPE — one container, one text
    // child, a uniform inset on all four edges. Any rule that reads only the
    // candidate's tree has to give both the same answer, which is why the third
    // boundary bug in this predicate could not be fixed by moving a threshold.
    // What separates them is on the other side.

    /**
     * The kit's `SwipeToReveal/Card` (`56392:155753`), as the Figma adapter
     * delivers it: **flat** — every descendant a direct child of the capture
     * frame, root-relative. The card's own inset is not in this tree; it is in
     * the boxes, and recovering it is `referenceInsets`' job.
     */
    const kitCard = (): SemanticTree => ({
      root: {
        bounds: { x: 0, y: 0, width: 192, height: 192 },
        children: [
          { label: "Card", role: "instance", bounds: { x: -80, y: 44, width: 192, height: 104 } },
          {
            label: "CardButton",
            role: "instance",
            bounds: { x: 116, y: 54, width: 64, height: 84 },
          },
          { label: "Section", role: "frame", bounds: { x: -68, y: 56, width: 168, height: 18 } },
          {
            label: "Avatar-Icon",
            role: "instance",
            bounds: { x: -68, y: 56, width: 18, height: 18 },
          },
          { label: "Slot Label", role: "frame", bounds: { x: -46, y: 57, width: 111, height: 16 } },
          { label: "App label", bounds: { x: -46, y: 57, width: 111, height: 16 } },
          { label: "Slot Time", role: "frame", bounds: { x: 57, y: 57, width: 31, height: 16 } },
          { label: "Timestamp", bounds: { x: 57, y: 57, width: 31, height: 16 } },
          { label: "Section", role: "frame", bounds: { x: -68, y: 80, width: 168, height: 56 } },
          { label: "Slot Title", role: "frame", bounds: { x: -68, y: 80, width: 168, height: 18 } },
          { label: "Title", bounds: { x: -68, y: 80, width: 168, height: 18 } },
          { label: "Slot Body", role: "frame", bounds: { x: -68, y: 100, width: 168, height: 36 } },
          { label: "Body text", bounds: { x: -68, y: 100, width: 168, height: 36 } },
        ],
      },
    });

    /**
     * The kit's `TextToggleButton` (`39083:767`), same shape of capture. Its
     * text sits 1 from the sides and 16 from the top and bottom — the frame is
     * sized by the touch target and the string is centred in it, which is the
     * artwork saying, on its own side, that there is no uniform inset here.
     */
    const kitTextToggle = (): SemanticTree => ({
      root: {
        bounds: { x: 0, y: 0, width: 52, height: 52 },
        children: [
          { label: "visual-layer", role: "frame", bounds: { x: 0, y: 1, width: 52, height: 50 } },
          { label: "A", bounds: { x: 1, y: 17, width: 50, height: 18 } },
        ],
      },
    });

    /** wear-m3-catalog's `SwipeToRevealCard`: `Card(onClick = {}) { Text(…) }`. */
    const cardWithLabel = (): SemanticNode => ({
      role: "card",
      bounds: { x: 0, y: 0, width: 192, height: 104 },
      tokens: { spacing: { padding: 0 } },
      children: [
        {
          role: "text",
          label: "Card content",
          bounds: { x: 12, y: 12, width: 168, height: 80 },
          tokens: { typography: { body: { fontSize: 14 } } },
        },
      ],
    });

    it("recovers a container's inset from a FLAT reference layout (#371)", () => {
      // Guard the guard: the fixture has to actually be flat, or this proves
      // nothing about the tree the Figma adapter really hands over.
      const flat = kitCard();
      expect(flat.root.children!.every((c) => (c.children ?? []).length === 0)).toBe(true);

      // Nested back by containment, the card's two Sections establish a uniform
      // 12 with no glyph involved — the fact the candidate's label agrees with.
      expect(referenceInsets(flat)).toEqual([12]);
    });

    it("offers nothing to corroborate where the kit itself has no uniform inset", () => {
      // 1 at the sides, 16 top and bottom. Not an inset — the reference side
      // saying the same thing about `TextToggleButton` the candidate side does.
      expect(referenceInsets(kitTextToggle())).toEqual([]);
    });

    it("will not corroborate with an inset the reference's own GLYPHS set", () => {
      // Otherwise two fonts agreeing would read as a layout. The reference is
      // measured by the same rule it is being used to relax, so a text-set
      // extreme is no more evidence there than here.
      const glyphKit: SemanticTree = {
        root: {
          bounds: { x: 0, y: 0, width: 200, height: 200 },
          children: [
            { label: "Frame", role: "frame", bounds: { x: 0, y: 0, width: 100, height: 100 } },
            {
              label: "Label",
              bounds: { x: 12, y: 12, width: 76, height: 76 },
              tokens: { typography: { body: { fontSize: 14 } } },
            },
          ],
        },
      };
      expect(referenceInsets(glyphKit)).toEqual([]);
    });

    it("keeps a glyph-set inset the reference independently measures (#371)", () => {
      // The mirror image of #367: `SwipeToRevealCard` draws exactly the 12 the
      // kit specs, and went warn → fail on a CLI upgrade alone. Without the
      // reference the tree is indistinguishable from `textButton()` — with it,
      // the kit's own boxes say 12.
      expect(collectDerivedInsets(cardWithLabel())).toEqual([]);
      expect(
        collectDerivedInsets(cardWithLabel(), 1, 1, "skip", {
          layout: kitCard(),
          tolerance: defaultDiffConfig.spacingTolerance,
        }).map((i) => i.inset),
      ).toEqual([12]);
    });

    it("still drops #367's glyph inset against the same corroboration", () => {
      // Same call, same reference values, opposite answer — the half of the pair
      // that stops a future tightening trading one bug for the other. 20 is not
      // 12, and `textButton()`'s own kit (above) measures nothing at all.
      for (const layout of [kitCard(), kitTextToggle()]) {
        expect(
          collectDerivedInsets(textButton(), 1, 1, "skip", {
            layout,
            tolerance: defaultDiffConfig.spacingTolerance,
          }),
        ).toEqual([]);
      }
    });

    it("clears the false red the glyph rule put on a card that renders to spec", () => {
      // End to end, the two boards from the issue: `error 0 vs spec 12 (Δ12)` on
      // 0.1.56, against a render that insets exactly 12.
      const spec: DesignTokens = { spacing: { padding: 12 } };
      const uncorroborated = diffTokens(
        spec,
        { spacing: { padding: 0 } },
        defaultDiffConfig,
        undefined,
        undefined,
        collectDerivedInsets(cardWithLabel()),
      );
      expect(uncorroborated[0]).toMatchObject({
        severity: "error",
        message: "spacing.padding: 0 vs spec 12 (Δ12)",
      });

      const findings = diffTokens(
        spec,
        { spacing: { padding: 0 } },
        defaultDiffConfig,
        undefined,
        undefined,
        collectDerivedInsets(cardWithLabel(), 1, 1, "skip", {
          layout: kitCard(),
          tolerance: defaultDiffConfig.spacingTolerance,
        }),
      );
      expect(findings.some((f) => f.severity === "error")).toBe(false);
    });

    it("lets corroboration acquit, never convict", () => {
      // The invariant that keeps this from becoming the fourth boundary bug: a
      // glyph-set measurement readmitted by the reference can only ever AGREE
      // with it, so it cannot manufacture a Δ. One that disagrees is not
      // readmitted as a wrong number — it is not readmitted at all.
      const findings = diffTokens(
        { spacing: { padding: 12 } },
        {},
        defaultDiffConfig,
        undefined,
        undefined,
        collectDerivedInsets(textButton(), 1, 1, "skip", {
          layout: kitCard(),
          tolerance: defaultDiffConfig.spacingTolerance,
        }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: "info", detail: { unverified: true } });
    });

    /** A kit that insets 12 somewhere, on a node this spec knows nothing about. */
    const unrelatedKit = (): SemanticTree => ({
      root: {
        bounds: { x: 0, y: 0, width: 300, height: 300 },
        children: [
          { label: "Panel", role: "frame", bounds: { x: 0, y: 0, width: 100, height: 100 } },
          { label: "Fill", role: "rectangle", bounds: { x: 12, y: 12, width: 76, height: 76 } },
        ],
      },
    });

    it("lets a corroborated inset satisfy a spec but never contradict one", () => {
      // The corroborating value is whatever the reference draws SOMEWHERE, not
      // necessarily on the node the spec describes. A candidate that declares no
      // padding and measures a 12dp glyph gap against a `padding: 16` spec must
      // not newly fail on `renders 12 vs spec 16` because something unrelated in
      // the kit insets 12 — that finding was `unverified` before corroboration
      // existed and has to stay that way.
      const drawn = collectDerivedInsets(cardWithLabel(), 1, 1, "skip", {
        layout: unrelatedKit(),
        tolerance: defaultDiffConfig.spacingTolerance,
      });
      expect(drawn).toEqual([
        { inset: 12, declaresSpacing: true, corroborated: true, where: "card" },
      ]);

      const findings = diffTokens(
        { spacing: { padding: 16 } },
        {},
        defaultDiffConfig,
        undefined,
        undefined,
        drawn,
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: "info", detail: { unverified: true } });
    });

    it("re-decides from scratch when the corroborated inset steps aside", () => {
      // `nearestInset` is TIERED: it answers from the declaring containers alone
      // when there are any. So dropping a corroborated declaring container does
      // not just pick the next-nearest — it can fall through to a whole other
      // tier, whose value may SATISFY the spec. Reporting the fallback without
      // re-testing it emitted `renders 16 vs spec 16 (Δ0)`, a blocking error
      // whose own delta says there is nothing wrong.
      const findings = diffTokens(
        { spacing: { padding: 16 } },
        {},
        defaultDiffConfig,
        undefined,
        undefined,
        [
          { inset: 40, declaresSpacing: true, corroborated: true, where: "card" },
          { inset: 16, declaresSpacing: false, where: "inner" },
        ],
      );
      expect(findings.some((f) => f.severity === "error")).toBe(false);
      // Exactly what the same insets say with the corroborated one absent: a
      // readmitted measurement is transparent, except that it may also acquit.
      expect(findings).toEqual(
        diffTokens({ spacing: { padding: 16 } }, {}, defaultDiffConfig, undefined, undefined, [
          { inset: 16, declaresSpacing: false, where: "inner" },
        ]),
      );
    });

    it("steps aside one corroborated inset, not all of them", () => {
      // Another readmitted measurement may still answer the spec — that IS the
      // invariant. Dropping the whole class to get past the declaring
      // container's miss took the acquitting 16 down with the 40 and fell
      // through to the declared value, which on a design-led run blocks.
      const findings = diffTokens(
        { spacing: { padding: 16 } },
        {},
        defaultDiffConfig,
        undefined,
        undefined,
        [
          { inset: 40, declaresSpacing: true, corroborated: true, where: "card" },
          { inset: 16, declaresSpacing: false, corroborated: true, where: "inner" },
        ],
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "info",
        detail: { via: "measured-geometry", actual: 16 },
      });
    });

    it("still convicts on a missed inset the candidate's own BOXES establish", () => {
      // Guard the guard: the clause above must not have switched off #364's
      // point. An inset no glyph decided is evidence either way, and one that
      // misses is still the error a designer can act on.
      const boxed: SemanticNode = {
        role: "button",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [{ role: "image", bounds: { x: 12, y: 12, width: 76, height: 76 } }],
      };
      const drawn = collectDerivedInsets(boxed);
      expect(drawn[0]!.corroborated).toBeUndefined();

      const findings = diffTokens(
        { spacing: { padding: 16 } },
        {},
        defaultDiffConfig,
        undefined,
        undefined,
        drawn,
      );
      expect(findings[0]).toMatchObject({
        severity: "error",
        message: "spacing.padding: renders 12 vs spec 16 (Δ4)",
      });
    });

    it("takes a reference's own nesting over what the rectangles imply", () => {
      // A backdrop encloses the control drawn on top of it without being its
      // parent. Rebuilding ancestry from enclosure alone would file the control
      // under the backdrop's own child and measure a 14 the artwork never
      // establishes — which, being a corroborating value, could then suppress a
      // real mismatch. A tree that states its hierarchy is taken at its word.
      const composed: SemanticTree = {
        root: {
          bounds: { x: 0, y: 0, width: 300, height: 300 },
          children: [
            {
              label: "Backdrop",
              role: "frame",
              bounds: { x: 0, y: 0, width: 200, height: 200 },
              children: [
                {
                  label: "Grain",
                  role: "rectangle",
                  bounds: { x: 10, y: 10, width: 180, height: 180 },
                },
              ],
            },
            { label: "Control", role: "frame", bounds: { x: 24, y: 24, width: 152, height: 152 } },
          ],
        },
      };
      // Guard the guard: this fixture only tests anything while it IS nested.
      expect(composed.root.children![0]!.children).toHaveLength(1);
      expect(referenceInsets(composed)).toEqual([10]);
    });

    it("measures THROUGH an unbounded group between two boxes", () => {
      // `Card → Group(no bounds) → Body`. The tree states this containment, so
      // it is not rebuilt — but the measurement only ever looked at directly
      // bounded children, so the group sat between the card and its content and
      // the 12 went unmeasured. An unbounded node is a pass-through, not a
      // boundary.
      const throughGroup: SemanticTree = {
        root: {
          bounds: { x: 0, y: 0, width: 400, height: 400 },
          children: [
            {
              label: "Card",
              role: "frame",
              bounds: { x: 0, y: 0, width: 100, height: 100 },
              children: [
                {
                  label: "Group",
                  children: [
                    {
                      label: "Body",
                      role: "frame",
                      bounds: { x: 12, y: 12, width: 76, height: 76 },
                    },
                  ],
                },
              ],
            },
          ],
        },
      };
      // Guard the guard: the group must be unbounded and BETWEEN the two boxes.
      const card = throughGroup.root.children![0]!;
      expect(card.bounds).toBeDefined();
      expect(card.children![0]!.bounds).toBeUndefined();
      expect(card.children![0]!.children![0]!.bounds).toBeDefined();

      expect(referenceInsets(throughGroup)).toEqual([12]);
    });

    it("keeps boxes that sit under an UNBOUNDED group", () => {
      // A grouping node with no box of its own is not a container this can
      // measure, but the boxes beneath it are still geometry. Reading the group
      // as a leaf calls a nested tree flat and then drops its whole subtree at
      // the rebuild, so a capture whose real content hangs off one corroborates
      // nothing at all.
      const grouped: SemanticTree = {
        root: {
          bounds: { x: 0, y: 0, width: 400, height: 400 },
          children: [
            {
              label: "Layers",
              children: [
                {
                  label: "Card",
                  role: "frame",
                  bounds: { x: 0, y: 0, width: 100, height: 100 },
                  children: [
                    {
                      label: "Body",
                      role: "frame",
                      bounds: { x: 12, y: 12, width: 76, height: 76 },
                    },
                  ],
                },
              ],
            },
          ],
        },
      };
      // Guard the guard: the group must really be unbounded, and the geometry
      // must really be below it.
      expect(grouped.root.children![0]!.bounds).toBeUndefined();
      expect(referenceInsets(grouped)).toEqual([12]);
    });

    it("nests a child its parent's rounding pushed it outside of", () => {
      // `layoutFromNode` rounds every box independently, so a child genuinely
      // inside its parent can come back overhanging it by a pixel. Read
      // strictly, that child is promoted to the grandparent, joins ITS union,
      // and the 12 the grandparent actually insets is lost to an 11.
      const rounded: SemanticTree = {
        root: {
          bounds: { x: 0, y: 0, width: 400, height: 400 },
          children: [
            { label: "Card", role: "frame", bounds: { x: 12, y: 12, width: 176, height: 176 } },
            // 11..189 against the card's 12..188 — one pixel proud on each side.
            { label: "Content", role: "frame", bounds: { x: 11, y: 20, width: 178, height: 150 } },
            { label: "Frame", role: "frame", bounds: { x: 0, y: 0, width: 200, height: 200 } },
          ],
        },
      };
      expect(referenceInsets(rounded)).toContain(12);
    });

    it("does not measure the reference unless a glyph-set extreme asks", () => {
      // Rebuilding containment over a screen capture's descendants is a sort
      // plus an enclosure scan, and most diffs never consult the result: no
      // padding spec, no text-edged container, or no captured geometry at all.
      // A container whose boxes establish their own inset must not pay for it.
      let reads = 0;
      const counted = {
        get root() {
          reads++;
          return kitCard().root;
        },
      } as unknown as SemanticTree;
      const corroborate = { layout: counted, tolerance: defaultDiffConfig.spacingTolerance };

      const boxed: SemanticNode = {
        role: "button",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [{ role: "image", bounds: { x: 12, y: 12, width: 76, height: 76 } }],
      };
      expect(collectDerivedInsets(boxed, 1, 1, "skip", corroborate).map((i) => i.inset)).toEqual([
        12,
      ]);
      expect(reads).toBe(0);

      // ...and once it is asked, it is measured once for the whole tree.
      const twoGlyphs: SemanticNode = {
        bounds: { x: 0, y: 0, width: 400, height: 400 },
        children: [
          cardWithLabel(),
          { ...cardWithLabel(), bounds: { x: 0, y: 200, width: 192, height: 104 } },
        ],
      };
      collectDerivedInsets(twoGlyphs, 1, 1, "skip", corroborate);
      expect(reads).toBe(1);
    });

    it("does not let the glyph rule silence a numeric the candidate CAN report", () => {
      // `textDerivedInsets` decides what geometry may answer, never what a
      // declared value says: a candidate that reports `padding: 8` against a
      // spec of 1 is still a hard error.
      const findings = diffTokens(
        { spacing: { padding: 1 } },
        { spacing: { padding: 8 } },
        defaultDiffConfig,
        undefined,
        undefined,
        collectDerivedInsets(textButton()),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "error",
        message: "spacing.padding: 8 vs spec 1 (Δ7)",
      });
    });

    it("does not let the advisory swallow an inset the geometry DOES answer", () => {
      // #368 softens the token the candidate cannot report; it must not reach
      // the case where the render measures a wrong inset, which is #364's whole
      // point — that error still blocks.
      const iconMiss = diffTokens(
        { spacing: { padding: 12 } },
        {},
        defaultDiffConfig,
        undefined,
        undefined,
        collectDerivedInsets(iconButton(48), 2),
      );
      expect(iconMiss).toHaveLength(1);
      expect(iconMiss[0]).toMatchObject({ severity: "error", detail: { actual: 14 } });
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

    it("requires every edge to be a positive inset, not just the first", () => {
      // `[0.5, 0, 0.5, 0]` averaged to "a 0.5dp inset" under a 0.5dp uniformity
      // allowance — reporting padding on a child flush against top and bottom.
      // At a strict tolerance that satisfied `padding: 0.5` outright.
      const sideOnly: SemanticNode = {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [{ bounds: { x: 0.5, y: 0, width: 99, height: 100 } }],
      };
      expect(collectDerivedInsets(sideOnly, 1, 0)).toEqual([]);
      expect(collectDerivedInsets(sideOnly, 1, 1)).toEqual([]);
    });

    it("tightens the uniformity allowance with the floor", () => {
      // The 0.5dp slack that absorbs px→dp rounding at whole-dp resolution is
      // bigger than the values themselves once fractional insets are admitted,
      // so it cannot stay constant: at a strict floor these edges disagree.
      // Edges sit clear of the floor on both runs, so this isolates the
      // uniformity allowance — the floor boundary has its own test below.
      const uneven: SemanticNode = {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [{ bounds: { x: 1.2, y: 1.6, width: 97.6, height: 96.8 } }],
      };
      expect(collectDerivedInsets(uneven, 1, 0)).toEqual([]);
      expect(collectDerivedInsets(uneven, 1, 1).map((i) => i.inset)).toEqual([1.2]);
    });

    it("rejects an inset that survives the floor but rounds away", () => {
      // In (0, 0.005) the raw edges are positive and clear a zero floor, but the
      // reported value rounds to 0 — readmitting through the report exactly what
      // the positive-edge rule rejects at the measurement.
      const sliver: SemanticNode = {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [{ bounds: { x: 0.002, y: 0.002, width: 99.996, height: 99.996 } }],
      };
      expect(collectDerivedInsets(sliver, 1, 0)).toEqual([]);
    });

    it("never admits a zero inset, even with the floor turned all the way down", () => {
      // A strict `spacingTolerance: 0` drives the floor to 0, and an inclusive
      // test would let a child that exactly fills its parent count as an inset
      // of zero — flipping an unverified advisory into a blocking
      // `renders 0 vs spec 14`. A filling child is not evidence of padding at
      // any tolerance.
      const fills: SemanticNode = {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [{ bounds: { x: 0, y: 0, width: 100, height: 100 } }],
      };
      expect(collectDerivedInsets(fills, 1, 0)).toEqual([]);

      const findings = diffTokens(
        { spacing: { padding: 14 } },
        {},
        { ...defaultDiffConfig, spacingTolerance: 0 },
        undefined,
        undefined,
        collectDerivedInsets(fills, 1, 0),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: "info", detail: { unverified: true } });
    });

    it("rejects an inset that only reaches the floor, without clearing it", () => {
      // A project on `spacingTolerance: 0.5` drives the floor to 0.5, and an
      // inclusive test lets a 0.5dp conversion sliver through — a value this
      // comparison cannot tell apart from zero, since |0.5 - 0| is inside its
      // own tolerance. One such measurement makes the spacing group look
      // measurable, so a 14dp spec goes from an unverified advisory to a
      // blocking `renders 0.5 vs spec 14` — the sliver the floor exists to drop.
      const sliver: SemanticNode = {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        children: [{ bounds: { x: 0.5, y: 0.5, width: 99, height: 99 } }],
      };
      expect(collectDerivedInsets(sliver, 1, 0.5)).toEqual([]);
      // Still measured when the comparison is fine enough to mean it.
      expect(collectDerivedInsets(sliver, 1, 0).map((i) => i.inset)).toEqual([0.5]);

      const findings = diffTokens(
        { spacing: { padding: 14 } },
        {},
        { ...defaultDiffConfig, spacingTolerance: 0.5 },
        undefined,
        undefined,
        collectDerivedInsets(sliver, 1, 0.5),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: "info", detail: { unverified: true } });
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

  it("flags an absent token as advisory — numeric and unmappable colour alike (#102, #368)", () => {
    // The candidate resolved *some* radius and colour (so both groups are
    // verifiable), just not the ones the spec names.
    const findings = diffTokens(
      spec,
      { spacing: { padding: 16 }, radius: { other: 20 }, colors: { fg: "#000000" } },
      defaultDiffConfig,
    );
    // Neither is evidence the candidate is wrong: `radius.corner` has no value
    // to compare, and `colors.label` maps to no Material role and didn't
    // value-match. Both are non-blocking notes.
    expect(findings).toHaveLength(2);
    const radius = findings.find((f) => f.detail?.token === "radius.corner");
    const label = findings.find((f) => f.detail?.token === "colors.label");
    expect(radius).toMatchObject({ severity: "info", detail: { unverified: true } });
    expect(label).toMatchObject({ severity: "info", detail: { unmapped: true } });
  });

  it("restores the hard error for an absent numeric under `missingNumerics: strict`", () => {
    const findings = diffTokens(
      spec,
      { spacing: { padding: 16 }, radius: { other: 20 }, colors: { fg: "#000000" } },
      { ...defaultDiffConfig, missingNumerics: "strict" },
    );
    const radius = findings.find((f) => f.detail?.token === "radius.corner");
    expect(radius).toMatchObject({
      severity: "error",
      message: "radius.corner missing from candidate (spec 8)",
    });
    // The colour advisory is untouched by the numeric knob.
    expect(findings.find((f) => f.detail?.token === "colors.label")).toMatchObject({
      severity: "info",
    });
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

  it("reports a numeric token unverified when no candidate value is within tolerance (#1897)", () => {
    // The value match is what stands between "the candidate names this token
    // differently" and "the candidate has no such value"; 4 against a spec of 16
    // is outside the tolerance, so nothing lines up. That is unverifiable, not
    // wrong (#368) — but it must still be *reported*, or a spec token silently
    // goes unchecked.
    const padSpec: DesignTokens = { spacing: { screenPadding: 16 } };
    const findings = diffTokens(
      padSpec,
      { spacing: { padding: 4 } },
      defaultDiffConfig,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "info",
      message: "spacing.screenPadding: candidate resolved no value; unverified (spec 16)",
      detail: { token: "spacing.screenPadding", actual: null, unverified: true },
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
