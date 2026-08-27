#!/usr/bin/env node
/**
 * Snapshot the conformance corpus from a `compose-ai-tools` checkout.
 *
 * Thin wrapper: the archive is built by `vendor-archive.mjs`, which the engine sync also uses, so
 * the corpus and the engine cannot be snapshotted from different revisions. Prefer running
 * `sync-known-differences-vendor.mjs` — it does both at one verified commit and records it.
 *
 *   node packages/diff/test/sync-known-differences-fixtures.mjs <compose-ai-tools-checkout> [ref]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildFixtureArchive } from "./vendor-archive.mjs";

const checkout = process.argv[2];
const ref = process.argv[3] ?? "origin/main";
if (!checkout) {
  process.stderr.write(
    "usage: node packages/diff/test/sync-known-differences-fixtures.mjs <compose-ai-tools-checkout> [ref]\n",
  );
  process.exit(2);
}

const commit = execFileSync("git", ["-C", checkout, "rev-parse", ref], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}).trim();
const output = fileURLToPath(new URL("fixtures/known-differences.zip", import.meta.url));
const { bytes, fileCount } = buildFixtureArchive(checkout, commit);
writeFileSync(output, bytes);
console.log(`wrote ${output} (${fileCount} canonical files from ${commit})`);
