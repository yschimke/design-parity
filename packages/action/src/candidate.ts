/**
 * Build the {@link CandidateProvider} a parity run uses to obtain candidate
 * renders.
 *
 * Two committed, offline inputs are supported (Principle 1 — no live model):
 *
 * 1. A precomputed `CandidateRender[]` JSON (today's path) — reproducible, the
 *    renderer's output captured as an artifact.
 * 2. A directory / list of compose-ai-tools **preview-bundle** polyglots
 *    (issue #38, Phase 1) — the project's own pipeline already rendered these;
 *    `@design-parity/candidate`'s {@link bundleCandidateSource} reads them
 *    statically (pure JS, no JVM) into the same `CandidateRender`s.
 *
 * Both reduce to a {@link CandidateProvider}; {@link firstAvailable} lets a run
 * combine them (e.g. bundles first, precomputed JSON as a fallback).
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type {
  AdapterContext,
  CandidateRender,
  DesignMap,
} from "@design-parity/core";
import {
  bundleCandidateSource,
  firstAvailable,
  readPreviewBundle,
  type CandidateSource,
  type PreviewBundle,
} from "@design-parity/candidate";
import { resolvePreviewIds, type PreviewIdentity } from "@design-parity/resolver";

import type { CandidateProvider } from "./orchestrate.js";

/** A {@link CandidateSource} backed by an in-memory `CandidateRender[]`. */
export function precomputedSource(
  candidates: Iterable<CandidateRender>,
): CandidateSource {
  const index = new Map<string, CandidateRender>();
  for (const c of candidates) index.set(c.componentId, c);
  return {
    kind: "precomputed",
    async getCandidate(componentId) {
      return index.get(componentId);
    },
  };
}

/** Load a precomputed `CandidateRender[]` JSON (array or `{ candidates }`). */
export async function loadPrecomputed(
  repoRoot: string,
  path: string,
): Promise<CandidateSource> {
  const raw = JSON.parse(
    await readFile(resolve(repoRoot, path), "utf8"),
  ) as CandidateRender[] | { candidates: CandidateRender[] };
  return precomputedSource(Array.isArray(raw) ? raw : raw.candidates);
}

/**
 * Expand a comma-separated list of preview-bundle inputs (each a polyglot
 * `.png` file or a directory of them) into concrete bundle file paths, resolved
 * against `repoRoot`.
 */
export async function resolveBundlePaths(
  repoRoot: string,
  inputs: string[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const input of inputs) {
    const abs = isAbsolute(input) ? input : resolve(repoRoot, input);
    const info = await stat(abs);
    if (info.isDirectory()) {
      const names = await readdir(abs);
      for (const name of names.sort()) {
        if (name.toLowerCase().endsWith(".png")) paths.push(join(abs, name));
      }
    } else {
      paths.push(abs);
    }
  }
  return paths;
}

/** A {@link CandidateProvider} from a {@link CandidateSource}. */
export function providerFromSource(source: CandidateSource): CandidateProvider {
  return (componentId: string, ctx: AdapterContext) =>
    source.getCandidate(componentId, ctx);
}

export interface BuildProviderOptions {
  repoRoot: string;
  /** Precomputed `CandidateRender[]` JSON path (array or `{ candidates }`). */
  candidatesPath?: string;
  /** Preview-bundle inputs: polyglot `.png` files and/or directories of them. */
  bundlePaths?: string[];
  /**
   * The loaded `design-map.json`, used to reconcile bundle preview ids to code
   * handles so bundle candidates pair with their references (issue #44).
   */
  designMap?: DesignMap;
}

/** The candidate provider plus any non-fatal diagnostics from building it. */
export interface BuiltCandidateProvider {
  /** `undefined` when no candidate source was configured. */
  provider?: CandidateProvider;
  /** e.g. preview ids that couldn't be reconciled to a code handle (#44). */
  warnings: string[];
}

/**
 * Assemble a {@link CandidateProvider} from the configured inputs. When both a
 * precomputed JSON and bundles are given, bundles are tried first and the JSON
 * is the fallback (a hand-authored override). The `provider` is `undefined`
 * when neither is configured (the run has no candidate source).
 *
 * Bundle preview ids are reconciled to code handles through
 * `@design-parity/resolver` (the `design-map` `previewId` field, else the
 * `sourceFile#functionName` convention) so a bundle candidate keys on the same
 * id the orchestrator pairs references by (issue #44). Unreconcilable preview
 * ids surface as `warnings` rather than silently failing to pair.
 */
export async function buildCandidateProvider(
  options: BuildProviderOptions,
): Promise<BuiltCandidateProvider> {
  const sources: CandidateSource[] = [];
  const warnings: string[] = [];

  if (options.bundlePaths && options.bundlePaths.length > 0) {
    const paths = await resolveBundlePaths(options.repoRoot, options.bundlePaths);
    if (paths.length > 0) {
      const bundles: PreviewBundle[] = [];
      for (const p of paths) bundles.push(await readPreviewBundle(p));

      const identities: PreviewIdentity[] = bundles.flatMap((b) =>
        b.previews.map((e) => ({
          id: e.id,
          ...(e.sourceFile !== undefined ? { sourceFile: e.sourceFile } : {}),
          ...(e.functionName !== undefined
            ? { functionName: e.functionName }
            : {}),
        })),
      );
      const { matches, warnings: mapWarnings } = resolvePreviewIds(
        identities,
        options.designMap,
      );
      warnings.push(...mapWarnings);

      sources.push(
        bundleCandidateSource({
          bundles,
          resolveComponentId: (preview) => matches.get(preview.id)?.code,
        }),
      );
    }
  }
  if (options.candidatesPath) {
    sources.push(await loadPrecomputed(options.repoRoot, options.candidatesPath));
  }

  if (sources.length === 0) return { warnings };
  const source = sources.length === 1 ? sources[0]! : firstAvailable(sources);
  return { provider: providerFromSource(source), warnings };
}
