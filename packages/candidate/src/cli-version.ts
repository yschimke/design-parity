/**
 * Version handshake with the upstream `compose-preview` CLI.
 *
 * The candidate side is driven by a binary this repo does not build, ship, or
 * version. We depend on two things it can change independently: the shape of
 * `compose-preview show --json`, and the meaning of its exit codes (`0` ok,
 * `1` build, `2` render, `3` none — see `SpawnComposePreviewCli.render`). Until
 * now nothing checked either: `ensureInstalled()` ran `--version` purely as a
 * liveness probe and threw the output away, so a CLI too old to speak the
 * contract failed later as a JSON parse error, which reads like a bug in this
 * package rather than "your compose-preview is out of date".
 *
 * This module keeps the check tiny and dependency-free. It is deliberately not
 * a general semver implementation: `compose-preview` publishes plain
 * `MAJOR.MINOR.PATCH` release tags, plus `-SNAPSHOT` builds from source.
 */

/** A parsed `MAJOR.MINOR.PATCH`, with any prerelease/build suffix dropped. */
export interface CliVersion {
  major: number;
  minor: number;
  patch: number;
  /** The exact string parsed out, e.g. `"0.19.50-SNAPSHOT"`. */
  raw: string;
}

/**
 * Oldest `compose-preview` this wrapper claims to work with.
 *
 * **Deliberately low, and evidence-based rather than aspirational.** 0.14.0 is
 * the oldest version this package has any record of running against (the canned
 * `--version` in `test/candidate.test.ts`, there since the suite was written).
 * It is a floor against a genuinely ancient binary, not a claim that 0.14.0 is
 * the first version that works.
 *
 * Resist raising this without a concrete reason. The repo's docs mention newer
 * versions — `docs/candidate-sources.md` names v0.15.2 for `compose/theme
 * .consumers` schema v2, `docs/PARALLEL_PARITY.md` names 0.19.45 for `--id`
 * scoping — but both are *preferences with documented fallbacks*, not
 * requirements, so neither justifies locking anyone out. A floor asserted
 * without evidence is the same version-coupling this guard exists to catch: it
 * turns someone's working setup into a hard failure over a guess.
 *
 * When something here does start requiring a newer CLI, raise this and say what
 * broke in the same commit.
 */
export const MINIMUM_COMPOSE_PREVIEW_VERSION = "0.14.0";

/**
 * Parse `compose-preview --version` output. The CLI prints
 * `compose-preview <version>` on one line; we accept a bare version too, and
 * tolerate extra lines so an added banner doesn't break the probe.
 *
 * Returns `null` when no version-shaped token is present — a locally built or
 * wrapped binary, which callers treat as "unknown, proceed" rather than a hard
 * failure. Refusing to run against something we merely failed to parse would
 * turn a cosmetic output change upstream into an outage here.
 */
export function parseCliVersion(stdout: string): CliVersion | null {
  const match = /(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?/.exec(stdout);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: match[0],
  };
}

/** Negative if `a < b`, zero if equal, positive if `a > b`. Ignores suffixes. */
export function compareCliVersions(a: CliVersion, b: CliVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * True when [version] is older than [minimum].
 *
 * A `-SNAPSHOT` of the minimum counts as satisfying it: those are built from
 * source at or ahead of the release they are named for, and treating them as
 * too old would block anyone developing against a local compose-ai-tools
 * checkout — exactly the people most likely to be running this.
 */
export function isBelowMinimum(
  version: CliVersion,
  minimum: string = MINIMUM_COMPOSE_PREVIEW_VERSION,
): boolean {
  const floor = parseCliVersion(minimum);
  if (!floor) return false;
  return compareCliVersions(version, floor) < 0;
}
