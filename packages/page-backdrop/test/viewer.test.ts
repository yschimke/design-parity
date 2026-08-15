import { describe, it, expect } from "vitest";

import type { PageBackdropManifest, Placement } from "../src/types.js";
import { renderPageBackdropHtml } from "../src/viewer.js";

const png = (seed: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed]);

const placement = (over: Partial<Placement> = {}): Placement => ({
  nodeId: "2:1",
  name: "Button/Primary",
  bounds: { x: 36, y: 72, width: 180, height: 48 },
  depth: 0,
  code: "ui/Button.kt#PrimaryButton",
  link: "code-connect",
  ...over,
});

const manifest = (placements: Placement[] = [placement()]): PageBackdropManifest => ({
  version: 1,
  source: "figma",
  fileKey: "AbCdEf123456",
  pages: [
    {
      id: "home",
      name: "Home",
      nodeId: "1:2",
      frame: { width: 360, height: 720 },
      image: { uri: "home.png", scale: 2 },
      placements,
    },
  ],
});

const backdrops = new Map([["home", png(1)]]);

/** The same manifest, with the backdrop exported as an addressable SVG. */
const svgManifest = (placements: Placement[] = [placement()]): PageBackdropManifest => {
  const m = manifest(placements);
  m.pages[0]!.image = { uri: "home.svg", scale: 2, format: "svg" };
  return m;
};

const svgBytes = (svg: string) => new Map([["home", new TextEncoder().encode(svg)]]);

const EXPORTED_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 720">` +
  `<g data-node-id="2-1"><rect width="180" height="48"/></g>` +
  `</svg>`;

describe("renderPageBackdropHtml", () => {
  it("inlines the backdrop so the page is self-contained", () => {
    const html = renderPageBackdropHtml({ manifest: manifest(), backdrops });
    expect(html).toContain('<img class="backdrop" src="data:image/png;base64,');
    expect(html).not.toMatch(/src="https?:/);
  });

  it("positions each hotspot as a percentage of the frame", () => {
    // 36/360 = 10%, 72/720 = 10%, 180/360 = 50%, 48/720 = 6.6667%
    const html = renderPageBackdropHtml({ manifest: manifest(), backdrops });
    expect(html).toContain("left:10%;top:10%;width:50%;height:6.6667%");
  });

  it("labels a linked hotspot with its code handle and an unlinked one with its layer name", () => {
    const html = renderPageBackdropHtml({
      manifest: manifest([placement(), placement({ nodeId: "2:2", name: "Mystery", code: undefined, link: "unlinked" })]),
      backdrops,
    });
    expect(html).toContain(">ui/Button.kt#PrimaryButton</span>");
    expect(html).toContain(">Mystery</span>");
    expect(html).toContain('data-link="unlinked"');
  });

  it("keeps the render overlay off by default", () => {
    const html = renderPageBackdropHtml({
      manifest: manifest(),
      backdrops,
      renders: new Map([["ui/Button.kt#PrimaryButton", png(2)]]),
    });
    // The layer exists so the toggle works offline...
    expect(html).toContain('class="spot-render"');
    // ...but nothing switches it on, and opacity starts at zero.
    expect(html).toContain('id="t-overlay"> Show renders on top');
    expect(html).toContain("--overlay-opacity:0");
  });

  it("starts the overlay on only when the config says so", () => {
    const html = renderPageBackdropHtml({
      manifest: manifest(),
      backdrops,
      renders: new Map([["ui/Button.kt#PrimaryButton", png(2)]]),
      overlay: { enabled: true, opacity: 0.75, blend: "difference" },
    });
    expect(html).toContain('id="t-overlay" checked');
    expect(html).toContain('id="t-opacity" min="0" max="100" value="75"');
    expect(html).toContain('<option value="difference" selected>');
  });

  it("omits the overlay layer for a placement with no render", () => {
    const html = renderPageBackdropHtml({ manifest: manifest(), backdrops, renders: new Map() });
    // The CSS rule is always present; what must be absent is the element.
    expect(html).not.toContain('<img class="spot-render"');
  });

  it("inlines a repeated render once, however many placements use it", () => {
    const html = renderPageBackdropHtml({
      manifest: manifest([
        placement({ nodeId: "2:1" }),
        placement({ nodeId: "2:2" }),
        placement({ nodeId: "2:3" }),
      ]),
      backdrops,
      renders: new Map([["ui/Button.kt#PrimaryButton", png(2)]]),
    });
    expect(html.split('class="spot-render"').length - 1).toBe(3);
    // One data URI for the render, one for the backdrop — not one per placement.
    expect(html.split("data:image/png;base64,").length - 1).toBe(4);
  });

  it("links a code handle to its source URL when one is supplied", () => {
    const html = renderPageBackdropHtml({
      manifest: manifest(),
      backdrops,
      sourceUrls: new Map([["ui/Button.kt#PrimaryButton", "https://example.test/Button.kt"]]),
    });
    expect(html).toContain('href="https://example.test/Button.kt"');
  });

  it("counts linked instances in the header", () => {
    const html = renderPageBackdropHtml({
      manifest: manifest([placement(), placement({ nodeId: "2:2", code: undefined, link: "unlinked" })]),
      backdrops,
    });
    expect(html).toContain("1 of 2 component instances linked to code");
  });

  it("shows tabs only when there is more than one page", () => {
    expect(renderPageBackdropHtml({ manifest: manifest(), backdrops })).not.toContain('role="tablist"');

    const two = manifest();
    two.pages.push({ ...two.pages[0]!, id: "settings", name: "Settings" });
    const html = renderPageBackdropHtml({ manifest: two, backdrops });
    expect(html).toContain('role="tablist"');
    expect(html).toContain('data-page="settings"');
  });

  it("escapes names and handles from the design file", () => {
    const html = renderPageBackdropHtml({
      manifest: manifest([placement({ name: '<script>x</script>"', code: undefined, link: "unlinked" })]),
      backdrops,
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;&quot;");
  });

  it("renders without a backdrop image rather than failing", () => {
    const html = renderPageBackdropHtml({ manifest: manifest(), backdrops: new Map() });
    expect(html).toContain("backdrop image not supplied");
  });

  it("is deterministic", () => {
    const once = renderPageBackdropHtml({ manifest: manifest(), backdrops });
    const twice = renderPageBackdropHtml({ manifest: manifest(), backdrops });
    expect(once).toBe(twice);
  });
});

describe("an addressable SVG backdrop", () => {
  const renders = new Map([["ui/Button.kt#PrimaryButton", png(2)]]);

  it("inlines the markup rather than wrapping it in an img", () => {
    // Inside an <img> the export is an opaque box and its ids are unreachable,
    // which is the entire reason to ask for them.
    const html = renderPageBackdropHtml({
      manifest: svgManifest(),
      backdrops: svgBytes(EXPORTED_SVG),
    });
    expect(html).toContain('<div class="backdrop backdrop-svg"><svg');
    expect(html).toContain('data-node-id="2-1"');
    expect(html).not.toContain("data:image/png;base64,iVBO");
  });

  it("cuts the design element out from under a placement that has a render", () => {
    const html = renderPageBackdropHtml({
      manifest: svgManifest(),
      backdrops: svgBytes(EXPORTED_SVG),
      renders,
    });
    expect(html).toContain(
      'body.cut [data-page="home"] [data-node-id="2-1"]{visibility:hidden}',
    );
    expect(html).toContain('id="t-cut"');
  });

  it("cuts nothing for a placement with no render", () => {
    // A hole with nothing in it is just a hole.
    const html = renderPageBackdropHtml({
      manifest: svgManifest(),
      backdrops: svgBytes(EXPORTED_SVG),
    });
    expect(html).not.toContain("visibility:hidden");
  });

  it("offers no cut-out control when nothing can honour it", () => {
    const html = renderPageBackdropHtml({ manifest: manifest(), backdrops, renders });
    expect(html).not.toContain('id="t-cut"');
  });

  it("strips a script the export should never have carried", () => {
    const hostile =
      `<?xml version="1.0"?><svg viewBox="0 0 1 1" data-node-id="2-1">` +
      `<script>alert(1)</script><rect/></svg>`;
    const html = renderPageBackdropHtml({
      manifest: svgManifest(),
      backdrops: svgBytes(hostile),
    });
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("<?xml");
  });

  it("is deterministic", () => {
    const opts = () => ({
      manifest: svgManifest(),
      backdrops: svgBytes(EXPORTED_SVG),
      renders,
    });
    expect(renderPageBackdropHtml(opts())).toBe(renderPageBackdropHtml(opts()));
  });
});
