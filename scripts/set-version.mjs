#!/usr/bin/env node
/**
 * Set a single shared version across every workspace package and rewrite all
 * internal dependency ranges to match — the one source of truth for releasing
 * the `@design-parity/*` scope (and the top-level `design-parity` CLI) so the
 * whole monorepo publishes at one version.
 *
 *   node scripts/set-version.mjs 0.2.0
 *
 * What it does:
 *   - reads every workspace package.json (the `workspaces` globs in the root),
 *   - sets each package's `version` to <version> (skipping nothing — the
 *     private root stays private but is kept in sync for tidiness),
 *   - rewrites every dependency / devDependency / peerDependency whose name is
 *     an in-repo package to `^<version>` (was `*` or a pinned `0.0.0`),
 *   - leaves third-party ranges untouched.
 *
 * Run it, commit the result, tag `v<version>`; the release workflow publishes.
 */
import { existsSync, readFileSync, writeFileSync, globSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: node scripts/set-version.mjs <semver>   (e.g. 0.2.0)");
  process.exit(2);
}

const rootPkgPath = join(root, "package.json");
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));

// Resolve workspace package.json paths from the root `workspaces` globs.
const pkgPaths = [rootPkgPath];
for (const pattern of rootPkg.workspaces ?? []) {
  for (const dir of globSync(pattern, { cwd: root })) {
    const candidate = join(root, dir, "package.json");
    // `packages/*` also matches the `adapters/` container, which has no
    // package.json — skip anything that isn't an actual workspace package.
    if (existsSync(candidate)) pkgPaths.push(candidate);
  }
}

// First pass: collect the names of every in-repo package.
const internal = new Set();
const pkgs = [];
for (const path of pkgPaths) {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  internal.add(pkg.name);
  pkgs.push({ path, pkg });
}

const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies"];

// Second pass: set version + rewrite internal ranges.
for (const { path, pkg } of pkgs) {
  pkg.version = version;
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (internal.has(name)) deps[name] = `^${version}`;
    }
  }
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`set ${pkg.name} -> ${version}`);
}
