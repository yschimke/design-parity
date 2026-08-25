# design-parity

The top-level CLI for [design-parity](https://github.com/yschimke/design-parity)
— prove a UI pull request is at parity with its intended design. Run it with no
checkout:

```sh
npx design-parity run \
  --components "ui/Home.kt#HomeScreen" \
  --candidate-bundles build/compose-previews/ \
  --out .design-parity/out
```

## `shard` + `merge` — one run across N jobs

A catalog big enough that one job can't compare it inside a timeout doesn't have
to be narrowed down to a hand-picked subset. Split the *same exhaustive*
component list across parallel jobs and union the results:

```sh
# In job i of N: what this shard renders, and what it must not render.
npx design-parity shard --shard 2/6 --repo . --field previewId
npx design-parity shard --shard 2/6 --repo . --field previewId --complement

# Compare this shard's slice. Note: given the FULL component list — `--shard`
# partitions what it is handed, so passing a pre-sliced list slices it twice.
npx design-parity run --repo . --components "$ALL" --shard 2/6 \
  --candidate-bundles build/design-parity/candidates.bundle.png \
  --out build/design-parity/out

# Then, once: reassemble the shards into the artifact set one serial run
# would have written. Exits 1 on a blocking verdict — after writing the files.
npx design-parity merge shards/* --out .design-parity/out
```

Most consumers don't wire this by hand: the
[reusable workflow](https://github.com/yschimke/design-parity/blob/main/.github/workflows/design-parity-reusable.yml)
is the whole pipeline behind a `shards:` number. See
[`docs/PARALLEL_PARITY.md`](https://github.com/yschimke/design-parity/blob/main/docs/PARALLEL_PARITY.md).

## Resolve scoped known differences

Have the fixing run write compact, reviewable evidence, including the fixing PR that performed the
verification:

```sh
npx design-parity run --repo . --components "$ALL" \
  --acceptance-evidence /tmp/design-parity-acceptances.json \
  --issue-index /tmp/parity-issues.json \
  --verification-url https://github.com/owner/catalog/pull/123
```

`--issue-index` is the catalog's published `parity/issues.json`. The evidence keeps lifecycle
(`open`, `closed`, or `unknown`) separate from comparison status and exits non-zero only for the
unsafe lifecycle combination: a closed issue whose acceptance is not resolved. A missing, malformed,
or conflicting index row is `unknown`, never inferred as closed.

Then remove only the records observed as unambiguously `resolved`, delete their matching artifact
directories, and write the PR body that keeps cleanup and issue closure in one merge:

```sh
npx design-parity resolve --repo . \
  --evidence /tmp/design-parity-acceptances.json \
  --owned-issue owner/catalog#42 \
  --body-out /tmp/design-parity-resolution-pr.md
```

`--owned-issue` is an explicit assertion that this repository's one
`.design-parity/known-differences.json` owns every acceptance for that canonical issue. The command
adds `Closes owner/catalog#42` only when all siblings in the document resolved and ownership was
asserted. Without it, resolved records are still removed but the body records that the issue remains
open for a cross-catalog ownership check.

## `reverse` — design → code

Ask the committed `design-map.json` which code implements a design node — the
direction a source without Code Connect (Stitch, Claude Design, bundle) otherwise
can't answer. Every node of a multi-node binding points back at its code handle.

```sh
npx design-parity reverse figma:AbCdEf/1:42   # → ui/Home.kt#HomeScreen
npx design-parity reverse --repo .            # dump the whole ref → code map
```

Exit codes: `0` found (or full dump), `1` the ref maps to nothing, `2` no
readable `design-map.json`.

This package is a thin launcher over
[`@design-parity/action`](https://www.npmjs.com/package/@design-parity/action):
it owns the `design-parity` bin so the bare `npx design-parity` invocation
works, and it re-exports the orchestrator's programmatic API
(`import { orchestrate } from "design-parity"`). The candidate side is rendered
by the upstream [`compose-preview`](https://github.com/yschimke/compose-ai-tools)
CLI — design-parity owns the reference side and the diff.

See the [repo README](https://github.com/yschimke/design-parity#readme) and the
[CMP adoption guide](https://github.com/yschimke/design-parity/blob/main/docs/adopting-cmp.md)
for the full pipeline.
