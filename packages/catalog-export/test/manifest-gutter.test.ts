import { describe, expect, it } from "vitest";

import { toCatalogManifest } from "../src/manifest.js";
import type { Catalog } from "../src/types.js";

/**
 * The published PNG keeps its gutter — `writeCatalog` writes the render's own
 * bytes — so the manifest has to state it. Without this, a consumer of the
 * published catalog reads the oversized canvas as the component's bounds.
 */
describe("catalog manifest carries a declared capture gutter", () => {
  const gutter = { start: 16, top: 16, end: 16, bottom: 16 };

  const catalog = (withGutter: boolean): Catalog => ({
    meta: { system: "wear-m3", title: "Wear M3", library: [], renderer: "compose-preview" },
    components: [
      {
        componentId: "Button/Filled",
        variants: {
          ideal: [
            {
              state: "default",
              uri: "a",
              width: 136,
              height: 136,
              ...(withGutter ? { gutter } : {}),
            },
          ],
        },
      },
    ],
  });

  it("round-trips the gutter onto the manifest entry", () => {
    const entry = toCatalogManifest(catalog(true)).components[0]!.images[0]!;
    expect(entry.gutter).toEqual(gutter);
    // The canvas is still reported as rendered; the gutter says what to take off.
    expect(entry.width).toBe(136);
  });

  it("says nothing when the render has no gutter", () => {
    expect(toCatalogManifest(catalog(false)).components[0]!.images[0]!.gutter).toBeUndefined();
  });
});
