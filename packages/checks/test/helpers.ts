import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

import type {
  CandidateRender,
  DesignReference,
  SemanticNode,
} from "@design-parity/core";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const here = fileURLToPath(new URL(".", import.meta.url));

/** Read a JSON fixture relative to the repo root (shared golden fixtures). */
export function readRepoJson<T>(p: string): T {
  return JSON.parse(readFileSync(resolve(repoRoot, p), "utf8")) as T;
}

/** Read a JSON fixture local to this package's `test/` dir. */
export function readLocalJson<T>(p: string): T {
  return JSON.parse(readFileSync(resolve(here, p), "utf8")) as T;
}

export const goldenCandidate = (): CandidateRender =>
  readRepoJson("fixtures/candidate/button-primary.candidate.json");

export const goldenFigmaReference = (): DesignReference =>
  readRepoJson("fixtures/figma/button-primary.reference.json");

/** Build a single-node candidate render for focused unit tests. */
export function candidateOf(root: SemanticNode): CandidateRender {
  return {
    componentId: "test/Component#Root",
    images: [],
    semantics: { theme: "light", root },
  };
}
