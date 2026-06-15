/**
 * The parity pipeline: for each changed component, resolve its design reference
 * (via the adapter the resolver picked), pair it with the candidate render, diff
 * them, and aggregate into one report. The parity direction decides whether a
 * failure blocks.
 *
 * Fail-soft (Principle: a broken adapter must not break the run): a per-component
 * error is captured and surfaced, never thrown, and never escalates the overall
 * status to `fail` — only real verdicts do.
 */
import type {
  AdapterContext,
  CandidateRender,
  Correspondence,
  DesignReference,
  DesignSource,
  DesignTokens,
  Finding,
  ResolvedDirection,
  TokenAliasMap,
  Verdict,
  VerdictStatus,
} from "@design-parity/core";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  diff,
  renderSummary,
  type ChecksProvider,
  type DiffConfig,
  type Triptych,
} from "@design-parity/diff";
import { directionPolicy } from "@design-parity/policy";
import {
  renderHtmlReport,
  renderIndex,
  type DiffImage,
  type IndexEntry,
} from "@design-parity/report-html";

import type { AdapterRegistry } from "./registry.js";
import { resolveReference } from "./reference.js";

/** Supplies the candidate render for a component (compose-preview, or precomputed). */
export type CandidateProvider = (
  componentId: string,
  ctx: AdapterContext,
) => Promise<CandidateRender | undefined> | CandidateRender | undefined;

export interface OrchestrateOptions {
  repoRoot: string;
  env?: Record<string, string | undefined>;
  registry: AdapterRegistry;
  /** The (code → source/ref) links the resolver produced for the changed components. */
  correspondences: Correspondence[];
  candidate: CandidateProvider;
  /**
   * Renderer-native a11y/i18n findings for a component (issue #43). When this
   * returns findings, they **supersede** design-parity's own `@design-parity/checks`
   * for that component — injected as the diff's `checks` provider (the parity
   * token/visual/semantic diff still runs). Used by the daemon candidate source,
   * which ingests the renderer's own `a11y/atf` / `text/strings` / … products.
   * Returning `undefined` keeps the default checks.
   */
  nativeChecks?: (
    componentId: string,
    ctx: AdapterContext,
  ) => Promise<Finding[] | undefined> | Finding[] | undefined;
  /** Concrete direction (already resolved from `.design-parity.json`). */
  direction: ResolvedDirection;
  /** Where triptych PNGs are written (optional). */
  outDir?: string;
  diffConfig?: Partial<DiffConfig>;
  /**
   * The repo's `design-map.json` `tokens` section — design-name ↔ code-name
   * token aliases, passed to the diff so token-compliance matches differing
   * vocabularies (issue #78).
   */
  tokenAlias?: TokenAliasMap;
  /**
   * Per-component spec tokens declared in committed config (a `design-map`
   * `tokensFile` DTCG document, issue #89), keyed by code handle. When present
   * for a component, they are merged into the resolved
   * {@link DesignReference.tokens} (declared values win), so a source that
   * doesn't expose tokens still has a spec to diff against. Matched via the
   * Material-role heuristic (issue #87), same as any reference tokens.
   */
  referenceTokens?: ReadonlyMap<string, DesignTokens>;
  /**
   * When `outDir` is set, a `README.md` + `index.html` landing page is written at
   * its root so the published branch has an entry point. These describe where the
   * index will live so report links render on GitHub (see {@link renderIndex}).
   */
  index?: {
    /** Candidate commit the reports were rendered from, shown on the landing page. */
    sourceCommit?: string;
    /** `owner/repo` the branch is published to (enables htmlpreview report links). */
    repoSlug?: string;
    /** Branch the index is published to (e.g. `design-parity/main`). */
    branch?: string;
    /** Overview image at the branch root, e.g. `candidates.bundle.png`. */
    bundleImage?: string;
  };
}

/** Wrap precomputed native findings as a {@link ChecksProvider} for the diff. */
function nativeChecksProvider(findings: Finding[]): ChecksProvider {
  return { run: () => findings };
}

/** Merge declared spec tokens over a reference's, per group; declared values win. */
function mergeReferenceTokens(
  base: DesignTokens | undefined,
  declared: DesignTokens,
): DesignTokens {
  const out: DesignTokens = {};
  const spacing = { ...base?.spacing, ...declared.spacing };
  if (Object.keys(spacing).length > 0) out.spacing = spacing;
  const radius = { ...base?.radius, ...declared.radius };
  if (Object.keys(radius).length > 0) out.radius = radius;
  const colors = { ...base?.colors, ...declared.colors };
  if (Object.keys(colors).length > 0) out.colors = colors;
  const typography = { ...base?.typography, ...declared.typography };
  if (Object.keys(typography).length > 0) out.typography = typography;
  return out;
}

/**
 * Drop design-system findings (`detail.scope === "design-system"`) whose
 * signature was already reported this run, keeping all other findings and order.
 * Mutates `seen` with each newly kept signature.
 */
function dedupeDesignSystem(findings: Finding[], seen: Set<string>): Finding[] {
  return findings.filter((f) => {
    if (f.detail?.scope !== "design-system") return true;
    if (seen.has(f.message)) return false;
    seen.add(f.message);
    return true;
  });
}

/** The verdict status implied by a finding set (mirrors the diff engine's rule). */
function verdictStatus(findings: Finding[]): VerdictStatus {
  if (findings.some((f) => f.severity === "error")) return "fail";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "pass";
}

/** A filesystem-safe slug for a component id (`ui/Tile.kt#LightOn_Dark` → `ui-Tile-kt-LightOn_Dark`). */
function sanitizeId(code: string): string {
  return code.replace(/[^a-z0-9_]+/gi, "-").replace(/^-+|-+$/g, "");
}

/** Inline the candidate's first render (reality, not the mock) as a `data:` URI for the landing-page thumbnail. */
function inlineCandidateThumb(
  root: string,
  candidate: CandidateRender,
): string | undefined {
  const img = candidate.images[0];
  if (!img) return undefined;
  if (img.uri.startsWith("data:")) return img.uri;
  try {
    const bytes = readFileSync(resolve(root, img.uri));
    return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return undefined; // a missing render must not break the run
  }
}

export type ComponentStatus = "ok" | "skipped" | "error";

export interface ComponentResult {
  code: string;
  source?: DesignSource;
  status: ComponentStatus;
  reference?: DesignReference;
  /**
   * The candidate render that was diffed, retained so a downstream consumer can
   * act on the shipped pixels — notably Code-to-Canvas push-back (issue #9),
   * which writes this image back to the design tool in `code-led` mode. Only
   * present when a candidate was available (i.e. `status` is `ok`).
   */
  candidate?: CandidateRender;
  verdict?: Verdict;
  summary?: string;
  triptychs?: Triptych[];
  /** Path to the self-contained HTML comparison page, when `outDir` was set (#50). */
  reportPath?: string;
  /** Reason for `skipped` (no candidate) or `error` (adapter/diff failure). */
  note?: string;
}

export interface ParityReport {
  /** Worst verdict status across components (errors do not escalate this). */
  status: VerdictStatus;
  /** True only when the direction blocks PRs and at least one verdict failed. */
  blocked: boolean;
  direction: ResolvedDirection;
  results: ComponentResult[];
  /** Non-fatal issues: adapter errors, skipped components, resolver warnings. */
  warnings: string[];
  /**
   * The committed CMP capability flag (Principle 6), threaded from
   * `.design-parity.json` for the report layer. `false` ⇒ the repo is
   * Android-only, so the comment carries a non-blocking "could run parity faster
   * on Compose Multiplatform" suggestion; `true`/omitted ⇒ no promotion. Never
   * affects {@link ParityReport.status} or {@link ParityReport.blocked} —
   * advisory only.
   */
  cmpCapable?: boolean;
}

function worst(a: VerdictStatus, b: VerdictStatus): VerdictStatus {
  const rank = { pass: 0, warn: 1, fail: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

/** Run the full parity pipeline over the resolved components. */
export async function orchestrate(
  options: OrchestrateOptions,
): Promise<ParityReport> {
  const ctx: AdapterContext = { repoRoot: options.repoRoot, env: options.env ?? {} };
  const results: ComponentResult[] = [];
  const warnings: string[] = [];
  let status: VerdictStatus = "pass";
  // Signatures of design-system findings already reported this run (see below).
  const seenDesignSystem = new Set<string>();

  for (const corr of options.correspondences) {
    const result: ComponentResult = {
      code: corr.code,
      source: corr.source,
      status: "ok",
    };

    try {
      const adapter = options.registry[corr.source];
      if (!adapter) {
        result.status = "error";
        result.note = `no adapter registered for source '${corr.source}'`;
        warnings.push(`${corr.code}: ${result.note}`);
        results.push(result);
        continue;
      }

      const reference = await resolveReference(adapter, corr, ctx);
      // A component can declare its spec tokens via a committed DTCG file
      // (design-map `tokensFile`, issue #89); merge them over whatever the
      // adapter resolved so a token-less source still has a spec to diff.
      const declared = options.referenceTokens?.get(corr.code);
      if (declared) reference.tokens = mergeReferenceTokens(reference.tokens, declared);
      result.reference = reference;

      const candidate = await options.candidate(corr.code, ctx);
      if (!candidate) {
        result.status = "skipped";
        result.note = "no candidate render available";
        warnings.push(`${corr.code}: ${result.note}`);
        results.push(result);
        continue;
      }
      // Retain the render so push-back (#9) can write the shipped pixels back.
      result.candidate = candidate;

      // Each component writes into its own subdir so triptychs (keyed only by
      // image variant) and the HTML page don't collide across components (#49).
      const componentOutDir = options.outDir
        ? join(options.outDir, sanitizeId(corr.code))
        : undefined;

      // Renderer-native findings (daemon path) supersede the default checks
      // for this component (issue #43); the parity diff itself is unchanged.
      const native = await options.nativeChecks?.(corr.code, ctx);
      const diffOptions = {
        repoRoot: options.repoRoot,
        ...(componentOutDir ? { outDir: componentOutDir } : {}),
        ...(options.diffConfig ? { config: options.diffConfig } : {}),
        ...(options.tokenAlias ? { tokenAlias: options.tokenAlias } : {}),
        ...(native ? { checks: nativeChecksProvider(native) } : {}),
      };
      const { verdict, summary, triptychs } = await diff(
        reference,
        candidate,
        diffOptions,
      );
      // The design-system audit runs per component but its palette is shared, so
      // drop drift already reported on an earlier component — each design-system
      // finding surfaces once per run, not once per screen (#78 Phase 3).
      const deduped = dedupeDesignSystem(verdict.findings, seenDesignSystem);
      result.verdict = verdict;
      result.summary = summary;
      if (deduped.length !== verdict.findings.length) {
        verdict.findings = deduped;
        verdict.status = verdictStatus(deduped);
        result.summary = renderSummary(verdict);
      }
      result.triptychs = triptychs;

      // Emit the self-contained HTML comparison page alongside the triptychs,
      // inlining each pair's diff heatmap when the engine produced one (#50).
      if (componentOutDir) {
        const diffImages: DiffImage[] = triptychs
          .filter((t): t is Triptych & { diff: Buffer } => t.diff !== undefined)
          .map((t) => ({ key: t.key, png: t.diff }));
        const html = renderHtmlReport({
          reference,
          candidate,
          verdict,
          repoRoot: options.repoRoot,
          ...(diffImages.length > 0 ? { diffImages } : {}),
        });
        const reportPath = join(componentOutDir, "report.html");
        await mkdir(componentOutDir, { recursive: true });
        await writeFile(reportPath, html);
        result.reportPath = reportPath;
      }

      status = worst(status, verdict.status);
    } catch (err) {
      // Fail soft: surface, never throw, never escalate overall status.
      result.status = "error";
      result.note = (err as Error).message;
      warnings.push(`${corr.code}: ${result.note}`);
    }

    results.push(result);
  }

  // Stitch the per-component reports into a branch landing page so the published
  // branch has an entry point instead of a wall of machine-named directories.
  if (options.outDir) {
    const entries: IndexEntry[] = results.map((r) => {
      const thumbnail = r.candidate
        ? inlineCandidateThumb(options.repoRoot, r.candidate)
        : undefined;
      return {
        code: r.code,
        status: r.verdict?.status ?? (r.status === "error" ? "error" : "skipped"),
        ...(r.reportPath ? { reportPath: `${sanitizeId(r.code)}/report.html` } : {}),
        ...(thumbnail ? { thumbnail } : {}),
      };
    });
    const { readme, html } = renderIndex({ entries, ...options.index });
    await mkdir(options.outDir, { recursive: true });
    await writeFile(join(options.outDir, "README.md"), readme);
    await writeFile(join(options.outDir, "index.html"), html);
  }

  const blocked = directionPolicy(options.direction).blocksPr && status === "fail";
  return { status, blocked, direction: options.direction, results, warnings };
}
