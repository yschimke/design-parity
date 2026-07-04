import type { CatalogManifest } from "@design-parity/catalog-export";
import type { DesignTokens } from "@design-parity/core";
import { describe, expect, it } from "vitest";

import { buildImportPlan } from "../src/plan.js";
import { planToSvg } from "../src/preview.js";

const manifest: CatalogManifest = {
  schema: "design-parity-catalog/v1",
  system: "compose-m3",
  title: "Compose Material 3",
  components: [
    {
      componentId: "Button/Filled",
      group: "Buttons",
      images: [
        { variant: "ideal", path: "images/btn/ideal.png", state: "default", width: 200, height: 80 },
      ],
      greenlines: [
        {
          kind: "a11y",
          severity: "error",
          message: "Contrast 2.1:1 fails AA",
          bounds: { x: 10, y: 10, width: 180, height: 60 },
        },
      ],
      redlines: [],
    },
  ],
};

const tokens: DesignTokens = {
  colors: { primary: "#6750A4", "surface.light": "#FFFBFE", "surface.dark": "#1C1B1F" },
  radius: { medium: 12 },
};

describe("planToSvg", () => {
  it("renders a valid, self-contained SVG with title, group, and dimensions", () => {
    const svg = planToSvg(buildImportPlan(manifest, { baseUrl: "https://x", themeTokens: tokens }));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("xmlns='http://www.w3.org/2000/svg'");
    expect(svg).toContain("Compose Material 3");
    expect(svg).toContain("Buttons");
    expect(svg).toContain("200×80");
  });

  it("draws greenline overlays in the error colour and their captions", () => {
    const svg = planToSvg(buildImportPlan(manifest, { baseUrl: "https://x" }));
    expect(svg).toContain("#cf222e"); // error severity colour
    expect(svg).toContain("Contrast 2.1:1 fails AA");
  });

  it("draws a swatch for each colour variable when a collection is present", () => {
    const svg = planToSvg(buildImportPlan(manifest, { baseUrl: "https://x", themeTokens: tokens }));
    expect(svg).toContain("fill='#6750A4'");
  });

  it("draws redline overlays and their spacing spec for the layout variant", () => {
    const layoutManifest: CatalogManifest = {
      ...manifest,
      components: [
        {
          ...manifest.components[0]!,
          images: [
            { variant: "layout", path: "images/btn/layout.png", state: "default", width: 200, height: 80 },
          ],
          redlines: [
            {
              role: "Row",
              bounds: { x: 4, y: 4, width: 192, height: 72 },
              padding: { top: 12, end: 16, bottom: 12, start: 16 },
              gap: 8,
              cornerRadius: 8,
            },
          ],
        },
      ],
    };
    const svg = planToSvg(buildImportPlan(layoutManifest, { baseUrl: "https://x", variant: "layout" }));
    expect(svg).toContain("#0969da"); // redline accent
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("Row · pad 12/16/12/16 · gap 8 · r 8");
  });

  it("escapes XML-significant characters in labels", () => {
    const evil: CatalogManifest = {
      ...manifest,
      title: "A & B <C>",
      components: [{ ...manifest.components[0]!, greenlines: [] }],
    };
    const svg = planToSvg(buildImportPlan(evil, { baseUrl: "https://x" }));
    expect(svg).toContain("A &amp; B &lt;C&gt;");
    expect(svg).not.toContain("<C>");
  });
});
