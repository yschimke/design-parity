/**
 * Build the conformance corpus archive from a pinned upstream commit.
 *
 * Shared by both sync scripts so the engine and the corpus cannot be snapshotted from different
 * revisions — which is the failure this whole provenance effort is about, and which had already
 * happened in the small: `fixtures/known-differences.md` documented a commit and a digest that no
 * longer described the archive committed beside it.
 *
 * Files are read with `git show`, not off the working tree, for the same reason the vendored
 * modules are: a dirty or stale checkout must not be mistakable for a released upstream state.
 * The archive is built with a fixed epoch and no compression variance so the digest is a function
 * of the corpus alone.
 */
import { execFileSync } from "node:child_process";

import { zipSync } from "fflate";

export const FIXTURE_DIR = "scripts/design-artifacts/fixtures/known-differences";

const EPOCH = new Date("1980-01-01T00:00:00Z");

export function buildFixtureArchive(checkout, commit) {
  const git = (args, encoding) =>
    execFileSync("git", ["-C", checkout, ...args], {
      encoding,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });

  // Order matters: `zipSync` writes entries in insertion order, so the archive digest is a
  // function of it. The original snapshot walked the tree recursively, sorting each directory's
  // entries and descending inline — which orders paths **segment by segment**, not by their full
  // string. (`a/b` vs `a-c/d` differ between the two, and a flat `.sort()` here would silently
  // produce a different archive for an identical corpus.) Compare segments to reproduce it.
  const names = git(["ls-tree", "-r", "--name-only", commit, "--", FIXTURE_DIR], "utf8")
    .split("\n")
    .filter(Boolean)
    .sort((left, right) => {
      const a = left.split("/");
      const b = right.split("/");
      for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
      }
      return a.length - b.length;
    });

  const entries = Object.create(null);
  for (const path of names) {
    entries[path.slice(FIXTURE_DIR.length + 1)] = [
      new Uint8Array(git(["show", `${commit}:${path}`], null)),
      { mtime: EPOCH },
    ];
  }
  return { bytes: zipSync(entries, { level: 9, mtime: EPOCH }), fileCount: names.length };
}
