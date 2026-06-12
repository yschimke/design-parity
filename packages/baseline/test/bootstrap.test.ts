import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  planBootstrap,
  applyBootstrap,
  directionForRung,
  parityConfigForRung,
  CONFIG_FILE,
  TOKENS_FILE,
  CHECKS_FILE,
  DESIGN_MAP_FILE,
} from "../src/index.js";
import { loadDesignMap } from "@design-parity/core";
import type { ParityConfig } from "@design-parity/core";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fixture = (name: string) => resolve(fixtures, name);

describe("directionForRung", () => {
  it("materializes a concrete direction, never auto", () => {
    expect(directionForRung("machine-link")).toBe("design-led");
    expect(directionForRung("manifest")).toBe("code-led");
    expect(directionForRung("bootstrap")).toBe("code-led");
    expect(parityConfigForRung("machine-link")).toEqual({ direction: "design-led" });
  });
});

describe("planBootstrap", () => {
  it("machine-link: writes only a design-led config", async () => {
    const plan = await planBootstrap(fixture("rung1-code-connect"));
    expect(plan.maturity.rung).toBe("machine-link");
    expect(plan.direction).toBe("design-led");
    expect(plan.artifacts.map((a) => a.path)).toEqual([CONFIG_FILE]);
    expect(plan.review).toEqual([]);
  });

  it("manifest: writes only a code-led config", async () => {
    const plan = await planBootstrap(fixture("rung2-design-map"));
    expect(plan.direction).toBe("code-led");
    expect(plan.artifacts.map((a) => a.path)).toEqual([CONFIG_FILE]);
  });

  it("bootstrap: plans the full committed baseline, code-led", async () => {
    const plan = await planBootstrap(fixture("rung3-greenfield"));
    expect(plan.direction).toBe("code-led");
    expect(plan.artifacts.map((a) => a.path).sort()).toEqual(
      [CONFIG_FILE, TOKENS_FILE, CHECKS_FILE, DESIGN_MAP_FILE].sort(),
    );
    expect(plan.review.length).toBeGreaterThan(0);
  });

  it("honors a direction override", async () => {
    const plan = await planBootstrap(fixture("rung3-greenfield"), {
      direction: "design-led",
    });
    expect(plan.direction).toBe("design-led");
    const cfg = JSON.parse(
      plan.artifacts.find((a) => a.path === CONFIG_FILE)!.contents,
    ) as ParityConfig;
    expect(cfg.direction).toBe("design-led");
  });

  it("never leaves auto in the materialized config", async () => {
    for (const f of ["rung1-code-connect", "rung2-design-map", "rung3-greenfield"]) {
      const plan = await planBootstrap(fixture(f));
      const cfg = JSON.parse(
        plan.artifacts.find((a) => a.path === CONFIG_FILE)!.contents,
      ) as ParityConfig;
      expect(cfg.direction).not.toBe("auto");
    }
  });
});

describe("applyBootstrap", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dp-baseline-"));
    await mkdir(join(dir, "ui"), { recursive: true });
    await writeFile(
      join(dir, "ui", "Button.kt"),
      "@Composable\nfun PrimaryButton() {}\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a valid, committable baseline for a greenfield repo", async () => {
    const plan = await planBootstrap(dir);
    expect(plan.maturity.rung).toBe("bootstrap");

    const result = await applyBootstrap(plan);
    expect(result.written.sort()).toEqual(
      [CONFIG_FILE, TOKENS_FILE, CHECKS_FILE, DESIGN_MAP_FILE].sort(),
    );

    // design-map passes the core schema (acceptance criterion).
    const map = await loadDesignMap(join(dir, DESIGN_MAP_FILE));
    expect(map.components).toEqual([]);

    // config carries a concrete direction.
    const cfg = JSON.parse(
      await readFile(join(dir, CONFIG_FILE), "utf8"),
    ) as ParityConfig;
    expect(cfg.direction).toBe("code-led");

    // tokens + checks are valid JSON with the expected leading content.
    const tokens = JSON.parse(await readFile(join(dir, TOKENS_FILE), "utf8"));
    expect(tokens.colors.onPrimary).toBe("#FFFFFF");
    const checks = JSON.parse(await readFile(join(dir, CHECKS_FILE), "utf8"));
    expect(checks.contrastLevel).toBe("AA");
  });

  it("skips existing artifacts unless forced", async () => {
    await writeFile(join(dir, CONFIG_FILE), '{"direction":"design-led"}\n', "utf8");

    const plan = await planBootstrap(dir);
    expect(plan.artifacts.find((a) => a.path === CONFIG_FILE)?.exists).toBe(true);

    const skip = await applyBootstrap(plan);
    expect(skip.skipped).toContain(CONFIG_FILE);
    // a stale plan's exists flag is honored; re-read to confirm untouched.
    const kept = JSON.parse(
      await readFile(join(dir, CONFIG_FILE), "utf8"),
    ) as ParityConfig;
    expect(kept.direction).toBe("design-led");

    const forced = await applyBootstrap(plan, { force: true });
    expect(forced.written).toContain(CONFIG_FILE);
    const overwritten = JSON.parse(
      await readFile(join(dir, CONFIG_FILE), "utf8"),
    ) as ParityConfig;
    expect(overwritten.direction).toBe("code-led");
  });
});
