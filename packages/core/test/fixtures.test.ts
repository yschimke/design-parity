import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFile, access } from "node:fs/promises";

import type { CandidateRender, DesignReference } from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = (p: string) => resolve(repoRoot, p);

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(fixture(p), "utf8")) as T;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(fixture(p));
    return true;
  } catch {
    return false;
  }
}

const referenceFixtures = [
  "fixtures/figma/button-primary.reference.json",
  "fixtures/stitch/offer-card.reference.json",
  "fixtures/claude-design/offer-card.reference.json",
];

describe("DesignReference fixtures", () => {
  it.each(referenceFixtures)("%s is a well-formed reference", async (p) => {
    const ref = await readJson<DesignReference>(p);
    expect(ref.componentId).toMatch(/#/);
    expect(["figma", "stitch", "claude-design"]).toContain(ref.source);
    expect(["code-connect", "manifest", "convention"]).toContain(
      ref.linkMethod,
    );
    expect(ref.referenceImages.length).toBeGreaterThan(0);
    for (const img of ref.referenceImages) {
      expect(img.width).toBeGreaterThan(0);
      expect(img.height).toBeGreaterThan(0);
      expect(await exists(img.uri)).toBe(true);
    }
  });

  it("figma reference uses the code-connect link method", async () => {
    const ref = await readJson<DesignReference>(referenceFixtures[0]!);
    expect(ref.linkMethod).toBe("code-connect");
    expect(ref.tokens?.spacing?.padding).toBe(16);
  });
});

describe("CandidateRender fixture", () => {
  const path = "fixtures/candidate/button-primary.candidate.json";

  it("is well-formed and shares the figma componentId", async () => {
    const cand = await readJson<CandidateRender>(path);
    expect(cand.componentId).toBe("ui/Button.kt#PrimaryButton");
    expect(cand.images.length).toBe(2);
    expect(cand.semantics.root.role).toBe("button");
    for (const img of cand.images) {
      expect(await exists(img.uri)).toBe(true);
    }
  });

  it("encodes the padding violation the diff fixture expects", async () => {
    const cand = await readJson<CandidateRender>(path);
    // candidate padding (12) deliberately differs from the figma spec (16)
    expect(cand.semantics.root.tokens?.spacing?.padding).toBe(12);
  });
});
