import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

import type {
  CandidateRender,
  DesignReference,
  Finding,
} from "@design-parity/core";

import { diff, defaultChecks, type ChecksProvider } from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(resolve(repoRoot, p), "utf8")) as T;
}

const loadPair = async () => ({
  reference: await readJson<DesignReference>(
    "fixtures/figma/button-primary.reference.json",
  ),
  candidate: await readJson<CandidateRender>(
    "fixtures/candidate/button-primary.candidate.json",
  ),
});

describe("checks provider seam (issue #10)", () => {
  it("delegates to @design-parity/checks by default (real contrast findings)", async () => {
    const { reference, candidate } = await loadPair();
    const { verdict } = await diff(reference, candidate, { repoRoot });
    expect(verdict.findings.some((f) => f.kind === "contrast")).toBe(true);
  });

  it("exposes defaultChecks as the provider the engine uses", async () => {
    const { reference, candidate } = await loadPair();
    const direct = await defaultChecks.run({ reference, candidate, config: {} });
    const { verdict } = await diff(reference, candidate, { repoRoot });
    // every finding the default provider emits shows up in the verdict, in order.
    const a11y = verdict.findings.filter((f) =>
      ["contrast", "a11y", "i18n"].includes(f.kind),
    );
    expect(a11y).toEqual(direct);
  });

  it("lets a provider be injected and leads the verdict with its findings", async () => {
    const { reference, candidate } = await loadPair();
    const i18nFinding: Finding = {
      kind: "i18n",
      severity: "error",
      message: "hardcoded user-facing string 'Continue'",
    };
    const stubChecks: ChecksProvider = {
      run: () => [i18nFinding],
    };

    const { verdict } = await diff(reference, candidate, {
      repoRoot,
      checks: stubChecks,
    });

    // injected provider replaces the default: no contrast finding, ours leads.
    expect(verdict.findings.some((f) => f.kind === "contrast")).toBe(false);
    expect(verdict.findings[0]).toEqual(i18nFinding);
  });
});
