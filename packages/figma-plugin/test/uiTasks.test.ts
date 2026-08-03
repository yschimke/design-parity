import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

const html = readFileSync(
  fileURLToPath(new URL("../figma/ui.html", import.meta.url)),
  "utf8",
);
const mainThread = readFileSync(
  fileURLToPath(new URL("../figma/code.ts", import.meta.url)),
  "utf8",
);

describe("task-oriented plugin dialog", () => {
  it("offers four explicit tasks with matching accessible panels", () => {
    const tasks = [
      ["add", "Add components"],
      ["library", "Manage library"],
      ["editor", "Customize live"],
      ["propose", "Handoff to code"],
    ] as const;

    for (const [id, label] of tasks) {
      expect(html).toContain(`id="tab-${id}"`);
      expect(html).toContain(`data-view="${id}"`);
      expect(html).toContain(`aria-controls="view-${id}"`);
      expect(html).toContain(`id="view-${id}"`);
      expect(html).toContain(`aria-labelledby="tab-${id}"`);
      expect(html).toContain(`<span class="tab-title">${label}</span>`);
    }
    expect((html.match(/class="tab"/g) ?? [])).toHaveLength(4);
    expect((html.match(/role="tabpanel"/g) ?? [])).toHaveLength(4);
  });

  it("keeps one shared catalog source and one dominant action per task", () => {
    expect((html.match(/id="catalog-source"/g) ?? [])).toHaveLength(1);
    expect(html).toContain('id="insert" type="button" class="primary"');
    expect(html).toContain('id="import-all" type="button" class="primary"');
    expect(html).toContain('id="upgrade-mapped" type="button" class="primary"');
    expect(html).toContain('id="place" type="button" class="primary"');
    expect(html).toContain('id="read-selection" type="button" class="primary"');
  });

  it("uses progressive disclosure and announced status regions", () => {
    expect((html.match(/<details class="disclosure"/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('id="status" role="status" aria-live="polite"');
    expect(html).toContain('id="editor-status" role="status" aria-live="polite"');
    expect(html).toContain('id="propose-status" role="status" aria-live="polite"');
    expect(mainThread).toContain("figma.showUI(__html__, { width: 440, height: 640, themeColors: true })");
  });

  it("does not introduce duplicate element ids", () => {
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]!);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("commits a rendered screenshot for every task view", () => {
    for (const task of ["add", "library", "customize", "handoff"]) {
      const png = readFileSync(fileURLToPath(new URL(`../docs/ui-task-${task}.png`, import.meta.url)));
      expect(png.subarray(0, 8), `${task} preview is not a PNG`).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(png.byteLength, `${task} preview looks empty`).toBeGreaterThan(20_000);
    }

    const manifest = JSON.parse(readFileSync(
      fileURLToPath(new URL("../docs/ui-preview.manifest.json", import.meta.url)),
      "utf8",
    )) as { schema: string; inputs: Record<string, string> };
    expect(manifest.schema).toBe("design-parity-ui-preview/v1");
    const sources: Record<string, URL> = {
      "figma/ui.html": new URL("../figma/ui.html", import.meta.url),
      "figma/ui.ts": new URL("../figma/ui.ts", import.meta.url),
      "figma/code.ts": new URL("../figma/code.ts", import.meta.url),
      "docs/ui-preview.mjs": new URL("../docs/ui-preview.mjs", import.meta.url),
      "docs/sample-catalog.json": new URL("../docs/sample-catalog.json", import.meta.url),
    };
    const current = Object.fromEntries(Object.entries(sources).map(([name, url]) => [
      name,
      createHash("sha256").update(readFileSync(url)).digest("hex"),
    ]));
    expect(manifest.inputs, "dialog preview screenshots are stale — run npm run preview:ui").toEqual(current);
  });
});
