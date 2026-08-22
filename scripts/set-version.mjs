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
 *   - rewrites every internal dependency / devDependency to EXACTLY <version>,
 *     and every internal peerDependency to `^<version>`,
 *   - leaves third-party ranges untouched.
 *
 * Why exact and not `^`: the whole scope publishes at one version in one run,
 * so a caret range buys nothing a consumer wants and costs the thing this repo
 * cares most about — knowing which code ran. `npx design-parity@0.1.57` would
 * happily resolve `@design-parity/action` to a later 0.1.x, so the launcher
 * version a caller pinned, a lockfile recorded, or the parity workflow hashed
 * into its cache key named the launcher and not the tree behind it. Exact
 * ranges make the version a consumer asks for the version they get.
 *
 * The cost is deliberate: a partial publish (the release loop tolerates one
 * package failing) leaves a version that will not install at all, rather than
 * one that installs a mixed-version tree and misbehaves quietly. Loud beats
 * silent — rerun the publish, or dispatch release.yml with the tag.
 *
 * A peerDependency stays `^`: a peer range exists to be satisfiable by whatever
 * the consumer already resolved, and pinning it turns a compatible tree into a
 * conflict. There are none in the repo today; the rule is here so adding one
 * does not silently inherit the wrong shape.
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

// An internal range is exact everywhere the consumer's install resolves it, and
// `^` only where a range is meant to be satisfied by someone else's tree. See
// the header for why.
const EXACT_FIELDS = ["dependencies", "devDependencies"];
const CARET_FIELDS = ["peerDependencies"];

// Second pass: set version + rewrite internal ranges.
for (const { path, pkg } of pkgs) {
  pkg.version = version;
  for (const [fields, range] of [
    [EXACT_FIELDS, version],
    [CARET_FIELDS, `^${version}`],
  ]) {
    for (const field of fields) {
      const deps = pkg[field];
      if (!deps) continue;
      for (const name of Object.keys(deps)) {
        if (internal.has(name)) deps[name] = range;
      }
    }
  }
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`set ${pkg.name} -> ${version}`);
}
