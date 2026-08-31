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
import {
  collectDerivedInsets,
  collectRadiusBoxes,
  collectTokens,
  diffTokens,
} from "./tokens.js";
import {
  diffImagePair,
  imageKey,
  looseKey,
  pairKey,
  sizeCompatible,
  type VisualResult,
} from "./visual.js";
import {
  tagIndexFromSemantics,
  type AcceptanceReport,
  type PersistedAcceptanceReport,
  type AcceptanceScope,
} from "./acceptance/index.js";

export interface KnownDifferencesOptions {
  scopes: Record<string, AcceptanceScope>;
  documentPath?: string;
  artifactRoot?: string;
}

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
  /**
   * Apply the repo's committed `compose-preview-known-differences/v1` document to selected image
   * pairs. Keys use the same `state/theme/size` spelling as `visualScores`; an absent key means the
   * pair is evaluated raw only. Scope stays explicit because system/component/preview/reference ids
   * are catalog identities and cannot be reconstructed safely from a code handle.
   */
  knownDifferences?: KnownDifferencesOptions;
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
  /**
   * The candidate PNG as compared, with its declared gutter cropped off — see
   * {@link VisualResult.candidatePng}. Present only when a gutter was really
   * subtracted; absent means the candidate `uri` on disk is what was compared.
   */
  candidate?: Buffer;
}

export interface DiffResult {
  verdict: Verdict;
  /** Markdown summary for the PR surface. */
  summary: string;
  triptychs: Triptych[];
  /** Per-image acceptance results; raw visual findings remain in `verdict`. */
  acceptances?: Record<string, AcceptanceReport>;
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
    // descendant's corner is clamped against — put back in the dp the radius
    // token is already in, since the boxes arrive in the render's pixels.
    collectRadiusBoxes(candidate.semantics.root, candidate.semantics.boundsDensity),
    // The insets the render actually draws, for a padding spec the code meets
    // by centring rather than by a padding modifier. The floor is never coarser
    // than a dp and never finer than what this comparison can tell apart, so a
    // project that tightened its tolerance keeps its fractional insets.
    collectDerivedInsets(
      candidate.semantics.root,
      candidate.semantics.boundsDensity,
      Math.min(1, config.spacingTolerance),
      config.textDerivedInsets,
      // What the reference draws for itself, so an inset whose extremes are all
      // glyphs is not discarded when the kit's own boxes measure the same number
      // (issue #371). Measured lazily from this tree and only for a glyph-set
      // extreme; corroboration can only readmit a measurement, so a reference
      // that captured no geometry simply leaves the rule as it was.
      // A capture that does not state `boundsDensity` is read as already being
      // in dp, per that field's contract, so a scaled board whose density never
      // reached the adapter corroborates nothing. That is a gap, not a licence
      // to infer one: the frame-width ratio `diffLayout` normalises positions by
      // cannot tell a 2× capture from a reference deliberately drawn at twice
      // the candidate's logical width, and rescaling the second reads its true
      // 12 as a 6. "Omit rather than guess" is the rule on both sides of this
      // factor, and a silently halved reference is exactly the wrong number
      // arriving with confidence that this whole predicate exists to stop.
      { layout: reference.layout, tolerance: config.spacingTolerance },
    ),
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
    const scope = options.knownDifferences?.scopes[imageKey(pair.reference)];
    // A merged candidate may contain images authored by different previews.
    // Only the tree captured with this image can safely drive its element gate.
    // The legacy render-wide tree is unambiguous only for a single-image render.
    const semantics = pair.candidate.semantics ??
      (candidate.images.length === 1 ? candidate.semantics : undefined);
    visuals.push(
      await diffImagePair(
        repoRoot,
        pair.reference,
        pair.candidate,
        config,
        scope
          ? {
              repoRoot,
              scope,
              ...(semantics
                ? { tagIndex: tagIndexFromSemantics(semantics.root) }
                : {}),
              ...(options.knownDifferences?.documentPath
                ? { documentPath: options.knownDifferences.documentPath }
                : {}),
              ...(options.knownDifferences?.artifactRoot
                ? { artifactRoot: options.knownDifferences.artifactRoot }
                : {}),
            }
          : undefined,
      ),
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
    if (
      v.alphaLossRatio !== undefined &&
      v.alphaLossRatio > config.visualAlphaLossWarnRatio
    ) {
      visualFindings.push({
        kind: "visual",
        severity: "warn",
        message: `${v.key}: ${(v.alphaLossRatio * 100).toFixed(1)}% of aligned pixels are opaque in the reference but transparent in the candidate`,
        detail: {
          key: v.key,
          alphaLossRatio: round(v.alphaLossRatio),
          alphaLossPixels: v.alphaLossPixels,
          alphaComparedPixels: v.alphaComparedPixels,
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

  const acceptances = Object.fromEntries(
    visuals
      .filter((visual): visual is VisualResult & { acceptance: AcceptanceReport } =>
        visual.acceptance !== undefined,
      )
      .map((visual) => [visual.key, visual.acceptance]),
  );
  const acceptanceSummary = renderAcceptanceSummary(acceptances);
  return {
    verdict,
    summary: renderSummary(verdict) + acceptanceSummary,
    triptychs,
    ...(Object.keys(acceptances).length > 0 ? { acceptances } : {}),
  };
}

export function renderAcceptanceSummary(
  reports: Record<string, PersistedAcceptanceReport>,
): string {
  const entries = Object.entries(reports);
  if (entries.length === 0) return "";
  const lines = entries.flatMap(([key, report]) => {
    const scores = report.scores;
    // The kernel version rides with the numbers. Without it a reader comparing this run against a
    // stored one cannot tell a regression from a rebaseline, since a kernel change moves every score
    // and no verdict.
    const head = `- \`${key}\`: raw ${scores.raw.toFixed(2)}%, accepted ${scores.accepted.toFixed(2)}%, unaccepted ${scores.unaccepted.toFixed(2)}%${scores.version === undefined ? "" : ` (score v${scores.version})`}`;
    const validation = report.validationFailures.map((failure) => {
      const target = failure.id !== undefined
        ? `\`${failure.id}\``
        : failure.index !== undefined
          ? `record ${failure.index}`
          : "document";
      return `  - ${target}: refused (${failure.reason})`;
    });
    const rejected = report.documentRejected
      ? ["  - **document rejected; no committed acceptance was applied**"]
      : [];
    const statuses = Object.entries(report.statuses).map(
      ([id, status]) =>
        `  - \`${id}\`: ${status.status}${status.causes?.length ? ` (${status.causes.join(", ")})` : ""}${status.reasons?.length ? ` (${status.reasons.join(", ")})` : ""}`,
    );
    return [head, ...rejected, ...validation, ...statuses];
  });
  return `\n\n### Scoped known differences\n\n${lines.join("\n")}`;
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
    if (v.candidatePng) triptych.candidate = v.candidatePng;
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
