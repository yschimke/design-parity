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
  Finding,
  ResolvedDirection,
  Verdict,
  VerdictStatus,
} from "@design-parity/core";
import {
  diff,
  type ChecksProvider,
  type DiffConfig,
  type Triptych,
} from "@design-parity/diff";
import { directionPolicy } from "@design-parity/policy";

import type { AdapterRegistry } from "./registry.js";

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
}

/** Wrap precomputed native findings as a {@link ChecksProvider} for the diff. */
function nativeChecksProvider(findings: Finding[]): ChecksProvider {
  return { run: () => findings };
}

export type ComponentStatus = "ok" | "skipped" | "error";

export interface ComponentResult {
  code: string;
  source?: DesignSource;
  status: ComponentStatus;
  reference?: DesignReference;
  verdict?: Verdict;
  summary?: string;
  triptychs?: Triptych[];
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

      const reference = await adapter.resolve(corr.code, corr.ref, ctx);
      result.reference = reference;

      const candidate = await options.candidate(corr.code, ctx);
      if (!candidate) {
        result.status = "skipped";
        result.note = "no candidate render available";
        warnings.push(`${corr.code}: ${result.note}`);
        results.push(result);
        continue;
      }

      // Renderer-native findings (daemon path) supersede the default checks
      // for this component (issue #43); the parity diff itself is unchanged.
      const native = await options.nativeChecks?.(corr.code, ctx);
      const diffOptions = {
        repoRoot: options.repoRoot,
        ...(options.outDir ? { outDir: options.outDir } : {}),
        ...(options.diffConfig ? { config: options.diffConfig } : {}),
        ...(native ? { checks: nativeChecksProvider(native) } : {}),
      };
      const { verdict, summary, triptychs } = await diff(
        reference,
        candidate,
        diffOptions,
      );
      result.verdict = verdict;
      result.summary = summary;
      result.triptychs = triptychs;
      status = worst(status, verdict.status);
    } catch (err) {
      // Fail soft: surface, never throw, never escalate overall status.
      result.status = "error";
      result.note = (err as Error).message;
      warnings.push(`${corr.code}: ${result.note}`);
    }

    results.push(result);
  }

  const blocked = directionPolicy(options.direction).blocksPr && status === "fail";
  return { status, blocked, direction: options.direction, results, warnings };
}
