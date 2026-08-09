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
  TokenAliasMap,
  Verdict,
  VerdictStatus,
} from "@design-parity/core";

import {
  defaultChecks,
  type ChecksConfig,
  type ChecksProvider,
} from "./checks.js";
import { resolveConfig, type DiffConfig } from "./config.js";
import { diffDesignSystem } from "./design-system.js";
import { diffLayout } from "./layout.js";
import {
  depictionFinding,
  propertyConflicts,
  unpairableFinding,
  type PropertyConflict,
} from "./pairing.js";
import { diffSemantics } from "./semantic.js";
import { renderSummary } from "./summary.js";
import { collectRadiusBoxes, collectTokens, diffTokens } from "./tokens.js";
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
   * Design-name ↔ code-name token aliases (the repo's `design-map.json`
   * `tokens` section). When set, token-compliance canonicalises the design-named
   * reference spec to code names before comparing (issue #78).
   */
  tokenAlias?: TokenAliasMap;
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
  /**
   * Pairs the variant keys matched but the component properties refute — the
   * reference depicts a different point in the component's property space than
   * the candidate claims to be. Reported, never diffed (see `pairing.ts`).
   */
  unpairable: Array<{ reference: Image; conflicts: PropertyConflict[] }>;
}

/**
 * Pair candidate images to reference images. Exact `state/theme/normalized-size`
 * first (so `"Compact"`/`"600dp"`/`"compact"` line up); then a size-tolerant
 * fallback by `state/theme` when one side omits/uses an unknown size. Two
 * *different known* sizes never pair. Reference variants left over are reported
 * rather than silently dropped.
 *
 * A match on the variant key is necessary but not sufficient: the key names
 * state/theme/size, and a component varies along axes it does not name. When
 * the candidate declares a property the reference contradicts, the pair is
 * separated out as unpairable instead of being diffed.
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
  const unpairable: PairingResult["unpairable"] = [];

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
      const conflicts = propertyConflicts(reference.properties, ref, cand);
      if (conflicts.length > 0) unpairable.push({ reference: ref, conflicts });
      else pairs.push({ reference: ref, candidate: cand });
    } else {
      unmatched.push(ref);
    }
  }
  return { pairs, unmatched, unpairable };
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

  // 2. token compliance: per-node tokens, then the design-system palette audit.
  const tokens = diffTokens(
    reference.tokens,
    candidateTokens,
    config,
    options.tokenAlias,
    // The box each radius bounds, per node — the root's frame is not what a
    // descendant's corner is clamped against.
    collectRadiusBoxes(candidate.semantics.root),
  );
  const designSystem = diffDesignSystem(
    reference.themeTokens,
    candidate.semantics.themeTokens,
    {
      ...(candidate.semantics.theme ? { theme: candidate.semantics.theme } : {}),
      ...(options.tokenAlias ? { alias: options.tokenAlias } : {}),
      spacingTolerance: config.spacingTolerance,
      radiusTolerance: config.radiusTolerance,
    },
  );

  // 3. semantics (+ reference variants with no candidate counterpart).
  const semantic = diffSemantics(reference, candidate);
  const { pairs, unmatched, unpairable } = pairImages(reference, candidate);
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

  // 3b. pairing: state what the reference depicts beyond its name, and report
  // the pairs whose properties refute each other rather than diffing them.
  const pairing: Finding[] = [];
  const depiction = depictionFinding(reference.properties);
  if (depiction) pairing.push(depiction);
  for (const { reference: ref, conflicts } of unpairable) {
    pairing.push(unpairableFinding(imageKey(ref), conflicts));
  }

  // 4. structural layout: per-element position/size drift vs the reference's
  // captured geometry (advisory; a no-op when the reference has no layout).
  const layout = diffLayout(reference.layout, candidate.semantics, config);

  // 5. visual diff (table stakes).
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
    if (v.dimensionMismatch && v.dimensions) {
      // The pair was diffed over its overlap; say so, and say by how much the
      // frames differ (#47). `visualDimTolerancePx` no longer decides *whether*
      // to compare — it only separates density rounding (info: a pixel or two
      // between render tools) from a real size difference (warn: the candidate
      // is genuinely a different shape than its design). Reporting the larger
      // drift *more* loudly is the point: it used to report it less.
      const { reference: r, candidate: c } = v.dimensions;
      const dw = r.width - c.width;
      const dh = r.height - c.height;
      const rounding =
        Math.abs(dw) <= config.visualDimTolerancePx &&
        Math.abs(dh) <= config.visualDimTolerancePx;
      const border = v.borderPixels ?? 0;
      const uncovered = v.totalPixels === 0 ? 0 : border / v.totalPixels;
      visualFindings.push({
        kind: "visual",
        severity: rounding ? "info" : "warn",
        message: rounding
          ? `${v.key}: reference and candidate differ slightly in size (${r.width}×${r.height} vs ${c.width}×${c.height}); compared over their overlap`
          : `${v.key}: reference ${r.width}×${r.height} vs candidate ${c.width}×${c.height}; compared over their ${Math.min(r.width, c.width)}×${Math.min(r.height, c.height)} overlap, ${(uncovered * 100).toFixed(1)}% of the frame uncovered`,
        detail: {
          key: v.key,
          dw,
          dh,
          borderPixels: border,
          contentPixels: v.diffPixels - border,
        },
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

  const findings = [
    ...a11y,
    ...tokens,
    ...designSystem,
    ...pairing,
    ...semantic,
    ...layout,
    ...visualFindings,
  ];
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
