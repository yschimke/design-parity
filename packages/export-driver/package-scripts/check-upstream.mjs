#!/usr/bin/env node
/**
 * Compare this package's driver files with compose-ai-tools' `scripts/design-artifacts/`.
 *
 *   node packages/export-driver/package-scripts/check-upstream.mjs <compose-ai-tools-checkout> [ref]
 *
 * This package is the driver's source; compose-ai-tools keeps an older, frozen copy that its
 * workflow runs until it switches to this package. This lists how that copy differs: files changed
 * since, files only on one side. `package.json` and `package-lock.json` are each side's own and are
 * not compared, and the package's own `bin/`, `package-scripts/` and `README.md` are expected here
 * only. Exits 1 if there is any difference, so a caller can tell an identical copy from a stale one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM_DIR = "scripts/design-artifacts";
const UPSTREAM_ONLY = new Set(["package.json", "package-lock.json"]);
const PACKAGE_ONLY = ["bin/", "package-scripts/", "README.md", "package.json"];

const [checkout, ref = "origin/main"] = process.argv.slice(2);
if (!checkout) {
  process.stderr.write("usage: check-upstream.mjs <compose-ai-tools-checkout> [ref]\n");
  process.exit(2);
}
const git = (...args) =>
  execFileSync("git", ["-C", checkout, ...args], { maxBuffer: 256 * 1024 * 1024 });

const upstream = git("ls-tree", "-r", "--name-only", ref, `${UPSTREAM_DIR}/`)
  .toString("utf8")
  .split("\n")
  .filter(Boolean)
  .map((path) => path.slice(UPSTREAM_DIR.length + 1))
  .filter((path) => !UPSTREAM_ONLY.has(path));

const local = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(full).isDirectory()) walk(full);
    else local.push(relative(ROOT, full).split("\\").join("/"));
  }
};
walk(ROOT);

const problems = [];
const localSet = new Set(local);
for (const path of upstream) {
  if (!localSet.has(path)) {
    problems.push(`missing here: ${path}`);
    continue;
  }
  const theirs = git("show", `${ref}:${UPSTREAM_DIR}/${path}`);
  if (!theirs.equals(readFileSync(join(ROOT, path)))) problems.push(`differs: ${path}`);
}
const upstreamSet = new Set(upstream);
for (const path of local) {
  if (upstreamSet.has(path) || PACKAGE_ONLY.some((own) => path === own || path.startsWith(own))) continue;
  problems.push(`not in compose-ai-tools: ${path}`);
}

const commit = git("rev-parse", "--short", ref).toString("utf8").trim();
if (problems.length > 0) {
  process.stderr.write(`${problems.length} difference(s) from compose-ai-tools ${commit}:\n`);
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}
process.stdout.write(`${upstream.length} files match compose-ai-tools ${commit}\n`);
