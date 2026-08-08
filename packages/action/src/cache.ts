/**
 * Deciding that a run would produce the board that is already published.
 *
 * A parity run is a pure function of a handful of inputs: the code being
 * rendered, the renderer, the references, the map joining them, the policy, and
 * the tool itself. When none of those moved, the comparison cannot have moved
 * either — and re-deriving it costs a full render plus a reference fetch to
 * arrive back where the branch already is.
 *
 * This module is only the arithmetic: hash the ingredients, compare against
 * what the last run recorded. WHICH ingredients belong in the hash is the
 * caller's business, because they are environment-shaped (a git tree hash, a
 * pinned renderer version, a Figma file version, the runner image). Keeping
 * that out here is deliberate: this stays testable, and a caller that forgets
 * an ingredient gets a stale skip rather than a mysterious one — which is why
 * {@link decideSkip} refuses in every case it is not certain about.
 */
import { createHash } from "node:crypto";

import type { RunManifest } from "./run-manifest.js";

/**
 * A stable digest of the named inputs.
 *
 * Order-independent (the parts are sorted) and self-delimiting (lengths are
 * encoded), so `{a: "b:c"}` and `{"a:b": "c"}` cannot collide into the same
 * key and a caller reordering its parts does not invalidate every cache.
 */
export function computeCacheKey(parts: Readonly<Record<string, string>>): string {
  const h = createHash("sha256");
  for (const name of Object.keys(parts).sort()) {
    const value = parts[name] ?? "";
    h.update(`${name.length}:${name}=${value.length}:${value}\n`);
  }
  return h.digest("hex");
}

export interface SkipDecision {
  skip: boolean;
  /** Why, in one clause — printed by the CLI and surfaced in the job log. */
  reason: string;
  /** The stored verdict, when skipping: a run that skips still applies it. */
  blocked?: boolean;
}

export interface SkipInputs {
  previous: RunManifest | undefined;
  key: string;
  /** Refresh regardless — a scheduled sweep, or a human overriding. */
  force?: boolean;
}

/**
 * Whether this run can stand on the published board instead of rebuilding it.
 *
 * Every "no" is deliberate:
 *
 * - **No previous board, or no key stored on it.** Nothing to stand on.
 * - **A different key.** Something in the inputs moved.
 * - **`force`.** Inputs that are not in the key — the runner image, fonts, a
 *   renderer's own transitive deps — can still drift, so a caller must always
 *   be able to say "ignore all this and look again". A scheduled unconditional
 *   run is the intended companion to caching, not an optional extra.
 * - **A partial previous board.** If any row was carried forward rather than
 *   refreshed, it is stale BY CONSTRUCTION, and skipping would preserve it
 *   untouched for as long as the inputs hold still. A partial board is exactly
 *   the state that most needs another attempt.
 */
export function decideSkip({ previous, key, force }: SkipInputs): SkipDecision {
  if (force) return { skip: false, reason: "forced" };
  if (!previous) return { skip: false, reason: "no previous run to build on" };
  if (!previous.cacheKey) {
    return { skip: false, reason: "the previous run recorded no cache key" };
  }
  if (previous.cacheKey !== key) {
    return { skip: false, reason: "inputs changed since the previous run" };
  }
  const carried = previous.entries.filter((e) => e.carriedFrom).length;
  if (carried > 0) {
    return {
      skip: false,
      reason: `the previous board is partial (${carried} row(s) carried forward)`,
    };
  }
  return {
    skip: true,
    reason: "inputs unchanged since the previous run",
    blocked: previous.blocked,
  };
}
