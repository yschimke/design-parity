import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  loadParityConfig,
  loadParityConfigOrDefault,
  validateParityConfig,
  parityConfigSchema,
  defaultParityConfig,
  DEFAULT_DIRECTION,
} from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = (p: string) => resolve(repoRoot, p);

let tmp: string;
const write = async (name: string, body: string) => {
  const path = join(tmp, name);
  await writeFile(path, body, "utf8");
  return path;
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "parity-config-"));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("parity-config schema", () => {
  it("exposes a draft-07 schema", () => {
    expect(parityConfigSchema.$schema).toContain("draft-07");
  });

  it("accepts each direction value", () => {
    for (const direction of ["auto", "design-led", "code-led"]) {
      expect(validateParityConfig({ direction }).valid).toBe(true);
    }
  });

  it("accepts an empty object (direction is optional)", () => {
    expect(validateParityConfig({}).valid).toBe(true);
  });

  it("rejects an unknown direction", () => {
    const r = validateParityConfig({ direction: "design-first" });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/direction/);
  });

  it("rejects extra top-level keys", () => {
    expect(validateParityConfig({ direction: "auto", extra: true }).valid).toBe(
      false,
    );
  });

  // JSON has no comment syntax, so a repo explaining *why* it picked its
  // direction has nowhere to put the reasoning. Rejecting `$comment` — the
  // JSON Schema annotation keyword for exactly that — made deleting the
  // rationale the only way to pass validation (yschimke/m3-catalog#11).
  it("accepts a $comment carrying the config's rationale", () => {
    expect(
      validateParityConfig({ direction: "design-led", $comment: "why: the kit is authoritative" })
        .valid,
    ).toBe(true);
  });

  it("still rejects a non-string $comment", () => {
    expect(validateParityConfig({ $comment: { why: "no" } }).valid).toBe(false);
  });

  it("accepts the optional cmpCapable boolean", () => {
    expect(validateParityConfig({ direction: "code-led", cmpCapable: false }).valid).toBe(true);
    expect(validateParityConfig({ direction: "code-led", cmpCapable: true }).valid).toBe(true);
  });

  it("rejects a non-boolean cmpCapable", () => {
    expect(validateParityConfig({ cmpCapable: "yes" }).valid).toBe(false);
  });

  it("accepts the token-comparison policy (#367 / #368)", () => {
    expect(
      validateParityConfig({
        direction: "design-led",
        tokens: { missingNumerics: "strict", textDerivedInsets: "measure" },
      }).valid,
    ).toBe(true);
    // Each knob is independently optional.
    expect(validateParityConfig({ tokens: {} }).valid).toBe(true);
    expect(validateParityConfig({ tokens: { missingNumerics: "advisory" } }).valid).toBe(
      true,
    );
    expect(validateParityConfig({ tokens: { textDerivedInsets: "skip" } }).valid).toBe(
      true,
    );
  });

  it("accepts exact issue-backed token differences", () => {
    expect(
      validateParityConfig({
        direction: "design-led",
        tokens: {
          acceptedDifferences: [
            {
              component: "ui/Checkbox.kt#Checkbox",
              source: "figma",
              token: "spacing.padding",
              expected: 4,
              actual: 2,
              issue: "https://github.com/example/repo/issues/1",
            },
          ],
        },
      }).valid,
    ).toBe(true);
  });

  it("rejects an unaccountable or incomplete token difference", () => {
    expect(
      validateParityConfig({
        tokens: {
          acceptedDifferences: [
            {
              component: "ui/Checkbox.kt#Checkbox",
              source: "figma",
              token: "spacing.padding",
              expected: 4,
              actual: 2,
              issue: "not-an-https-issue",
            },
          ],
        },
      }).valid,
    ).toBe(false);
    expect(validateParityConfig({ tokens: { acceptedDifferences: [{}] } }).valid).toBe(false);
  });

  it("rejects an unknown token knob or value", () => {
    expect(validateParityConfig({ tokens: { spacingTolerance: 2 } }).valid).toBe(false);
    expect(validateParityConfig({ tokens: { missingNumerics: "lenient" } }).valid).toBe(
      false,
    );
    expect(validateParityConfig({ tokens: { textDerivedInsets: true } }).valid).toBe(
      false,
    );
  });
});

describe("loadParityConfig", () => {
  it("loads and validates the example config", async () => {
    const config = await loadParityConfig(fixture("examples/design-parity.json"));
    expect(config.direction).toBe("code-led");
  });

  it("normalizes a present file with no direction to the auto default", async () => {
    const path = await write("no-direction.json", "{}");
    const config = await loadParityConfig(path);
    expect(config.direction).toBe("auto");
  });

  it("round-trips the cmpCapable flag and omits it when absent", async () => {
    const path = await write("cmp.json", '{ "direction": "code-led", "cmpCapable": false }');
    expect((await loadParityConfig(path)).cmpCapable).toBe(false);

    const none = await write("nocmp.json", '{ "direction": "code-led" }');
    expect("cmpCapable" in (await loadParityConfig(none))).toBe(false);
  });

  it("round-trips the token policy, omitting knobs the repo didn't set", async () => {
    // An omitted knob must stay omitted rather than being filled in here: the
    // engine's committed default is the single place that decides it, so a
    // config that says nothing about insets cannot pin today's answer.
    const path = await write(
      "tokens.json",
      '{ "direction": "design-led", "tokens": { "missingNumerics": "strict" } }',
    );
    const config = await loadParityConfig(path);
    expect(config.tokens).toEqual({ missingNumerics: "strict" });

    const none = await write("notokens.json", '{ "direction": "design-led" }');
    expect("tokens" in (await loadParityConfig(none))).toBe(false);

    // `"tokens": {}` says nothing, so it is dropped rather than carried as an
    // empty override.
    const empty = await write("emptytokens.json", '{ "tokens": {} }');
    expect("tokens" in (await loadParityConfig(empty))).toBe(false);
  });

  it("round-trips accepted token differences", async () => {
    const accepted = {
      component: "ui/Checkbox.kt#Checkbox",
      source: "figma",
      token: "spacing.padding",
      expected: 4,
      actual: 2,
      issue: "https://github.com/example/repo/issues/1",
    };
    const path = await write(
      "accepted-token.json",
      JSON.stringify({ direction: "design-led", tokens: { acceptedDifferences: [accepted] } }),
    );
    expect((await loadParityConfig(path)).tokens?.acceptedDifferences).toEqual([accepted]);
  });

  it("throws a readable error for a missing file", async () => {
    await expect(loadParityConfig(fixture("nope.json"))).rejects.toThrow(
      /cannot read/,
    );
  });

  it("throws a readable error for an invalid config", async () => {
    const path = await write("bad.json", '{ "direction": "sketch-led" }');
    await expect(loadParityConfig(path)).rejects.toThrow(
      /failed schema validation/,
    );
  });

  it("throws a readable error for non-JSON", async () => {
    const path = await write("notjson.json", "direction: auto");
    await expect(loadParityConfig(path)).rejects.toThrow(/not valid JSON/);
  });
});

describe("loadParityConfigOrDefault", () => {
  it("defaults a missing config to auto", async () => {
    const config = await loadParityConfigOrDefault(fixture("nope.json"));
    expect(config).toEqual(defaultParityConfig());
    expect(config.direction).toBe(DEFAULT_DIRECTION);
    expect(DEFAULT_DIRECTION).toBe("auto");
  });

  it("still throws on a present-but-invalid config", async () => {
    const path = await write("bad2.json", '{ "direction": 7 }');
    await expect(loadParityConfigOrDefault(path)).rejects.toThrow(
      /failed schema validation/,
    );
  });
});
