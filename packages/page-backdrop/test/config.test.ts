import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect } from "vitest";

import {
  loadPageBackdropConfig,
  readPageBackdropConfig,
  slugify,
} from "../src/config.js";

async function tempRepo(contents?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "page-backdrop-"));
  if (contents !== undefined) {
    await writeFile(join(dir, "design-pages.json"), contents, "utf8");
  }
  return dir;
}

const MINIMAL = {
  enabled: true,
  fileKey: "AbCdEf123456",
  pages: [{ nodeId: "1:2" }],
};

describe("the opt-in gate", () => {
  it("is off when the repo has no design-pages.json", async () => {
    const status = await loadPageBackdropConfig({ repoRoot: await tempRepo() });
    expect(status).toEqual({ enabled: false, reason: "no-config" });
  });

  it("stays off when a config exists but does not set enabled: true", async () => {
    // The whole point of this case: a repo can land the configuration for
    // review without the feature switching itself on.
    const repo = await tempRepo(
      JSON.stringify({ ...MINIMAL, enabled: false }),
    );
    expect(await loadPageBackdropConfig({ repoRoot: repo })).toEqual({
      enabled: false,
      reason: "disabled",
    });
  });

  it("stays off when `enabled` is merely truthy rather than exactly true", async () => {
    for (const enabled of ["true", 1, {}, null]) {
      const status = readPageBackdropConfig({ ...MINIMAL, enabled }, "/repo/design-pages.json");
      expect(status).toEqual({ enabled: false, reason: "disabled" });
    }
  });

  it("stays off when `enabled` is absent entirely", () => {
    const { enabled: _drop, ...withoutFlag } = MINIMAL;
    expect(readPageBackdropConfig(withoutFlag, "/repo/design-pages.json")).toEqual({
      enabled: false,
      reason: "disabled",
    });
  });

  it("turns on only with an explicit enabled: true", async () => {
    const repo = await tempRepo(JSON.stringify(MINIMAL));
    const status = await loadPageBackdropConfig({ repoRoot: repo });
    expect(status.enabled).toBe(true);
    if (!status.enabled) return;
    expect(status.config.fileKey).toBe("AbCdEf123456");
    expect(status.config.pages).toEqual([{ nodeId: "1:2" }]);
  });

  it("reports a malformed config as off-with-a-reason, never as a throw", async () => {
    const repo = await tempRepo("{ not json");
    const status = await loadPageBackdropConfig({ repoRoot: repo });
    expect(status.enabled).toBe(false);
    if (status.enabled) return;
    expect(status.reason).toBe("invalid");
    expect(status.detail).toContain("not valid JSON");
  });

  it("rejects a config that is enabled but incomplete", () => {
    const cases: Array<[unknown, string]> = [
      [{ enabled: true, pages: [{ nodeId: "1:2" }] }, "'fileKey'"],
      [{ ...MINIMAL, pages: [] }, "'pages'"],
      [{ ...MINIMAL, pages: [{}] }, "'pages[0].nodeId'"],
      [{ ...MINIMAL, scale: 0 }, "'scale'"],
      [{ ...MINIMAL, scale: 9 }, "'scale'"],
      [{ ...MINIMAL, nested: "yes" }, "'nested'"],
      [{ ...MINIMAL, source: "stitch" }, "'source'"],
      [{ ...MINIMAL, overlay: { opacity: 4 } }, "'overlay.opacity'"],
      [{ ...MINIMAL, overlay: { blend: "screen" } }, "'overlay.blend'"],
    ];
    for (const [raw, needle] of cases) {
      const status = readPageBackdropConfig(raw, "/repo/design-pages.json");
      expect(status.enabled, `${JSON.stringify(raw)} should be rejected`).toBe(false);
      if (status.enabled) continue;
      expect(status.reason).toBe("invalid");
      expect(status.detail).toContain(needle);
    }
  });
});

describe("config defaults", () => {
  it("defaults the overlay to off — the design is what you see first", () => {
    const status = readPageBackdropConfig(MINIMAL, "/repo/design-pages.json");
    expect(status.enabled).toBe(true);
    if (!status.enabled) return;
    expect(status.config.overlay).toEqual({ enabled: false, opacity: 0.5, blend: "normal" });
  });

  it("defaults scale, nesting and outDir", () => {
    const status = readPageBackdropConfig(MINIMAL, "/repo/design-pages.json");
    if (!status.enabled) throw new Error("expected enabled");
    expect(status.config.scale).toBe(2);
    expect(status.config.nested).toBe(false);
    expect(status.config.outDir).toBe(resolve("/repo/design/pages"));
  });

  it("resolves a relative outDir against the config file, and leaves an absolute one alone", () => {
    const rel = readPageBackdropConfig(
      { ...MINIMAL, outDir: "artifacts/pages" },
      "/repo/nested/design-pages.json",
    );
    if (!rel.enabled) throw new Error("expected enabled");
    expect(rel.config.outDir).toBe(resolve("/repo/nested/artifacts/pages"));

    const abs = readPageBackdropConfig(
      { ...MINIMAL, outDir: resolve("/elsewhere/pages") },
      "/repo/design-pages.json",
    );
    if (!abs.enabled) throw new Error("expected enabled");
    expect(abs.config.outDir).toBe(resolve("/elsewhere/pages"));
  });

  it("keeps an explicitly enabled overlay", () => {
    const status = readPageBackdropConfig(
      { ...MINIMAL, overlay: { enabled: true, opacity: 0.8, blend: "difference" } },
      "/repo/design-pages.json",
    );
    if (!status.enabled) throw new Error("expected enabled");
    expect(status.config.overlay).toEqual({ enabled: true, opacity: 0.8, blend: "difference" });
  });
});

describe("slugify", () => {
  it("makes a filename-safe slug of a layer name", () => {
    expect(slugify("Now Playing")).toBe("now-playing");
    expect(slugify("Settings / Account")).toBe("settings-account");
    expect(slugify("  Home  ")).toBe("home");
  });

  it("falls back to 'page' when a name has nothing sluggable", () => {
    expect(slugify("///")).toBe("page");
  });
});
