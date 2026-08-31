/**
 * `run.json` — the machine-readable summary a published run leaves behind, so
 * the next run can build on it instead of starting from nothing.
 *
 * The branch already carries `index.html` and `README.md`, but both are for
 * people: recovering the rows from them means parsing rendered HTML. This is
 * the same information in the form the next merge needs (design-parity#289).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { IndexEntry } from "@design-parity/report-html";

import type { ResolvedDirection, VerdictStatus } from "@design-parity/core";

/** Bumped when a field's meaning changes; an unknown version is ignored, not guessed at. */
export const RUN_MANIFEST_VERSION = 1;

export const RUN_MANIFEST_FILE = "run.json";

export interface RunManifest {
  formatVersion: number;
  /** The commit the run was made from. Identifies the age of a carried row. */
  sourceCommit?: string;
  direction: ResolvedDirection;
  status: VerdictStatus;
  blocked: boolean;
  /**
   * Digest of the inputs this run was derived from, when the caller supplied
   * one. A later run computing the same digest can stand on this board instead
   * of rebuilding it — see `cache.ts`.
   */
  cacheKey?: string;
  entries: IndexEntry[];
}

export async function writeRunManifest(
  outDir: string,
  manifest: RunManifest,
): Promise<void> {
  await writeFile(
    join(outDir, RUN_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

/**
 * Read a previous run's manifest, or `undefined` when there isn't a usable one.
 *
 * Deliberately forgiving: a missing, unreadable, malformed or
 * newer-than-understood manifest means "no previous run" — carry-forward is an
 * improvement on starting empty, never a reason to fail a run that otherwise
 * has everything it needs.
 */
export async function readRunManifest(
  dir: string,
): Promise<RunManifest | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(dir, RUN_MANIFEST_FILE), "utf8");
  } catch {
    return undefined;
  }
  try {
    const doc = JSON.parse(raw) as RunManifest;
    if (doc.formatVersion !== RUN_MANIFEST_VERSION) return undefined;
    if (!Array.isArray(doc.entries)) return undefined;
    return doc;
  } catch {
    return undefined;
  }
}

/** What {@link carryForward} decided about the previous run's rows. */
export interface CarriedRows {
  /** Rows to publish alongside this run's own, each dated by `carriedFrom`. */
  carried: IndexEntry[];
  /**
   * Codes dropped because the component universe no longer contains them.
   * Returned rather than logged here so the caller can say so in its summary —
   * a row leaving the board is worth a line, even when leaving is correct.
   */
  dropped: string[];
}

/**
 * The rows to carry into this run's board: everything the previous run had that
 * this one did not produce **and could still have produced**.
 *
 * `carriedFrom` records the commit the row was actually measured at, and is
 * preserved rather than overwritten when a row is carried more than once — so a
 * row that has gone unrefreshed for ten runs still says so, instead of looking
 * one run old forever.
 *
 * WHY `universe` EXISTS. Carry-forward answers "this run could not refresh the
 * row", and for a transient miss — a rate limit, a source briefly unreachable —
 * that is right: the component is still in the map and the next run will pick it
 * up. But a component that has been renamed, moved between modules or deleted is
 * not a miss. It will never appear in a run again, so there is no next run to
 * refresh it, and carrying it forward pins it to the board permanently: the row
 * is republished verbatim on every subsequent run, dated to a commit that
 * recedes forever, describing a handle no source file has.
 *
 * That is not hypothetical. `wear-m3-catalog`'s Remote sheet published 40 rows
 * for months — 19 real ones plus 21 frozen duplicates left over from before its
 * module prefix was corrected, byte-identical across every run
 * (yschimke/compose-ai-tools#4878).
 *
 * So `universe` is the current `design-map.json`: every component that still
 * exists to be compared. A previous row still in it was missed and is carried; a
 * row absent from it is gone from the map and is let go.
 *
 * It must be the MAP, never the set of components the run compared. A run
 * narrowed with `--components` compares a subset on purpose, and bounding by
 * what it compared would read every component it deliberately skipped as deleted
 * and strip the board down to that slice.
 *
 * Omitting `universe` keeps the old unconditional behaviour, and a caller that
 * cannot name the map with certainty should omit it: carrying a stale row is a
 * cosmetic wart, dropping a live one loses the last verdict anybody had.
 */
export function carryForward(
  fresh: readonly IndexEntry[],
  previous: RunManifest | undefined,
  universe?: Iterable<string>,
): CarriedRows {
  if (!previous) return { carried: [], dropped: [] };
  const have = new Set(fresh.map((e) => e.code));
  const known = universe ? new Set(universe) : undefined;
  const carried: IndexEntry[] = [];
  const dropped: string[] = [];
  for (const entry of previous.entries) {
    if (have.has(entry.code)) continue;
    if (known && !known.has(entry.code)) {
      dropped.push(entry.code);
      continue;
    }
    const from = entry.carriedFrom ?? previous.sourceCommit;
    carried.push({ ...entry, ...(from ? { carriedFrom: from } : {}) });
  }
  return { carried, dropped };
}
