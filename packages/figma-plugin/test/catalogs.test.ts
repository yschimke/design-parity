import { describe, expect, it } from "vitest";

import {
  DEFAULT_CATALOGS,
  dehydrateRegistry,
  findCatalog,
  hydrateRegistry,
  normalizeBaseUrl,
  registerCatalog,
  removeCatalog,
  selectCatalog,
  selectedCatalog,
  type CatalogRegistry,
} from "../src/catalogs.js";

describe("normalizeBaseUrl", () => {
  it("trims, drops trailing slashes and an accidental /catalog.json", () => {
    expect(normalizeBaseUrl("  https://x/y/  ")).toBe("https://x/y");
    expect(normalizeBaseUrl("https://x/y/catalog.json")).toBe("https://x/y");
    expect(normalizeBaseUrl("https://x/y/catalog.json/")).toBe("https://x/y");
    expect(normalizeBaseUrl("https://x/y")).toBe("https://x/y");
  });
});

describe("hydrateRegistry", () => {
  it("seeds the three built-ins and selects the first by default", () => {
    const reg = hydrateRegistry(undefined);
    expect(reg.catalogs.map((c) => c.id)).toEqual(["compose-m3", "remote-m3", "wear-m3"]);
    expect(reg.catalogs.every((c) => c.builtin)).toBe(true);
    expect(reg.lastSelectedId).toBe("compose-m3");
  });

  it("re-seeds built-ins from code even if storage had stale copies, and appends custom", () => {
    const reg = hydrateRegistry({
      custom: [
        { id: "compose-m3", label: "STALE", baseUrl: "https://stale" }, // clashes with a built-in id → dropped
        { id: "mine", label: "My System", baseUrl: "https://cdn.example/mine/" },
      ],
      lastSelectedId: "mine",
    });
    // The built-in keeps its code URL, not the stored stale one.
    expect(findCatalog(reg, "compose-m3")!.baseUrl).toBe(DEFAULT_CATALOGS[0].baseUrl);
    const mine = findCatalog(reg, "mine")!;
    expect(mine).toMatchObject({ id: "mine", label: "My System", baseUrl: "https://cdn.example/mine", builtin: false });
    expect(reg.lastSelectedId).toBe("mine");
  });

  it("drops invalid stored entries and falls back to the first catalog when the pick is gone", () => {
    const reg = hydrateRegistry({
      custom: [{ id: "", label: "", baseUrl: "not-a-url" } as never],
      lastSelectedId: "vanished",
    });
    expect(reg.catalogs).toHaveLength(3);
    expect(reg.lastSelectedId).toBe("compose-m3");
  });

  it("skips a custom entry whose URL matches a built-in", () => {
    const reg = hydrateRegistry({
      custom: [{ id: "dupe", label: "Dupe", baseUrl: `${DEFAULT_CATALOGS[2].baseUrl}/` }],
    });
    expect(reg.catalogs.map((c) => c.id)).toEqual(["compose-m3", "remote-m3", "wear-m3"]);
  });
});

describe("registerCatalog", () => {
  const base = (): CatalogRegistry => hydrateRegistry(undefined);

  it("adds a normalized custom catalog and selects it", () => {
    const reg = registerCatalog(base(), { label: "My DS", baseUrl: "https://cdn.example/ds/catalog.json" });
    const added = findCatalog(reg, reg.lastSelectedId!)!;
    expect(added).toMatchObject({ label: "My DS", baseUrl: "https://cdn.example/ds", builtin: false });
    expect(added.id).toBe("my-ds");
    expect(reg.catalogs).toHaveLength(4);
  });

  it("makes ids unique on label collision", () => {
    let reg = registerCatalog(base(), { label: "Dupe", baseUrl: "https://a" });
    reg = registerCatalog(reg, { label: "Dupe", baseUrl: "https://b" });
    expect(reg.catalogs.filter((c) => c.id.startsWith("dupe")).map((c) => c.id)).toEqual(["dupe", "dupe-2"]);
  });

  it("selects the existing catalog instead of duplicating a known URL", () => {
    const reg = registerCatalog(base(), { label: "Same as Wear", baseUrl: DEFAULT_CATALOGS[2].baseUrl });
    expect(reg.catalogs).toHaveLength(3);
    expect(reg.lastSelectedId).toBe("wear-m3");
  });

  it("rejects an empty label or a non-http url", () => {
    expect(() => registerCatalog(base(), { label: "  ", baseUrl: "https://x" })).toThrow(/name/i);
    expect(() => registerCatalog(base(), { label: "X", baseUrl: "ftp://x" })).toThrow(/valid/i);
  });
});

describe("removeCatalog", () => {
  it("removes a custom catalog and re-points the selection when it was selected", () => {
    let reg = registerCatalog(hydrateRegistry(undefined), { label: "Mine", baseUrl: "https://cdn.example/mine" });
    expect(reg.lastSelectedId).toBe("mine");
    reg = removeCatalog(reg, "mine");
    expect(findCatalog(reg, "mine")).toBeUndefined();
    expect(reg.lastSelectedId).toBe("compose-m3");
  });

  it("never removes a built-in", () => {
    const reg = removeCatalog(hydrateRegistry(undefined), "wear-m3");
    expect(reg.catalogs).toHaveLength(3);
  });
});

describe("selectCatalog / selectedCatalog", () => {
  it("remembers a valid pick and ignores an unknown one", () => {
    const reg = selectCatalog(hydrateRegistry(undefined), "wear-m3");
    expect(selectedCatalog(reg)!.id).toBe("wear-m3");
    expect(selectCatalog(reg, "ghost").lastSelectedId).toBe("wear-m3");
  });
});

describe("dehydrateRegistry", () => {
  it("persists only custom entries and the last pick (built-ins re-seed)", () => {
    const reg = registerCatalog(hydrateRegistry(undefined), { label: "Mine", baseUrl: "https://cdn.example/mine" });
    const stored = dehydrateRegistry(reg);
    expect(stored).toEqual({
      custom: [{ id: "mine", label: "Mine", baseUrl: "https://cdn.example/mine" }],
      lastSelectedId: "mine",
    });
    // Round-trips back to the same live registry.
    expect(hydrateRegistry(stored)).toEqual(reg);
  });
});
