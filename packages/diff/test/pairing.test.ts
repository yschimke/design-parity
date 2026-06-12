import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { CandidateRender, DesignReference, Image } from "@design-parity/core";

import { diff } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
// A real 160×48 PNG so the visual stage runs; pairing is what we assert.
const PNG = "fixtures/figma/button-primary.light.png";

const img = (over: Partial<Image>): Image => ({
  state: "default",
  theme: "light",
  uri: PNG,
  width: 160,
  height: 48,
  ...over,
});
const ref = (images: Image[]): DesignReference => ({
  componentId: "ui/X.kt#X",
  source: "figma",
  linkMethod: "code-connect",
  referenceImages: images,
});
const cand = (images: Image[]): CandidateRender => ({
  componentId: "ui/X.kt#X",
  images,
  semantics: { theme: "light", root: { role: "button", label: "X" } },
});

const hasUnmatched = (findings: { message: string }[]) =>
  findings.some((f) => /no candidate render/.test(f.message));

describe("diff image pairing (#24)", () => {
  it("pairs when the candidate omits size (loose fallback)", async () => {
    const { verdict } = await diff(
      ref([img({ size: "compact" })]),
      cand([img({})]), // no size
      { repoRoot },
    );
    expect(hasUnmatched(verdict.findings)).toBe(false);
    expect(Object.keys(verdict.visualScores ?? {})).toContain(
      "default/light/compact",
    );
  });

  it("pairs across differently-spelled-but-equal sizes (normalized)", async () => {
    const { verdict } = await diff(
      ref([img({ size: "medium" })]),
      cand([img({ size: "700" })]), // 700dp → medium
      { repoRoot },
    );
    expect(hasUnmatched(verdict.findings)).toBe(false);
    expect(verdict.visualScores?.["default/light/medium"]).toBe(0);
  });

  it("flags a reference variant with no candidate counterpart (different known size)", async () => {
    const { verdict } = await diff(
      ref([img({ size: "expanded" })]),
      cand([img({ size: "compact" })]),
      { repoRoot },
    );
    const finding = verdict.findings.find((f) =>
      /no candidate render/.test(f.message),
    );
    expect(finding).toBeDefined();
    expect(finding!.kind).toBe("semantic");
    expect(finding!.message).toContain("default/light/expanded");
  });

  it("does not double-report when a whole theme is missing (theme-coverage owns that)", async () => {
    const { verdict } = await diff(
      ref([img({ theme: "dark", size: "compact" })]),
      cand([img({ theme: "light", size: "compact" })]),
      { repoRoot },
    );
    // theme-coverage reports the missing dark theme; the per-variant check stays quiet.
    expect(hasUnmatched(verdict.findings)).toBe(false);
    expect(
      verdict.findings.some((f) => /dark theme/.test(f.message)),
    ).toBe(true);
  });
});
