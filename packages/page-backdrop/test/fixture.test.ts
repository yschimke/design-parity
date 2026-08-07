/**
 * The committed fixture under `fixtures/page-backdrop/` is a real import of a
 * small "Now Playing" screen, with the three code renders that go over it. It
 * exists so the viewer can be built, opened, and eyeballed with no Figma
 * credentials and no renderer — and so this surface stays covered as it
 * changes, rather than depending on someone remembering to re-screenshot it.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { parseManifest } from "../src/import.js";
import { renderPageBackdropHtml } from "../src/viewer.js";

const dir = fileURLToPath(new URL("../../../fixtures/page-backdrop/", import.meta.url));

async function loadFixture() {
  const manifest = parseManifest(JSON.parse(await readFile(`${dir}pages.json`, "utf8")));
  const backdrops = new Map([["now-playing", await readFile(`${dir}now-playing.png`)]]);
  const renders = new Map([
    ["ui/Player.kt#PlayButton", await readFile(`${dir}render-play-button.png`)],
    ["ui/Chips.kt#FilterChip", await readFile(`${dir}render-filter-chip.png`)],
    ["ui/Queue.kt#UpNextCard", await readFile(`${dir}render-up-next-card.png`)],
  ]);
  return { manifest, backdrops, renders };
}

describe("the committed page-backdrop fixture", () => {
  it("covers every link method, so the viewer's four states are all exercised", async () => {
    const { manifest } = await loadFixture();
    const page = manifest.pages[0];
    expect(page?.id).toBe("now-playing");
    expect(new Set(page?.placements.map((p) => p.link))).toEqual(
      new Set(["code-connect", "manifest", "convention", "unlinked"]),
    );
  });

  it("renders to a self-contained page with a hotspot per placement", async () => {
    const { manifest, backdrops, renders } = await loadFixture();
    const html = renderPageBackdropHtml({ manifest, backdrops, renders });

    const placements = manifest.pages[0]?.placements ?? [];
    expect(html.split('<div class="spot"').length - 1).toBe(placements.length);
    expect(html).not.toMatch(/src="(?!data:)/);
    expect(html).toContain("8 of 9 component instances linked to code");
  });
});
