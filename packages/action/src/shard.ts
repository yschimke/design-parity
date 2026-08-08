/**
 * Sharding: splitting one parity run across N parallel jobs, and putting the
 * pieces back together.
 *
 * The problem this exists for. A parity run costs roughly
 * `fixed + per_component × components` — the fixed part is the candidate render's
 * Gradle configure + compile plus the Node install, and the marginal part is one
 * reference fetch + diff per component. Past a few hundred components the
 * marginal part dominates and a single job walks into its own timeout. The
 * observed workaround has been to shrink the *input* — compare only the mapped
 * components, exclude the rest from the render (yschimke/m3-catalog#11) — which
 * buys time by giving up coverage, and has to be re-tuned by hand in the
 * consumer's workflow every time the catalog grows.
 *
 * Sharding buys the same time without giving up coverage: every shard compares a
 * disjoint slice of the SAME exhaustive component list, and {@link mergeShards}
 * unions the per-shard outputs into the artifact set one serial run would have
 * produced. Only the marginal cost divides — each shard pays the fixed cost in
 * full — so a handful of shards is the useful range and a large fleet is buying
 * setup time, not throughput. See `docs/PARALLEL_PARITY.md`.
 *
 * Everything here is pure: partitioning is arithmetic over a sorted list, and
 * merging is object/array algebra. Only the CLI touches disk.
 */
import type { IndexEntry } from "@design-parity/report-html";
import type { ResolvedDirection, VerdictStatus } from "@design-parity/core";

/**
 * The `shard.json` layout version, written by a sharded `run` and checked by
 * `merge`. Bumped only on an incompatible change; a reader ignores unknown
 * fields. The merge runs LAST — after every shard has spent its full budget —
 * so it validates loudly rather than silently producing a partial index.
 */
export const SHARD_FORMAT_VERSION = 1;

/** One shard's declaration of what it was responsible for and what it produced. */
export interface ShardReport {
  formatVersion: number;
  /** 1-based shard index. */
  index: number;
  /** Total shards in the run — identical across every shard of one run. */
  total: number;
  /**
   * The component handles this shard was assigned, in the order it ran them.
   * Cross-checked against its siblings by {@link verifyShardReports}: the union
   * must cover the whole list exactly once.
   */
  components: string[];
  direction: ResolvedDirection;
  status: VerdictStatus;
  blocked: boolean;
  warnings: string[];
  /**
   * The landing-page rows this shard's components produced, carrying their
   * `reportPath` (relative to the shard's out dir, which merge preserves) and
   * inlined thumbnail. Merge unions these rather than re-deriving them, so the
   * merged index is byte-identical to the serial one for the same inputs.
   */
  entries: IndexEntry[];
}

/** A shard selection, as parsed from `--shard <index>/<total>`. */
export interface ShardSelector {
  index: number;
  total: number;
}

/**
 * Parse `--shard 2/6` (also accepts `2:6`). Returns `undefined` for input that
 * isn't a shard selector at all; throws for a selector that is malformed or out
 * of range, because a typo'd shard silently comparing everything (or nothing) is
 * worse than a failed run.
 */
export function parseShard(value: string | undefined): ShardSelector | undefined {
  if (!value) return undefined;
  const m = /^(\d+)\s*[/:]\s*(\d+)$/.exec(value.trim());
  if (!m) throw new Error(`--shard expects <index>/<total>, got '${value}'`);
  const index = Number(m[1]);
  const total = Number(m[2]);
  if (total < 1) throw new Error(`--shard total must be >= 1, got ${total}`);
  if (index < 1 || index > total) {
    throw new Error(`--shard index ${index} is outside 1..${total}`);
  }
  return { index, total };
}

/**
 * This shard's slice of `components`.
 *
 * Sort, then round-robin: shard `i` of `n` takes every element at position
 * `p` where `p % n === i - 1`. Deterministic from the component list alone, so
 * every shard derives the same partition independently — there is no serial
 * "plan once, then fan out" prefix, which would cost a full setup before any
 * shard began.
 *
 * Round-robin, not contiguous blocks, because component ids sort by path and a
 * contiguous block is therefore one directory: the slowest components (a screen
 * with many variants) cluster, and the block holding them becomes the straggler
 * every run. Interleaving spreads them.
 *
 * With more shards than components the tail shards get an empty slice. That is a
 * legitimate no-op, not an error — the caller skips the run rather than failing.
 */
export function partitionComponents(
  components: readonly string[],
  { index, total }: ShardSelector,
): string[] {
  const sorted = [...new Set(components)].sort();
  return sorted.filter((_, position) => position % total === index - 1);
}

/**
 * Cross-check the shard reports BEFORE trusting them.
 *
 * Each shard derived its partition independently from the same list, so they
 * agree by construction. If they ever don't — a shard checked out a different
 * commit, a `--shard` typo, a lost upload — the symptom downstream is a merged
 * index quietly missing components, with nothing pointing at the shards. So the
 * disagreement is caught here, where it can name itself.
 *
 * Returns the problems found (empty when sound) rather than throwing, so a
 * caller can report all of them at once.
 */
export function verifyShardReports(reports: readonly ShardReport[]): string[] {
  const problems: string[] = [];
  if (reports.length === 0) return ["no shard reports were supplied"];

  for (const r of reports) {
    if (r.formatVersion !== SHARD_FORMAT_VERSION) {
      problems.push(
        `shard ${r.index}: shard.json formatVersion ${r.formatVersion} is not the ` +
          `${SHARD_FORMAT_VERSION} this merge understands — align the design-parity ` +
          `version used by the shard and merge steps`,
      );
    }
  }

  const totals = new Set(reports.map((r) => r.total));
  if (totals.size > 1) {
    problems.push(
      `shards disagree on the run size: saw totals ${[...totals].sort((a, b) => a - b).join(", ")}`,
    );
  }

  const seen = new Map<number, number>();
  for (const r of reports) seen.set(r.index, (seen.get(r.index) ?? 0) + 1);
  for (const [index, count] of seen) {
    if (count > 1) problems.push(`shard ${index} was supplied ${count} times`);
  }

  // A missing shard is the failure mode that matters most: its components would
  // simply be absent from the merged index, which reads as "clean" rather than
  // "not checked".
  const total = reports[0]?.total ?? 0;
  if (totals.size === 1) {
    const missing = [];
    for (let i = 1; i <= total; i++) if (!seen.has(i)) missing.push(i);
    if (missing.length > 0) {
      problems.push(`shard(s) ${missing.join(", ")} of ${total} did not report`);
    }
  }

  const owner = new Map<string, number>();
  for (const r of reports) {
    for (const code of r.components) {
      const prior = owner.get(code);
      if (prior !== undefined) {
        problems.push(`component '${code}' was claimed by shards ${prior} and ${r.index}`);
        continue;
      }
      owner.set(code, r.index);
    }
  }

  return problems;
}

/** The union of a run's shards: what a single serial run would have produced. */
export interface MergedShards {
  direction: ResolvedDirection;
  status: VerdictStatus;
  blocked: boolean;
  warnings: string[];
  /** Landing-page rows across every shard, in component order. */
  entries: IndexEntry[];
  /** Total shards declared, for the merge log. */
  total: number;
}

function worst(a: VerdictStatus, b: VerdictStatus): VerdictStatus {
  const rank = { pass: 0, warn: 1, fail: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Union the shard reports into one.
 *
 * Status is the worst across shards and `blocked` is the OR — a failure in any
 * slice is a failure of the run, exactly as it would be serially. Entries are
 * re-sorted by component handle so the merged index has one stable order
 * regardless of which shard finished first (shards run concurrently; artifact
 * download order is not a contract). Warnings are concatenated in shard order
 * and de-duplicated: a warning about a shared input (a bad `tokensFile`, a
 * design-map issue) is emitted by every shard that loaded it, and a landing page
 * listing it six times is noise, not information.
 *
 * Direction comes from the shards, which must agree — they read the same
 * committed `.design-parity.json`, so a disagreement means they ran against
 * different commits and the merged verdict would be meaningless.
 */
export function mergeShards(reports: readonly ShardReport[]): MergedShards {
  if (reports.length === 0) throw new Error("nothing to merge: no shard reports");

  const directions = new Set(reports.map((r) => r.direction));
  if (directions.size > 1) {
    throw new Error(
      `shards disagree on the parity direction (${[...directions].join(", ")}) — ` +
        `they did not run against the same commit`,
    );
  }

  const ordered = [...reports].sort((a, b) => a.index - b.index);
  const warnings: string[] = [];
  const seenWarning = new Set<string>();
  let status: VerdictStatus = "pass";
  let blocked = false;
  const entries: IndexEntry[] = [];

  for (const r of ordered) {
    status = worst(status, r.status);
    blocked ||= r.blocked;
    entries.push(...r.entries);
    for (const w of r.warnings) {
      if (seenWarning.has(w)) continue;
      seenWarning.add(w);
      warnings.push(w);
    }
  }

  entries.sort((a, b) => a.code.localeCompare(b.code));

  return {
    direction: ordered[0]!.direction,
    status,
    blocked,
    warnings,
    entries,
    total: ordered[0]!.total,
  };
}
