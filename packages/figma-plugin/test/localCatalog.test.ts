import { describe, expect, it } from "vitest";

import type { CatalogManifest } from "@design-parity/catalog-export";

import { rewriteManifestAssets, stripLocalRoot } from "../src/localCatalog.js";
import { resolveImageUrl } from "../src/plan.js";

describe("stripLocalRoot", () => {
  it("drops the leading directory segment (the picked folder name)", () => {
    expect(stripLocalRoot("compose-m3/catalog.json")).toBe("catalog.json");
    expect(stripLocalRoot("compose-m3/images/button/x.png")).toBe("images/button/x.png");
  });

  it("returns a path with no separator unchanged", () => {
    expect(stripLocalRoot("catalog.json")).toBe("catalog.json");
  });
});

const manifest: CatalogManifest = {
  schema: "design-parity-catalog/v1",
  system: "compose-m3",
  title: "Compose Material 3",
  components: [
    {
      componentId: "Button/Filled",
      wireframe: "wireframes/button-filled.svg",
      greenlines: [],
      redlines: [],
      images: [
        { variant: "ideal", path: "images/a.png", state: "default", width: 10, height: 10 },
        { variant: "ideal", path: "images/b.png", state: "default", theme: "dark", width: 10, height: 10 },
      ],
    },
    {
      // No local file for its image, and no wireframe — left untouched.
      componentId: "Switch/On",
      greenlines: [],
      redlines: [],
      images: [{ variant: "ideal", path: "images/missing.png", state: "on", width: 10, height: 10 }],
    },
  ],
};

describe("rewriteManifestAssets", () => {
  const urlFor = (path: string): string | undefined =>
    ({
      "images/a.png": "blob:local/a",
      "images/b.png": "blob:local/b",
      "wireframes/button-filled.svg": "blob:local/wf",
    })[path];

  it("rewrites image paths and the wireframe to their object URLs, leaving misses alone", () => {
    const out = rewriteManifestAssets(manifest, urlFor);
    const button = out.components[0]!;
    expect(button.images.map((i) => i.path)).toEqual(["blob:local/a", "blob:local/b"]);
    expect(button.wireframe).toBe("blob:local/wf");
    // Metadata is preserved (only the path changed).
    expect(button.images[1]).toMatchObject({ theme: "dark", width: 10, height: 10 });
    // A component with no local file is unchanged.
    expect(out.components[1]!.images[0]!.path).toBe("images/missing.png");
    // The input isn't mutated.
    expect(manifest.components[0]!.images[0]!.path).toBe("images/a.png");
  });

  it("produces paths resolveImageUrl passes through (blob: is absolute), so no base is needed", () => {
    const out = rewriteManifestAssets(manifest, urlFor);
    const path = out.components[0]!.images[0]!.path;
    expect(resolveImageUrl("", path)).toBe("blob:local/a");
    expect(resolveImageUrl("https://ignored", path)).toBe("blob:local/a");
  });
});
