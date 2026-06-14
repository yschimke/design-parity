import { describe, it, expect } from "vitest";

import {
  renderIndex,
  renderReadme,
  renderIndexHtml,
  type IndexInput,
} from "../src/index.js";

const base: IndexInput = {
  title: "Design parity",
  sourceCommit: "0123456789abcdef0123456789abcdef01234567",
  entries: [
    { code: "ui/DeviceBody.kt#DeviceBodyPreview", status: "pass", reportPath: "ui-DeviceBody-kt-DeviceBodyPreview/report.html" },
    { code: "ui/DeviceBody.kt#DeviceBodyDarkPreview", status: "fail", reportPath: "ui-DeviceBody-kt-DeviceBodyDarkPreview/report.html" },
    { code: "ui/Pipe|Name.kt#Skipped", status: "skipped" },
  ],
};

describe("renderReadme", () => {
  it("emits a generated banner that links to SOURCE_COMMIT and the short sha", () => {
    const md = renderReadme(base);
    expect(md).toContain("# Design parity");
    expect(md).toContain("do not edit by hand");
    expect(md).toContain("`0123456`");
    expect(md).toContain("[`SOURCE_COMMIT`](./SOURCE_COMMIT)");
  });

  it("renders one table row per component with status and a report cell", () => {
    const md = renderReadme(base);
    expect(md).toContain("| Component | Status | Report |");
    expect(md).toContain("✅ Pass");
    expect(md).toContain("❌ Fail");
    expect(md).toContain("⏭️ Skipped");
    // a skipped component has no report link
    expect(md).toMatch(/Skipped \| — \|/);
  });

  it("escapes pipe characters in the component cell", () => {
    const md = renderReadme(base);
    expect(md).toContain("ui/Pipe\\|Name.kt#Skipped");
  });

  it("uses relative report links when the repo is unknown", () => {
    const md = renderReadme(base);
    expect(md).toContain("[report](./ui-DeviceBody-kt-DeviceBodyPreview/report.html)");
    expect(md).not.toContain("htmlpreview");
  });

  it("wraps report links through htmlpreview when repoSlug + branch are set", () => {
    const md = renderReadme({
      ...base,
      repoSlug: "yschimke/meshcore-mobile",
      branch: "design-parity/main",
    });
    expect(md).toContain(
      "https://htmlpreview.github.io/?https://github.com/yschimke/meshcore-mobile/blob/design-parity/main/ui-DeviceBody-kt-DeviceBodyPreview/report.html",
    );
  });

  it("falls back to a generic SOURCE_COMMIT reference without a sha", () => {
    const md = renderReadme({ ...base, sourceCommit: undefined });
    expect(md).toContain("Rendered from the commit in [`SOURCE_COMMIT`](./SOURCE_COMMIT).");
  });

  it("is deterministic", () => {
    expect(renderReadme(base)).toBe(renderReadme(base));
  });
});

describe("renderIndexHtml", () => {
  it("is a self-contained document with inlined styles and no external requests", () => {
    const html = renderIndexHtml(base);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<link|<script src|https?:\/\//);
  });

  it("renders a status pill and a relative report link per component", () => {
    const html = renderIndexHtml(base);
    expect(html).toContain('class="status status-pass"');
    expect(html).toContain('class="status status-fail"');
    expect(html).toContain('href="./ui-DeviceBody-kt-DeviceBodyPreview/report.html"');
  });

  it("escapes html-special characters in component ids", () => {
    const html = renderIndexHtml(base);
    expect(html).toContain("ui/Pipe|Name.kt#Skipped"); // | is not html-special, passes through
    expect(html).not.toContain("<Pipe");
  });

  it("shows an overview image only when provided", () => {
    expect(renderIndexHtml(base)).not.toContain('class="overview"');
    expect(renderIndexHtml({ ...base, bundleImage: "candidates.bundle.png" })).toContain(
      'src="./candidates.bundle.png"',
    );
  });

  it("is deterministic", () => {
    expect(renderIndexHtml(base)).toBe(renderIndexHtml(base));
  });
});

describe("renderIndex", () => {
  it("returns both artifacts", () => {
    const { readme, html } = renderIndex(base);
    expect(readme).toBe(renderReadme(base));
    expect(html).toBe(renderIndexHtml(base));
  });
});
