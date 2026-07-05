/**
 * Staleness gate for the committed canvas-preview evidence.
 *
 * `planToSvg` is deterministic, so the SVGs under `docs/` must equal what the
 * current code produces from the shared `docs/sample-catalog.json` fixture. If a
 * change to the planner / preview / annotations alters the rendered output but
 * the committed SVGs weren't regenerated, this fails — forcing the PR to refresh
 * its visual evidence (`node docs/canvas-preview.mjs`, then re-rasterize the
 * PNGs). This is how plugin UI changes get before/after evidence automatically.
 *
 * Only the deterministic SVGs are gated; the rasterized PNGs (Chrome-rendered,
 * not byte-reproducible across environments) are refreshed locally alongside.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { CatalogManifest } from "@design-parity/catalog-export";
import type { DesignTokens } from "@design-parity/core";
import { describe, expect, it } from "vitest";

import { buildImportPlan } from "../src/plan.js";
import { planToSvg } from "../src/preview.js";

function docsFile(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../docs/${name}`, import.meta.url)), "utf8");
}

const sample = JSON.parse(docsFile("sample-catalog.json")) as {
  manifest: CatalogManifest;
  themeTokens: DesignTokens;
};

const REGEN = "node packages/figma-plugin/docs/canvas-preview.mjs (after npm run build), then re-rasterize the PNGs";

describe("committed canvas-preview evidence is current", () => {
  it("docs/canvas-preview.svg matches the ideal variant", () => {
    const svg = planToSvg(
      buildImportPlan(sample.manifest, {
        baseUrl: "https://x",
        themeTokens: sample.themeTokens,
      }),
    );
    expect(svg, `docs/canvas-preview.svg is stale — regenerate: ${REGEN}`).toBe(
      docsFile("canvas-preview.svg"),
    );
  });

  it("docs/canvas-preview-layout.svg matches the layout variant", () => {
    const svg = planToSvg(
      buildImportPlan(sample.manifest, {
        baseUrl: "https://x",
        themeTokens: sample.themeTokens,
        variant: "layout",
      }),
    );
    expect(
      svg,
      `docs/canvas-preview-layout.svg is stale — regenerate: ${REGEN}`,
    ).toBe(docsFile("canvas-preview-layout.svg"));
  });
});
