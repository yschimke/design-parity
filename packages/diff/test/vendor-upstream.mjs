/**
 * Whether a git remote URL names the official upstream repository.
 *
 * Its own module so it can be tested directly: the sync script runs its work at import time, so a
 * predicate living there is unreachable from a test — and this one decides whether a provenance
 * record's central claim is earned.
 */
export const UPSTREAM_SLUG = "yschimke/compose-ai-tools";
export const UPSTREAM_HOST = "github.com";

/**
 * Does this remote URL name the official upstream repository?
 *
 * Matching the path suffix alone is not enough, and that is not theoretical: the first version of
 * this check accepted `https://evil.example/yschimke/compose-ai-tools.git`, and any local path
 * ending in those two segments. Reachability then proves only that the commit exists on *that*
 * remote, so the sync would bless bytes never landed in the real repository while writing a
 * provenance record that looks fully verified — the exact conclusion this check exists to earn.
 *
 * So the host is part of the identity. Both shapes git actually uses are accepted and nothing else:
 * `git@github.com:owner/repo`, and any scheme URL whose host is *exactly* `github.com` — parsed
 * rather than pattern-matched, so a lookalike like `github.com.evil.example` does not slip through.
 */
export const namesUpstream = (url) => {
  const trimmed = url.trim().replace(/\/$/, "").replace(/\.git$/, "");
  const scp = /^[^/]+@([^:]+):(.+)$/.exec(trimmed);
  if (scp) return scp[1] === UPSTREAM_HOST && scp[2] === UPSTREAM_SLUG;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return parsed.hostname === UPSTREAM_HOST && parsed.pathname.replace(/^\//, "") === UPSTREAM_SLUG;
};
