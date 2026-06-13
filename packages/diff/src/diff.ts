/**
 * The diff engine entry point: consume a `(DesignReference, CandidateRender)`
 * pair and emit a deterministic {@link Verdict} plus a human summary and the
 * visual triptychs.
 *
 * Findings are assembled in value order (Principle 2): a11y + i18n (the checks
 * provider) → token compliance → semantics → visual. No network, no model, no
 * clock — the same pair always yields the same verdict (Principle 1).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  CandidateRender,
  DesignReference,
  Finding,
  Image,
  Verdict,
  VerdictStatus,
} from "@design-parity/core";

import {
  defaultChecks,
  type ChecksConfig,
  type ChecksProvider,
} from "./checks.js";
import { resolveConfig, type DiffConfig } from "./config.js";
import { diffSemantics } from "./semantic.js";
import { renderSummary } from "./summary.js";
import { collectTokens, diffTokens } from "./tokens.js";
import {
  diffImagePair,
  imageKey,
  looseKey,
  pairKey,
  sizeCompatible,
  type VisualResult,
} from "./visual.js";

export interface DiffOptions {
  /** Repo root the image `uri`s resolve against. Defaults to `process.cwd()`. */
  repoRoot?: string;
  /** Threshold/rule overrides; unset fields use the committed defaults. */
  config?: Partial<DiffConfig>;
  /**
   * a11y + i18n provider. Defaults to {@link defaultChecks}, which delegates to
   * `@design-parity/checks` (#10). Inject to swap in a custom provider.
   */
  checks?: ChecksProvider;
  /** Committed a11y/i18n thresholds passed to the checks provider. */
  checksConfig?: ChecksConfig;
  /**
   * If set, triptych PNGs are written here as `triptych-<key>.png` and their
   * paths land in {@link DiffResult.triptychs}. Omit to skip disk writes; the
   * buffers are still returned.
   */
  outDir?: string;
}

/** A rendered triptych for one image pair. */
export interface Triptych {
  /** `state/theme/size` key, shared with {@link Verdict.visualScores}. */
  key: string;
  png: Buffer;
  /** Absolute path, present only when {@link DiffOptions.outDir} was set. */
  path?: string;
  /**
   * The standalone diff heatmap PNG for this pair (the pixelmatch panel only),
   * so a consumer laying out its own columns can inline it — e.g. the HTML
   * report (#50). Absent when there was no aligned region to diff.
   */
  diff?: Buffer;
}

export interface DiffResult {
  verdict: Verdict;
  /** Markdown summary for the PR surface. */
  summary: string;
  triptychs: Triptych[];
}

interface PairingResult {
  pairs: Array<{ reference: Image; candidate: Image }>;
  /** Reference variants with no candidate to compare against. */
  unmatched: Image[];
}

/**
 * Pair candidate images to reference images. Exact `state/theme/normalized-size`
 * first (so `"Compact"`/`"600dp"`/`"compact"` line up); then a size-tolerant
 * fallback by `state/theme` when one side omits/uses an unknown size. Two
 * *different known* sizes never pair. Reference variants left over are reported
 * rather than silently dropped.
 */
function pairImages(
  reference: DesignReference,
  candidate: CandidateRender,
): PairingResult {
  const exact = new Map<string, Image>();
  for (const i of candidate.images) {
    if (!exact.has(pairKey(i))) exact.set(pairKey(i), i);
  }

  const used = new Set<Image>();
  const pairs: PairingResult["pairs"] = [];
  const unmatched: Image[] = [];

  for (const ref of reference.referenceImages) {
    let cand = exact.get(pairKey(ref));
    if (cand && used.has(cand)) cand = undefined;
    if (!cand) {
      cand = candidate.images.find(
        (c) =>
          !used.has(c) &&
          looseKey(c) === looseKey(ref) &&
          sizeCompatible(ref, c),
      );
    }
    if (cand) {
      used.add(cand);
      pairs.push({ reference: ref, candidate: cand });
    } else {
      unmatched.push(ref);
    }
  }
  return { pairs, unmatched };
}

function statusFor(findings: Finding[]): VerdictStatus {
  if (findings.some((f) => f.severity === "error")) return "fail";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "pass";
}

/**
 * Run the full parity diff. Resolves images, runs every dimension, orders the
 * findings by value, and returns the verdict, its markdown, and the triptychs.
 */
export async function diff(
  reference: DesignReference,
  candidate: CandidateRender,
  options: DiffOptions = {},
): Promise<DiffResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const config = resolveConfig(options.config);
  const checks = options.checks ?? defaultChecks;

  const candidateTokens = collectTokens(candidate.semantics.root);

  // 1. a11y + i18n (highest value, leads the verdict).
  const a11y = await checks.run({
    reference,
    candidate,
    config: options.checksConfig ?? {},
  });

  // 2. token compliance.
  const tokens = diffTokens(reference.tokens, candidateTokens, config);

  // 3. semantics (+ reference variants with no candidate counterpart).
  const semantic = diffSemantics(reference, candidate);
  const { pairs, unmatched } = pairImages(reference, candidate);
  const candidateThemes = new Set(
    candidate.images.map((i) => i.theme).filter(Boolean),
  );
  for (const ref of unmatched) {
    // A wholly-missing theme is already reported by diffSemantics; only flag
    // finer gaps (a missing size/state within a theme the candidate renders).
    if (ref.theme && !candidateThemes.has(ref.theme)) continue;
    semantic.push({
      kind: "semantic",
      severity: "warn",
      message: `reference variant '${imageKey(ref)}' has no candidate render to compare`,
      detail: { variant: imageKey(ref) },
    });
  }

  // 4. visual diff (table stakes).
  const visuals: VisualResult[] = [];
  for (const pair of pairs) {
    visuals.push(
      await diffImagePair(repoRoot, pair.reference, pair.candidate, config),
    );
  }
  const visualScores: Record<string, number> = {};
  const visualFindings: Finding[] = [];
  for (const v of visuals) {
    visualScores[v.key] = round(v.score);
    if (v.dimensionMismatch) {
      // The pair was diffed over its overlap after a sub-tolerance size delta;
      // note it so the reviewer knows the score is an aligned comparison (#47).
      visualFindings.push({
        kind: "visual",
        severity: "info",
        message: `${v.key}: reference and candidate differ slightly in size; compared over their overlap`,
        detail: { key: v.key },
      });
    }
    if (v.score > config.visualWarnRatio) {
      visualFindings.push({
        kind: "visual",
        severity: "warn",
        message: `${v.key}: ${(v.score * 100).toFixed(1)}% of pixels differ from reference`,
        detail: { key: v.key, score: round(v.score), diffPixels: v.diffPixels },
      });
    }
  }

  const findings = [...a11y, ...tokens, ...semantic, ...visualFindings];
  const verdict: Verdict = {
    componentId: candidate.componentId,
    status: statusFor(findings),
    findings,
    visualScores,
  };

  const triptychs = await emitTriptychs(visuals, options.outDir);

  return { verdict, summary: renderSummary(verdict), triptychs };
}

async function emitTriptychs(
  visuals: VisualResult[],
  outDir: string | undefined,
): Promise<Triptych[]> {
  if (outDir) await mkdir(outDir, { recursive: true });
  const out: Triptych[] = [];
  for (const v of visuals) {
    const safeKey = v.key.replace(/[^a-z0-9]+/gi, "-");
    const triptych: Triptych = { key: v.key, png: v.triptych };
    if (v.diffPng) triptych.diff = v.diffPng;
    if (outDir) {
      const path = join(outDir, `triptych-${safeKey}.png`);
      await writeFile(path, v.triptych);
      triptych.path = path;
    }
    out.push(triptych);
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
