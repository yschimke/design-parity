import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { AdapterContext, DesignReference } from "@design-parity/core";

import { ClaudeDesignAdapter } from "../src/index.js";
import type { Rasterizer } from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const ctx: AdapterContext = { repoRoot, env: {} };
const fixturePng = resolve(repoRoot, "fixtures/claude-design/offer-card.light.png");

/** Write a synthetic export into a throwaway dir; returns its path + dir. */
async function tempExport(
  name: string,
  html: string,
): Promise<{ dir: string; ref: string }> {
  const dir = await mkdtemp(join(tmpdir(), "design-parity-test-"));
  await writeFile(join(dir, name), html, "utf8");
  return { dir, ref: join(dir, name) };
}

describe("ClaudeDesignAdapter.resolve", () => {
  it("round-trips the committed export to the golden DesignReference", async () => {
    const adapter = new ClaudeDesignAdapter({ layoutExtractor: null });
    const ref = await adapter.resolve(
      "ui/Card.kt#OfferCard",
      "design/reference/offer-card.html",
      ctx,
    );

    const golden = JSON.parse(
      await readFile(
        resolve(repoRoot, "fixtures/claude-design/offer-card.reference.json"),
        "utf8",
      ),
    ) as DesignReference;

    expect(ref).toEqual(golden);
    // The only link method possible for a source with no machine link.
    expect(ref.linkMethod).toBe("manifest");
    expect(ref.source).toBe("claude-design");
  });

  it("derives image dimensions from the committed PNG, not the manifest", async () => {
    const adapter = new ClaudeDesignAdapter({ layoutExtractor: null });
    const ref = await adapter.resolve(
      "ui/Card.kt#OfferCard",
      "design/reference/offer-card.html",
      ctx,
    );
    expect(ref.referenceImages[0]).toMatchObject({ width: 240, height: 160 });
  });

  it("throws a readable error when the export is missing", async () => {
    const adapter = new ClaudeDesignAdapter({ layoutExtractor: null });
    await expect(
      adapter.resolve("ui/Card.kt#OfferCard", "design/reference/nope.html", ctx),
    ).rejects.toThrow(/cannot read HTML export/);
  });

  it("throws when the handoff block is not valid JSON", async () => {
    const adapter = new ClaudeDesignAdapter({ layoutExtractor: null });
    const { ref } = await tempExport(
      "bad.html",
      `<script type="application/design-parity+json">{ not json }</script>`,
    );
    await expect(
      adapter.resolve("a#b", ref, { repoRoot, env: {} }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("throws when a declared image src is missing", async () => {
    const adapter = new ClaudeDesignAdapter({ layoutExtractor: null });
    const { ref } = await tempExport(
      "missing-img.html",
      `<script type="application/design-parity+json">
        {"images":[{"state":"default","src":"./missing.png"}]}
      </script>`,
    );
    await expect(
      adapter.resolve("a#b", ref, { repoRoot, env: {} }),
    ).rejects.toThrow(/cannot read reference image/);
  });

  it("throws when the export's componentId contradicts the resolver", async () => {
    const adapter = new ClaudeDesignAdapter({ layoutExtractor: null });
    const { ref } = await tempExport(
      "mismatch.html",
      `<script type="application/design-parity+json">
        {"componentId":"ui/Other.kt#Thing"}
      </script>`,
    );
    await expect(
      adapter.resolve("ui/Card.kt#OfferCard", ref, { repoRoot, env: {} }),
    ).rejects.toThrow(/declares componentId/);
  });

  it("loads tokens from a referenced handoff token file", async () => {
    const adapter = new ClaudeDesignAdapter({ layoutExtractor: null });
    const { dir, ref } = await tempExport(
      "tokens-file.html",
      `<script type="application/design-parity+json">
        {"tokens":"./offer-card.tokens.json",
         "images":[{"state":"default","src":${JSON.stringify(fixturePng)}}]}
      </script>`,
    );
    await writeFile(
      join(dir, "offer-card.tokens.json"),
      JSON.stringify({ spacing: { padding: 8 } }),
      "utf8",
    );

    const result = await adapter.resolve("a#b", ref, { repoRoot, env: {} });
    expect(result.tokens).toEqual({ spacing: { padding: 8 } });
    expect(result.referenceImages[0]).toMatchObject({ width: 240, height: 160 });
  });

  it("rasterizes a variant that ships no pre-rendered src", async () => {
    const calls: Array<{ state: string; theme?: string }> = [];
    const stub: Rasterizer = async (req) => {
      calls.push({ state: req.state, theme: req.theme });
      return { pngPath: fixturePng, width: 240, height: 160 };
    };
    const adapter = new ClaudeDesignAdapter({ layoutExtractor: null, rasterizer: stub });
    const { ref } = await tempExport(
      "raw-variant.html",
      `<script type="application/design-parity+json">
        {"images":[{"state":"default","theme":"dark"}]}
      </script>`,
    );

    const result = await adapter.resolve("a#b", ref, { repoRoot, env: {} });
    expect(calls).toEqual([{ state: "default", theme: "dark" }]);
    expect(result.referenceImages[0]).toMatchObject({
      state: "default",
      theme: "dark",
      width: 240,
      height: 160,
    });
  });

  it("rasterizes the whole document when no images are declared", async () => {
    let count = 0;
    const stub: Rasterizer = async () => {
      count += 1;
      return { pngPath: fixturePng, width: 240, height: 160 };
    };
    const adapter = new ClaudeDesignAdapter({ layoutExtractor: null, rasterizer: stub });
    const { ref } = await tempExport(
      "no-images.html",
      `<div class="card">no handoff images</div>`,
    );

    const result = await adapter.resolve("a#b", ref, { repoRoot, env: {} });
    expect(count).toBe(1);
    expect(result.referenceImages).toHaveLength(1);
    expect(result.referenceImages[0]?.state).toBe("default");
  });
});

describe("ClaudeDesignAdapter layout capture", () => {
  const html =
    `<script type="application/design-parity+json">` +
    `{"componentId":"a#b","images":[{"state":"default","src":${JSON.stringify(fixturePng)}}]}` +
    `</script>`;

  it("attaches the captured layout tree to the reference", async () => {
    const fake = async () => ({ root: { children: [{ label: "Hi", bounds: { x: 1, y: 2, width: 3, height: 4 } }] } });
    const adapter = new ClaudeDesignAdapter({ layoutExtractor: fake });
    const { ref } = await tempExport("c.html", html);
    const result = await adapter.resolve("a#b", ref, { repoRoot, env: {} });
    expect(result.layout?.root.children?.[0]).toMatchObject({ label: "Hi", bounds: { x: 1, height: 4 } });
  });

  it("passes the export path to the extractor", async () => {
    let seen: string | undefined;
    const fake = async (req: { htmlPath: string }) => {
      seen = req.htmlPath;
      return undefined;
    };
    const adapter = new ClaudeDesignAdapter({ layoutExtractor: fake });
    const { ref } = await tempExport("c.html", html);
    await adapter.resolve("a#b", ref, { repoRoot, env: {} });
    expect(seen).toBe(ref);
  });

  it("never fails resolve when the extractor throws", async () => {
    const adapter = new ClaudeDesignAdapter({
      layoutExtractor: async () => {
        throw new Error("no chrome");
      },
    });
    const { ref } = await tempExport("c.html", html);
    const result = await adapter.resolve("a#b", ref, { repoRoot, env: {} });
    expect(result.layout).toBeUndefined();
    expect(result.componentId).toBe("a#b");
  });

  it("omits layout when disabled with null", async () => {
    const adapter = new ClaudeDesignAdapter({ layoutExtractor: null });
    const { ref } = await tempExport("c.html", html);
    const result = await adapter.resolve("a#b", ref, { repoRoot, env: {} });
    expect(result.layout).toBeUndefined();
  });
});

describe("treeFromRects", () => {
  it("rounds rects into a flat bounded tree", async () => {
    const { treeFromRects } = await import("../src/index.js");
    const tree = treeFromRects([
      { label: "A", role: "button", x: 1.4, y: 2.6, w: 10.2, h: 4.9 },
      { label: "B", role: null, x: 0, y: 0, w: 5, h: 5 },
    ]);
    expect(tree.root.children).toEqual([
      { label: "A", role: "button", bounds: { x: 1, y: 3, width: 10, height: 5 } },
      { label: "B", bounds: { x: 0, y: 0, width: 5, height: 5 } },
    ]);
  });

  it("stamps the capture frame on the root so the diff can recover density", async () => {
    const { treeFromRects } = await import("../src/index.js");
    const tree = treeFromRects([{ label: "A", role: null, x: 0, y: 0, w: 5, h: 5 }], {
      width: 411,
      height: 914,
    });
    expect(tree.root.bounds).toEqual({ x: 0, y: 0, width: 411, height: 914 });
  });

  it("leaves the root unbounded when no frame is given", async () => {
    const { treeFromRects } = await import("../src/index.js");
    const tree = treeFromRects([{ label: "A", role: null, x: 0, y: 0, w: 5, h: 5 }]);
    expect(tree.root.bounds).toBeUndefined();
  });

  it("maps a captured computed style into the node's spec tokens", async () => {
    const { treeFromRects } = await import("../src/index.js");
    const tree = treeFromRects([
      {
        label: "Go",
        role: "button",
        x: 0,
        y: 0,
        w: 100,
        h: 40,
        style: {
          paddingTop: "12px",
          paddingRight: "12px",
          paddingBottom: "12px",
          paddingLeft: "12px",
          borderRadius: "8px",
          fontFamily: '"Space Grotesk", sans-serif',
          fontSize: "16px",
          fontWeight: "700",
          lineHeight: "20px",
          color: "rgb(255, 255, 255)",
        },
      },
    ]);
    expect(tree.root.children?.[0]?.tokens).toEqual({
      typography: { text: { fontFamily: "Space Grotesk", fontSize: 16, fontWeight: 700, lineHeight: 20 } },
      colors: { text: "#ffffff" },
      spacing: { padding: 12 },
      radius: { corner: 8 },
    });
  });
});

describe("resolveExecutable", () => {
  it("returns an absolute path as-is when it exists, else undefined", async () => {
    const { resolveExecutable } = await import("../src/index.js");
    // node's own binary is an absolute, existing executable.
    expect(resolveExecutable(process.execPath)).toBe(process.execPath);
    expect(resolveExecutable("/no/such/google-chrome")).toBeUndefined();
  });

  it("resolves a bare command name across PATH (what puppeteer needs)", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { resolveExecutable } = await import("../src/index.js");

    const dir = mkdtempSync(join(tmpdir(), "chrome-path-"));
    const bin = join(dir, "google-chrome-stable");
    writeFileSync(bin, "#!/bin/sh\n");
    // Found when its dir is on PATH; a bare name alone (no dir) does not exist.
    expect(resolveExecutable("google-chrome-stable", { PATH: dir } as NodeJS.ProcessEnv)).toBe(bin);
    expect(resolveExecutable("google-chrome-stable", { PATH: "/nonexistent" } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe("tokensFromStyle", () => {
  const base = {
    paddingTop: "0px",
    paddingRight: "0px",
    paddingBottom: "0px",
    paddingLeft: "0px",
    borderRadius: "0px",
    fontFamily: "",
    fontSize: "",
    fontWeight: "",
    lineHeight: "",
    color: "",
  };

  it("returns undefined when nothing usable is present", async () => {
    const { tokensFromStyle } = await import("../src/index.js");
    expect(tokensFromStyle(undefined)).toBeUndefined();
    expect(tokensFromStyle(base)).toBeUndefined();
  });

  it("only records padding when all four sides agree", async () => {
    const { tokensFromStyle } = await import("../src/index.js");
    const asymmetric = tokensFromStyle({ ...base, paddingTop: "12px", paddingRight: "8px", paddingBottom: "12px", paddingLeft: "8px" });
    expect(asymmetric).toBeUndefined();
    const uniform = tokensFromStyle({ ...base, paddingTop: "10px", paddingRight: "10px", paddingBottom: "10px", paddingLeft: "10px" });
    expect(uniform).toEqual({ spacing: { padding: 10 } });
  });

  it("skips a 'normal' line-height and maps a bold weight / rgba colour", async () => {
    const { tokensFromStyle } = await import("../src/index.js");
    const t = tokensFromStyle({ ...base, fontFamily: "Roboto", fontSize: "14px", fontWeight: "bold", lineHeight: "normal", color: "rgba(0, 0, 0, 0.5)" });
    expect(t).toEqual({
      typography: { text: { fontFamily: "Roboto", fontSize: 14, fontWeight: 700 } },
      colors: { text: "#00000080" },
    });
  });
});
