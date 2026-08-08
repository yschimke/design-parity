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

/**
 * The rows to carry into this run's board: everything the previous run had that
 * this one did not produce.
 *
 * `carriedFrom` records the commit the row was actually measured at, and is
 * preserved rather than overwritten when a row is carried more than once — so a
 * row that has gone unrefreshed for ten runs still says so, instead of looking
 * one run old forever.
 */
export function carryForward(
  fresh: readonly IndexEntry[],
  previous: RunManifest | undefined,
): IndexEntry[] {
  if (!previous) return [];
  const have = new Set(fresh.map((e) => e.code));
  const carried: IndexEntry[] = [];
  for (const entry of previous.entries) {
    if (have.has(entry.code)) continue;
    const from = entry.carriedFrom ?? previous.sourceCommit;
    carried.push({ ...entry, ...(from ? { carriedFrom: from } : {}) });
  }
  return carried;
}
