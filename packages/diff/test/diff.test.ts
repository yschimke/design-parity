import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

import type { CandidateRender, DesignReference } from "@design-parity/core";

import { diff } from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(resolve(repoRoot, p), "utf8")) as T;
}

const loadPair = async () => {
  const reference = await readJson<DesignReference>(
    "fixtures/figma/button-primary.reference.json",
  );
  const candidate = await readJson<CandidateRender>(
    "fixtures/candidate/button-primary.candidate.json",
  );
  // The candidate's resolved theme (the compose theme behind the render); the
  // design-system audit compares it against the reference's Variables palette.
  candidate.semantics.themeTokens = {
    colors: { "container.light": "#645AFF", "container.dark": "#7A72F0" },
  };
  return { reference, candidate };
};

describe("diff engine on the figma button fixtures", () => {
  it("fails the verdict and shares the componentId", async () => {
    const { reference, candidate } = await loadPair();
    const { verdict } = await diff(reference, candidate, { repoRoot });

    expect(verdict.componentId).toBe("ui/Button.kt#PrimaryButton");
    expect(verdict.status).toBe("fail");
  });

  it("reports the start-padding token violation (12 vs spec 16)", async () => {
    const { reference, candidate } = await loadPair();
    const { verdict } = await diff(reference, candidate, { repoRoot });

    const padding = verdict.findings.find(
      (f) => f.kind === "token" && f.detail?.token === "spacing.paddingStart",
    );
    expect(padding).toBeDefined();
    expect(padding!.severity).toBe("error");
    expect(padding!.detail).toMatchObject({ expected: 16, actual: 12, delta: 4 });
  });

  it("reports the dark-theme contrast failure (WCAG AA), via @design-parity/checks", async () => {
    const { reference, candidate } = await loadPair();
    const { verdict } = await diff(reference, candidate, { repoRoot });

    // the dark drift is the only AA *failure*; light passes AA (an info note).
    const failures = verdict.findings.filter(
      (f) => f.kind === "contrast" && f.severity === "error",
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]!.detail).toMatchObject({ theme: "dark", required: 4.5 });
    expect(failures[0]!.detail!.ratio as number).toBeLessThan(4.5);
  });

  it("flags the drifted dark container colour via the design-system audit", async () => {
    const { reference, candidate } = await loadPair();
    const { verdict } = await diff(reference, candidate, { repoRoot });

    const color = verdict.findings.find(
      (f) => f.kind === "token" && f.detail?.scope === "design-system",
    );
    expect(color).toBeDefined();
    expect(color!.severity).toBe("warn");
    expect(color!.detail).toMatchObject({
      token: "colors.container",
      mode: "dark",
      expected: "#8A82FF",
      actual: "#7A72F0",
    });
  });

  it("scores light theme as identical and dark theme as differing", async () => {
    const { reference, candidate } = await loadPair();
    const { verdict } = await diff(reference, candidate, { repoRoot });

    expect(verdict.visualScores?.["default/light/compact"]).toBe(0);
    expect(verdict.visualScores?.["default/dark/compact"]).toBeGreaterThan(0);
  });

  it("leads the findings with a11y, then tokens, then visual", async () => {
    const { reference, candidate } = await loadPair();
    const { verdict } = await diff(reference, candidate, { repoRoot });

    const order = verdict.findings.map((f) => f.kind);
    const firstToken = order.indexOf("token");
    const firstVisual = order.indexOf("visual");
    expect(order[0]).toBe("contrast");
    expect(firstToken).toBeGreaterThan(0);
    expect(firstVisual).toBeGreaterThan(firstToken);
  });

  it("emits a triptych PNG per image pair", async () => {
    const { reference, candidate } = await loadPair();
    const { triptychs } = await diff(reference, candidate, { repoRoot });

    expect(triptychs.map((t) => t.key).sort()).toEqual([
      "default/dark/compact",
      "default/light/compact",
    ]);
    for (const t of triptychs) {
      // PNG magic number.
      expect(t.png.subarray(0, 4).toString("hex")).toBe("89504e47");
    }
  });

  it("is deterministic: same input → byte-identical verdict and triptychs", async () => {
    const { reference, candidate } = await loadPair();
    const a = await diff(reference, candidate, { repoRoot });
    const b = await diff(reference, candidate, { repoRoot });

    expect(JSON.stringify(a.verdict)).toBe(JSON.stringify(b.verdict));
    expect(a.summary).toBe(b.summary);
    for (let i = 0; i < a.triptychs.length; i++) {
      expect(a.triptychs[i]!.png.equals(b.triptychs[i]!.png)).toBe(true);
    }
  });

  it("renders a markdown summary that names the failures", async () => {
    const { reference, candidate } = await loadPair();
    const { summary } = await diff(reference, candidate, { repoRoot });

    expect(summary).toContain("❌ fail");
    expect(summary).toContain("Accessibility & i18n");
    expect(summary).toContain("Token compliance");
    expect(summary).toContain("spacing.padding");
  });
});

describe("diff engine wires the structural layout diff", () => {
  const reference: DesignReference = {
    componentId: "ui/Tile.kt#Tile",
    source: "claude-design",
    linkMethod: "manifest",
    referenceImages: [],
    // Captured at 411dp; the title sits 16dp from the top.
    layout: {
      root: {
        bounds: { x: 0, y: 0, width: 411, height: 200 },
        children: [{ label: "Title", bounds: { x: 16, y: 16, width: 100, height: 24 } }],
      },
    },
  };
  // Candidate rendered at 2× density (822px frame); the title is 24dp too low.
  const candidate: CandidateRender = {
    componentId: "ui/Tile.kt#Tile",
    images: [],
    semantics: {
      root: {
        bounds: { x: 0, y: 0, width: 822, height: 400 },
        children: [{ label: "Title", bounds: { x: 32, y: 80, width: 200, height: 48 } }],
      },
    },
  };

  it("raises a density-normalised layout finding and renders it under Layout", async () => {
    const { verdict, summary } = await diff(reference, candidate, { repoRoot });

    const layout = verdict.findings.find((f) => f.kind === "layout");
    expect(layout).toBeDefined();
    // 822→411 halves the candidate: title at y=80px ⇒ 40dp, vs ref 16dp ⇒ dy=-24.
    expect(layout!.severity).toBe("warn");
    expect(layout!.detail).toMatchObject({ label: "Title", dy: -24 });
    expect(summary).toContain("**Layout**");
  });

  it("is a no-op when the reference has no captured layout", async () => {
    const noLayout: DesignReference = { ...reference, layout: undefined };
    const { verdict } = await diff(noLayout, candidate, { repoRoot });
    expect(verdict.findings.some((f) => f.kind === "layout")).toBe(false);
  });
});

describe("diff engine corroborates a glyph-set inset against the reference (#371)", () => {
  // wear-m3-catalog's `SwipeToReveal/Card`, both sides, reduced to the geometry
  // that decides it. The kit frame's own children establish a uniform 12 with
  // boxes; the candidate draws 12 around its only child, which is its label.
  const reference: DesignReference = {
    componentId: "sections/SwipeToReveal.kt#SwipeToRevealCard",
    source: "figma",
    linkMethod: "manifest",
    referenceImages: [],
    tokens: { spacing: { padding: 12 } },
    // Flat, as `layoutFromNode` delivers it — the containment the measurement
    // needs is in the boxes, not in the tree.
    layout: {
      root: {
        bounds: { x: 0, y: 0, width: 192, height: 104 },
        children: [
          { label: "Section", role: "frame", bounds: { x: 12, y: 12, width: 168, height: 18 } },
          { label: "Section", role: "frame", bounds: { x: 12, y: 36, width: 168, height: 56 } },
          { label: "Title", bounds: { x: 12, y: 36, width: 168, height: 18 } },
        ],
      },
    },
  };
  const candidate: CandidateRender = {
    componentId: "sections/SwipeToReveal.kt#SwipeToRevealCard",
    images: [],
    semantics: {
      root: {
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
      },
    },
  };

  const padding = (findings: { kind: string; message: string }[]) =>
    findings.filter((f) => f.kind === "token" && f.message.startsWith("spacing.padding"));

  it("does not fail a card that renders exactly the inset the kit specs", async () => {
    const { verdict } = await diff(reference, candidate, { repoRoot });
    expect(padding(verdict.findings).some((f) => f.severity === "error")).toBe(false);
  });

  it("is the reference geometry doing the work, not the spec value", async () => {
    // Guard the guard. Take the capture away and the glyph rule discards the
    // same true measurement again — which is the 0.1.56 board, `0 vs spec 12`.
    const noLayout: DesignReference = { ...reference, layout: undefined };
    const { verdict } = await diff(noLayout, candidate, { repoRoot });
    expect(padding(verdict.findings)).toContainEqual(
      expect.objectContaining({
        severity: "error",
        message: "spacing.padding: 0 vs spec 12 (Δ12)",
      }),
    );
  });
});

describe("diff engine reads a scaled reference capture in the unit it states", () => {
  // The same card captured on a 3× board: every box is three times the dp it
  // represents.
  const scaled = (boundsDensity?: number): DesignReference => ({
    componentId: "sections/SwipeToReveal.kt#SwipeToRevealCard",
    source: "figma",
    linkMethod: "manifest",
    referenceImages: [],
    tokens: { spacing: { padding: 12 } },
    layout: {
      ...(boundsDensity === undefined ? {} : { boundsDensity }),
      root: {
        bounds: { x: 0, y: 0, width: 576, height: 312 },
        children: [
          { label: "Section", role: "frame", bounds: { x: 36, y: 36, width: 504, height: 54 } },
          { label: "Section", role: "frame", bounds: { x: 36, y: 108, width: 504, height: 168 } },
        ],
      },
    },
  });
  const candidate: CandidateRender = {
    componentId: "sections/SwipeToReveal.kt#SwipeToRevealCard",
    images: [],
    semantics: {
      root: {
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
      },
    },
  };
  const padding = (findings: { kind: string; message: string; severity: string }[]) =>
    findings.filter((f) => f.kind === "token" && f.message.startsWith("spacing.padding"));

  it("corroborates through a stated density", async () => {
    const { verdict } = await diff(scaled(3), candidate, { repoRoot });
    expect(padding(verdict.findings).some((f) => f.severity === "error")).toBe(false);
  });

  it("takes an unstated one at face value rather than inferring it", async () => {
    // The documented reading of an absent `boundsDensity`: bounds and tokens
    // already share a space. So the kit's 36 is a 36, it corroborates nothing,
    // and the glyph-set 12 stays dropped. That is a real gap for a board whose
    // density never reached the adapter — and the alternative is worse. The
    // frame-width ratio cannot tell a 2× capture from a reference deliberately
    // drawn at twice the candidate's logical width, and halving a true 12 into a
    // 6 is the confident wrong number this predicate exists to stop.
    const { verdict } = await diff(scaled(), candidate, { repoRoot });
    expect(padding(verdict.findings)).toContainEqual(
      expect.objectContaining({
        severity: "error",
        message: "spacing.padding: 0 vs spec 12 (Δ12)",
      }),
    );
  });
});
