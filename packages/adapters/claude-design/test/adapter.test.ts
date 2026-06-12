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
    const adapter = new ClaudeDesignAdapter();
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
    const adapter = new ClaudeDesignAdapter();
    const ref = await adapter.resolve(
      "ui/Card.kt#OfferCard",
      "design/reference/offer-card.html",
      ctx,
    );
    expect(ref.referenceImages[0]).toMatchObject({ width: 240, height: 160 });
  });

  it("throws a readable error when the export is missing", async () => {
    const adapter = new ClaudeDesignAdapter();
    await expect(
      adapter.resolve("ui/Card.kt#OfferCard", "design/reference/nope.html", ctx),
    ).rejects.toThrow(/cannot read HTML export/);
  });

  it("throws when the handoff block is not valid JSON", async () => {
    const adapter = new ClaudeDesignAdapter();
    const { ref } = await tempExport(
      "bad.html",
      `<script type="application/design-parity+json">{ not json }</script>`,
    );
    await expect(
      adapter.resolve("a#b", ref, { repoRoot, env: {} }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("throws when a declared image src is missing", async () => {
    const adapter = new ClaudeDesignAdapter();
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
    const adapter = new ClaudeDesignAdapter();
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
    const adapter = new ClaudeDesignAdapter();
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
    const adapter = new ClaudeDesignAdapter({ rasterizer: stub });
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
    const adapter = new ClaudeDesignAdapter({ rasterizer: stub });
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
