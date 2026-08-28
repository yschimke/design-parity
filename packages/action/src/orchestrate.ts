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
  ReferenceAdapter,
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
  renderAcceptanceSummary,
  renderSummary,
  type AcceptanceReport,
  type ChecksProvider,
  type DiffConfig,
  type KnownDifferencesOptions,
  type Triptych,
} from "@design-parity/diff";
import { directionPolicy } from "@design-parity/policy";
import {
  buildParityFindingsManifest,
  isEmptyParityFindings,
  type ParityFindingsEntry,
} from "@design-parity/catalog-export";
import {
  renderHtmlReport,
  renderIndex,
  type DiffImage,
  type IndexEntry,
} from "@design-parity/report-html";

import type { AdapterRegistry } from "./registry.js";
import { resolveReference } from "./reference.js";
import { specTokenKey } from "./specTokens.js";

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
   * Exact catalog scopes keyed by component correspondence. Keeping the image
   * keys inside that component prevents common keys such as `default/light`
   * from colliding across a multi-component run.
   */
  knownDifferences?: ReadonlyMap<string, KnownDifferencesOptions>;
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

/** Loose value comparison — sources spell booleans and enum values differently. */
function equivalentValue(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Prefer a reference the candidate could actually be a picture of.
 *
 * When the candidate declares a variant axis (`Size=Medium`) and the mapped
 * reference is a different point on that axis, diffing them measures the wrong
 * thing — the difference reported is the axis, not the code. But "the same
 * component with one axis moved" is a mechanical lookup in the source's own
 * data model, so ask for that node instead of reporting a mismatch nobody can
 * act on. The diff still reports the pair unpairable if this finds nothing.
 *
 * Bounded by the number of variant axes: each pass fixes one, and a pass that
 * fixes none ends it. Only reached when there *is* a contradiction, so the
 * common path pays nothing.
 *
 * @returns the better reference, or `undefined` to keep the one already
 *   resolved — including whenever the source cannot answer, which is the case
 *   the diff's pairing check exists for.
 */
async function preferMatchingVariant(
  adapter: ReferenceAdapter,
  reference: DesignReference,
  candidate: CandidateRender,
  code: string,
  ctx: AdapterContext,
): Promise<DesignReference | undefined> {
  if (!adapter.resolveSibling) return undefined;

  // What the candidate says it is, first declaration per axis.
  const claimed = new Map<string, string>();
  for (const image of candidate.images) {
    for (const [name, value] of Object.entries(image.props ?? {})) {
      const key = name.trim().toLowerCase();
      if (!claimed.has(key)) claimed.set(key, value);
    }
  }
  if (claimed.size === 0) return undefined;

  let current = reference;
  for (let pass = 0; pass < claimed.size; pass++) {
    const axes = (current.properties ?? []).filter((p) => p.type === "variant");
    const conflict = axes.find((p) => {
      const value = claimed.get(p.name.trim().toLowerCase());
      return value !== undefined && !equivalentValue(p.value, value);
    });
    if (!conflict || !current.ref) break;

    const value = claimed.get(conflict.name.trim().toLowerCase())!;
    let sibling: string | undefined;
    try {
      sibling = await adapter.resolveSibling(
        current.ref,
        { axis: conflict.name, value },
        ctx,
      );
    } catch {
      break; // a source that cannot answer leaves the reference as it was
    }
    if (!sibling || sibling === current.ref) break;
    try {
      current = await adapter.resolve(code, sibling, ctx);
    } catch {
      break;
    }
  }
  return current === reference ? undefined : current;
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

/**
 * The output subdir slug for one correspondence. Normally the code alone
 * (`ui-Card-kt-OfferCard`), so single-source layouts stay stable. When a code
 * binds several sources in the same run (issue #106), the source is appended
 * (`ui-Card-kt-OfferCard-stitch`) so the two (code, source) reports don't
 * collide — each gets its own dir, page, and index row.
 */
function componentSlug(
  corr: Correspondence,
  codeCounts: ReadonlyMap<string, number>,
): string {
  const base = sanitizeId(corr.code);
  return (codeCounts.get(corr.code) ?? 0) > 1
    ? `${base}-${sanitizeId(corr.source)}`
    : base;
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

/**
 * The run's machine-readable findings, beside `run.json` and the per-component reports.
 *
 * Named for what it is rather than for the schema, like every other artifact on a reporting
 * branch: `run.json` is the summary, this is what the run concluded.
 */
export const PARITY_FINDINGS_FILE = "findings.json";

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
  /** Scoped acceptance scores/statuses keyed like `visualScores`; raw findings stay in `verdict`. */
  acceptances?: Record<string, AcceptanceReport>;
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
  /**
   * The landing-page rows written alongside the per-component reports, present
   * only when `outDir` was set. Retained (rather than being a private detail of
   * the index write) so a **sharded** run can hand them to `design-parity merge`,
   * which unions the shards' rows into one index instead of re-deriving them —
   * re-derivation would need every shard's candidate renders in the merge job,
   * which is the whole cost the fan-out just paid to avoid. See `shard.ts`.
   */
  indexEntries?: IndexEntry[];
}

function worst(a: VerdictStatus, b: VerdictStatus): VerdictStatus {
  const rank = { pass: 0, warn: 1, fail: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

/** Run the full parity pipeline over the resolved components. */
export async function orchestrate(
  options: OrchestrateOptions,
): Promise<ParityReport> {
  const ctx: AdapterContext = {
    repoRoot: options.repoRoot,
    env: options.env ?? {},
  };
  const results: ComponentResult[] = [];
  const warnings: string[] = [];
  let status: VerdictStatus = "pass";
  // Signatures of design-system findings already reported this run (see below).
  const seenDesignSystem = new Set<string>();

  // How many sources each code binds this run — a code diffed against more than
  // one source (issue #106) has its output dir disambiguated by source.
  const codeCounts = new Map<string, number>();
  for (const c of options.correspondences) {
    codeCounts.set(c.code, (codeCounts.get(c.code) ?? 0) + 1);
  }
  // The output slug chosen for each result, reused when building the index so a
  // row's report link matches the dir the report was written to.
  const slugByResult = new Map<ComponentResult, string>();

  // Give each adapter the whole list before resolving any of it. Correspondences
  // are resolved one after another, so an adapter has no other moment at which
  // it can see more than one ref — and for a source with a rate limiter, asking
  // once for fifty nodes rather than fifty times for one is the difference
  // between a complete run and a truncated one. Best-effort: a warm that fails
  // leaves `resolve` to fetch alone.
  const refsByAdapter = new Map<ReferenceAdapter, string[]>();
  for (const corr of options.correspondences) {
    const adapter = options.registry[corr.source];
    if (!adapter?.prefetch) continue;
    const refs = refsByAdapter.get(adapter) ?? [];
    refs.push(...(corr.refs ? corr.refs.map((v) => v.ref) : [corr.ref]));
    refsByAdapter.set(adapter, refs);
  }
  for (const [adapter, refs] of refsByAdapter) {
    try {
      await adapter.prefetch?.(refs, ctx);
    } catch (err) {
      warnings.push(
        `${adapter.source}: prefetch failed (${err instanceof Error ? err.message : String(err)}) — ` +
          `references will be fetched one at a time`,
      );
    }
  }

  for (const corr of options.correspondences) {
    const result: ComponentResult = {
      code: corr.code,
      source: corr.source,
      status: "ok",
    };
    const slug = componentSlug(corr, codeCounts);
    slugByResult.set(result, slug);

    try {
      const adapter = options.registry[corr.source];
      if (!adapter) {
        result.status = "error";
        result.note = `no adapter registered for source '${corr.source}'`;
        warnings.push(`${corr.code}: ${result.note}`);
        results.push(result);
        continue;
      }

      // The reference side is resolved in THIS correspondence's units. Density
      // is the one per-component thing on the context, so it is rebuilt here
      // and used for every reference lookup this component makes — the first
      // resolve and the variant re-target below, which must agree or the
      // re-targeted node arrives scaled differently from the one it replaces.
      const refCtx =
        corr.density === undefined ? ctx : { ...ctx, density: corr.density };
      let reference = await resolveReference(adapter, corr, refCtx);
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

      // With both sides in hand, re-target the reference when the candidate
      // says it is a different variant than the one the map points at (#296).
      const better = await preferMatchingVariant(
        adapter,
        reference,
        candidate,
        corr.code,
        refCtx,
      );
      if (better) {
        reference = better;
        result.reference = reference;
      }

      // A component can declare its spec tokens via a committed DTCG file
      // (design-map `tokensFile`, issue #89); merge them over whatever the
      // adapter resolved so a token-less source still has a spec to diff.
      const declared = options.referenceTokens?.get(
        specTokenKey(corr.code, corr.source),
      );
      if (declared)
        reference.tokens = mergeReferenceTokens(reference.tokens, declared);

      // Each component writes into its own subdir so triptychs (keyed only by
      // image variant) and the HTML page don't collide across components (#49),
      // nor across sources when one code is diffed against several (#106).
      const componentOutDir = options.outDir
        ? join(options.outDir, slug)
        : undefined;

      // Renderer-native findings (daemon path) supersede the default checks
      // for this component (issue #43); the parity diff itself is unchanged.
      const native = await options.nativeChecks?.(corr.code, ctx);
      const knownDifferences = options.knownDifferences?.get(
        specTokenKey(corr.code, corr.source),
      );
      const diffOptions = {
        repoRoot: options.repoRoot,
        ...(componentOutDir ? { outDir: componentOutDir } : {}),
        ...(options.diffConfig ? { config: options.diffConfig } : {}),
        ...(knownDifferences ? { knownDifferences } : {}),
        ...(options.tokenAlias ? { tokenAlias: options.tokenAlias } : {}),
        ...(native ? { checks: nativeChecksProvider(native) } : {}),
      };
      const { verdict, summary, triptychs, acceptances } = await diff(
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
      if (acceptances) result.acceptances = acceptances;
      if (deduped.length !== verdict.findings.length) {
        verdict.findings = deduped;
        verdict.status = verdictStatus(deduped);
        result.summary =
          renderSummary(verdict) + renderAcceptanceSummary(acceptances ?? {});
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
          ...(acceptances ? { acceptances } : {}),
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
  let indexEntries: IndexEntry[] | undefined;
  if (options.outDir) {
    const entries: IndexEntry[] = results.map((r) => {
      const thumbnail = r.candidate
        ? inlineCandidateThumb(options.repoRoot, r.candidate)
        : undefined;
      const slug = slugByResult.get(r);
      return {
        code: r.code,
        ...(r.source ? { source: r.source } : {}),
        status:
          r.verdict?.status ?? (r.status === "error" ? "error" : "skipped"),
        ...(r.reportPath && slug ? { reportPath: `${slug}/report.html` } : {}),
        ...(thumbnail ? { thumbnail } : {}),
      };
    });
    const { readme, html } = renderIndex({ entries, ...options.index });
    await mkdir(options.outDir, { recursive: true });
    await writeFile(join(options.outDir, "README.md"), readme);
    await writeFile(join(options.outDir, "index.html"), html);
    indexEntries = entries;

    // The findings, in a shape something other than a human can read.
    //
    // `run.json` beside this carries the verdict SUMMARY — code, source, status, where the report
    // is — and the findings themselves have only ever existed inside `report-html`'s inlined page.
    // That page is the right artifact for a pull request and the wrong one for anything
    // downstream: a preview server showing the same comparison cannot open an HTML file and read
    // the sentences back out of it.
    //
    // Anchors are derived by `@design-parity/catalog-export`, deliberately rather than a second
    // time here. `report-html`'s overlay matches a layout finding to a node by label; a second
    // matcher would let the report and the server disagree about which element a finding is
    // about, which is the one disagreement neither of them could show you.
    await writeParityFindings(options.outDir, results);
  }

  const blocked =
    directionPolicy(options.direction).blocksPr && status === "fail";
  return {
    status,
    blocked,
    direction: options.direction,
    results,
    warnings,
    ...(indexEntries ? { indexEntries } : {}),
  };
}

/**
 * Write the run's findings as `compose-preview-parity-findings/v1`, or nothing when there are none.
 *
 * Two things this deliberately does NOT fill in, both because a run cannot know them:
 *
 * - **`referenceId`.** Sets are unscoped. The serve/catalog reference id is minted by whoever
 *   writes `references/index.json`, which is the same reason `withReferenceAnnotations` takes its
 *   mapping from the caller. A publisher that resolves one can scope the set; unscoped means "this
 *   describes the render whichever reference it is read against", which is exactly right for the
 *   one-reference-per-preview case every consumer starts from.
 * - **`reportUrl`.** A run knows its `reportPath`, not the URL that path will be served from.
 *
 * Keyed by BOTH the candidate's preview id and the code handle: the two namespaces a consumer
 * might hold, and the same dual keying `buildAnnotationManifest` uses. Neither is the id a preview
 * server routes on — that is the catalog's sticker id, minted at publish — so a publisher re-keys.
 * Emitting both is what makes that join possible from either side.
 *
 * Nothing is written for a run whose components all passed: an empty manifest is a file a reader
 * has to open to learn it says nothing.
 */
async function writeParityFindings(
  outDir: string,
  results: readonly ComponentResult[],
): Promise<void> {
  const entries: ParityFindingsEntry[] = [];
  for (const result of results) {
    if (!result.verdict) continue;
    const previewIds = [result.candidate?.previewId, result.code].filter(
      (id): id is string => !!id && id.trim().length > 0,
    );
    if (previewIds.length === 0) continue;
    entries.push({
      previewIds,
      verdict: result.verdict,
      ...(result.candidate?.semantics
        ? { candidate: result.candidate.semantics }
        : {}),
      ...(result.reference?.layout
        ? { reference: result.reference.layout }
        : {}),
    });
  }
  const manifest = buildParityFindingsManifest(entries);
  if (isEmptyParityFindings(manifest)) return;
  await writeFile(
    join(outDir, PARITY_FINDINGS_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}
