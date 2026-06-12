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
  ResolvedDirection,
  Verdict,
  VerdictStatus,
} from "@design-parity/core";
import { diff, type DiffConfig, type Triptych } from "@design-parity/diff";
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
  /** Concrete direction (already resolved from `.design-parity.json`). */
  direction: ResolvedDirection;
  /** Where triptych PNGs are written (optional). */
  outDir?: string;
  diffConfig?: Partial<DiffConfig>;
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

      const diffOptions = {
        repoRoot: options.repoRoot,
        ...(options.outDir ? { outDir: options.outDir } : {}),
        ...(options.diffConfig ? { config: options.diffConfig } : {}),
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
