import { describe, it, expect } from "vitest";

import {
  renderIndex,
  renderReadme,
  renderIndexHtml,
  shortCode,
  type IndexInput,
} from "../src/index.js";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const base: IndexInput = {
  title: "Design parity",
  sourceCommit: "0123456789abcdef0123456789abcdef01234567",
  entries: [
    { code: "ui/DeviceBody.kt#DeviceBodyPreview", status: "pass", reportPath: "ui-DeviceBody-kt-DeviceBodyPreview/report.html", thumbnail: PIXEL },
    { code: "ui/DeviceBody.kt#DeviceBodyDarkPreview", status: "fail", reportPath: "ui-DeviceBody-kt-DeviceBodyDarkPreview/report.html" },
    { code: "ui/Pipe|Name.kt#Skipped", status: "skipped" },
  ],
};

const withRepo: IndexInput = {
  ...base,
  repoSlug: "yschimke/meshcore-mobile",
  branch: "design-parity/main",
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
    expect(md).toContain("Pipe\\|Name.kt#Skipped");
  });

  it("shows a shortened component label (file basename + member), not the full path", () => {
    const md = renderReadme({
      ...base,
      entries: [
        {
          code: "meshcore-components/src/commonMain/kotlin/ee/x/DeviceBodyPreviews.kt#DeviceBodyPreview",
          status: "fail",
          reportPath: "x/report.html",
        },
      ],
    });
    expect(md).toContain("DeviceBodyPreviews.kt#DeviceBodyPreview");
    expect(md).not.toContain("commonMain/kotlin");
  });

  it("uses relative report links when the repo is unknown", () => {
    const md = renderReadme(base);
    expect(md).toContain("[report](./ui-DeviceBody-kt-DeviceBodyPreview/report.html)");
    expect(md).not.toContain("htmlpreview");
  });

  it("wraps report links through htmlpreview when repoSlug + branch are set", () => {
    const md = renderReadme(withRepo);
    expect(md).toContain(
      "https://htmlpreview.github.io/?https://github.com/yschimke/meshcore-mobile/blob/design-parity/main/ui-DeviceBody-kt-DeviceBodyPreview/report.html",
    );
  });

  it("offers a previewable 'open the board' link only when the repo is known", () => {
    expect(renderReadme(base)).not.toContain("Open the board");
    expect(renderReadme(withRepo)).toContain(
      "[**Open the board →**](https://htmlpreview.github.io/?https://github.com/yschimke/meshcore-mobile/blob/design-parity/main/index.html)",
    );
  });

  it("adds a per-screen History column linking to GitHub commit history when the repo is known", () => {
    expect(renderReadme(base)).not.toContain("History");
    const md = renderReadme(withRepo);
    expect(md).toContain("| Component | Status | Report | History |");
    expect(md).toContain(
      "[history](https://github.com/yschimke/meshcore-mobile/commits/design-parity/main/ui-DeviceBody-kt-DeviceBodyPreview/report.html)",
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

  it("wraps index report links through htmlpreview when the repo is known", () => {
    const html = renderIndexHtml(withRepo);
    expect(html).toContain(
      'href="https://htmlpreview.github.io/?https://github.com/yschimke/meshcore-mobile/blob/design-parity/main/ui-DeviceBody-kt-DeviceBodyPreview/report.html"',
    );
  });

  it("adds a History column linking to commit history only when the repo is known", () => {
    expect(renderIndexHtml(base)).not.toContain("<th>History</th>");
    const html = renderIndexHtml(withRepo);
    expect(html).toContain("<th>History</th>");
    expect(html).toContain(
      'href="https://github.com/yschimke/meshcore-mobile/commits/design-parity/main/ui-DeviceBody-kt-DeviceBodyPreview/report.html"',
    );
  });

  it("shows the real candidate render as a thumbnail when provided", () => {
    const html = renderIndexHtml(base);
    expect(html).toContain('<img class="thumb"');
    expect(html).toContain(PIXEL);
    expect(html).toContain("<th>Preview</th>");
    // a component with no candidate render shows a placeholder, not an <img>
    expect(html).toMatch(/Pipe\|Name[\s\S]*?/);
    expect((html.match(/class="thumb"/g) ?? []).length).toBe(1);
  });

  it("escapes html-special characters in component ids", () => {
    const html = renderIndexHtml(base);
    expect(html).toContain("Pipe|Name.kt#Skipped"); // | is not html-special, passes through
    expect(html).not.toContain("<Pipe");
  });

  it("shows a short component label but keeps the full handle in a title tooltip", () => {
    const html = renderIndexHtml({
      ...base,
      entries: [
        {
          code: "a/b/c/DeviceBodyPreviews.kt#DeviceBodyPreview",
          status: "fail",
          reportPath: "x/report.html",
        },
      ],
    });
    expect(html).toContain('title="a/b/c/DeviceBodyPreviews.kt#DeviceBodyPreview"');
    expect(html).toContain(">DeviceBodyPreviews.kt#DeviceBodyPreview</td>");
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

describe("shortCode", () => {
  it("reduces a full source path to file basename + member", () => {
    expect(
      shortCode(
        "meshcore-components/src/commonMain/kotlin/ee/x/DeviceBodyPreviews.kt#DeviceBodyPreview",
      ),
    ).toBe("DeviceBodyPreviews.kt#DeviceBodyPreview");
  });

  it("passes through an already-short handle, a path without a member, and a bare name", () => {
    expect(shortCode("ui/DeviceBody.kt#Preview")).toBe("DeviceBody.kt#Preview");
    expect(shortCode("a/b/File.kt")).toBe("File.kt");
    expect(shortCode("Plain")).toBe("Plain");
  });
});
