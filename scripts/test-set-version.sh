#!/usr/bin/env bash
# Guard what `set-version` writes into the published manifests.
#
# The release job runs `npm run set-version <root version>` in the runner's tree
# and publishes the result, so this script decides what every consumer's install
# resolves. Nothing else asserts it: the checked-in package.json files still read
# the last version anyone ran it with, `npm test` never invokes it, and the shape
# it writes is only observable on npm after the fact.
#
# What it must write is EXACT internal ranges. The whole scope publishes at one
# version in one run, so a caret buys a consumer nothing and costs the thing this
# repo cares most about: `npx design-parity@0.1.57` resolving `@design-parity/*`
# to a later 0.1.x means the version a caller pinned — or the parity workflow
# hashed into its cache key — named the launcher, not the tree behind it.
#
# Runs the real script over the real workspace set, in a copy, so a package added
# without going through `set-version` is caught too.
#
#   scripts/test-set-version.sh

set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=9.9.9

fail=0
bad() { printf '✗ %s\n' "$1"; fail=1; }
ok() { printf '✓ %s\n' "$1"; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The script resolves the repo from its own location, not from cwd, so the copy
# needs the same shape: a root package.json, the workspace manifests, the script.
workspaces="$(node -p "
  const {globSync, existsSync} = require('node:fs');
  (require('${root}/package.json').workspaces ?? [])
    .flatMap(p => globSync(p, {cwd: '${root}'}))
    .filter(d => existsSync('${root}/' + d + '/package.json'))
    .join('\n')
")"
if [ -z "$workspaces" ]; then
  bad "found no workspaces to check — the globs in package.json changed shape"
  exit 1
fi

mkdir -p "$tmp/scripts"
cp "$root/scripts/set-version.mjs" "$tmp/scripts/"
cp "$root/package.json" "$tmp/"
while IFS= read -r ws; do
  mkdir -p "$tmp/$ws"
  cp "$root/$ws/package.json" "$tmp/$ws/"
done <<< "$workspaces"

if ! node "$tmp/scripts/set-version.mjs" "$VERSION" >/dev/null; then
  bad "set-version exited non-zero"
  exit 1
fi

# ── The published shape ─────────────────────────────────────────────────────
report="$(node -e '
const {readFileSync} = require("node:fs");
const [tmp, root, version, list] = process.argv.slice(1);
const paths = ["package.json", ...list.split("\n").map(d => d + "/package.json")];
const names = new Set(paths.map(p => JSON.parse(readFileSync(tmp + "/" + p, "utf8")).name));
const out = [];
for (const p of paths) {
  const after = JSON.parse(readFileSync(tmp + "/" + p, "utf8"));
  const before = JSON.parse(readFileSync(root + "/" + p, "utf8"));
  if (after.version !== version) out.push(`version ${after.name} is ${after.version}`);
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [dep, range] of Object.entries(after[field] ?? {})) {
      const want = names.has(dep)
        ? (field === "peerDependencies" ? "^" + version : version)
        : (before[field] ?? {})[dep];
      if (range !== want) out.push(`${field} ${after.name} -> ${dep} is "${range}", want "${want}"`);
    }
  }
}
process.stdout.write(out.join("\n"));
' "$tmp" "$root" "$VERSION" "$workspaces")"

if [ -z "$report" ]; then
  ok "every internal dependency is pinned exactly, peers stay \`^\`, third-party ranges untouched"
else
  bad "set-version wrote the wrong ranges:"
  printf '%s\n' "$report" | while IFS= read -r line; do printf '  %s\n' "$line"; done
fi

# The check above compares against what set-version KNOWS is internal. This one
# does not: any `@design-parity/*` range left floating at some other version is a
# dependency the script never rewrote — a package dropped from the `workspaces`
# globs but still depended on, say — which the comparison above would call
# correct because it never considered it internal.
carets="$(grep -rhoE '"(design-parity|@design-parity/[a-z-]+)": "\^[^"]+"' "$tmp" \
  | grep -v '"\^'"$VERSION"'"' || true)"
if [ -z "$carets" ]; then
  ok "no internal dependency published behind a floating range"
else
  bad "internal dependencies still carry a floating range: $(printf '%s' "$carets" | tr '\n' ' ')"
fi

if [ "$fail" -eq 0 ]; then
  printf '\nset-version checks passed.\n'
else
  printf '\nset-version checks FAILED.\n' >&2
fi
exit "$fail"
