# Running an exhaustive parity check in parallel

**The problem is one serial job, not the size of the catalog.** A parity run
costs roughly

```
run_minutes ≈ fixed + per_component × components
```

The `fixed` term is the candidate render's Gradle configure + compile plus the
Node install — call it ~4 min, and it is paid whether the job draws one preview
or a thousand. The marginal term is one render + reference fetch + diff per
component. Past a few hundred components the marginal term dominates, the render
step hits its `--timeout`, and not far behind it the job hits `timeout-minutes`.

There are two levers, and they are not alternatives. **Do the first one always;
reach for the second only if the first is not enough.**

## Lever 1: scope the render (free — do it first)

A catalog module draws far more previews than any component maps to. m3-catalog
draws **1,095** and maps **77**: only a component carrying
`@CatalogComponent(reference = …)` has a design reference to compare against, so
only those 77 are ever subjects. Rendering the other 1,018 produces PNGs nothing
reads.

`--exclude-preview-id` scopes the render. [`m3-catalog#11`][pr11] found this while
chasing a render that kept hitting its timeout, and excluding the 1,018 unmapped
previews took it from **~43 min to ~4**.

> **Measured caveat, and read it before assuming you need this.** #11's premise
> was that `--id` selects what the bundle *contains* without scoping the render,
> which walks the module regardless. On the first m3-catalog run through this
> workflow that was **not** what happened: the exclusion list came back empty
> (a probe bug, since fixed), so the render ran with 77 `--id`s and no
> exclusions at all — and it drew **77 previews in 43 s**, not 1,095. On
> `compose-preview` 0.19.45, `--id` does scope the render.
>
> So `--exclude-preview-id` is the *guarantee*, not necessarily the *speedup*.
> Keep it — it is derived for free, it costs nothing when redundant, and it is
> what makes a sharded render provably draw only its slice. But if you are
> reaching for this doc because a render is slow, measure first: on a current
> CLI the positive selection may already be doing the work, and the real cost is
> somewhere else.

**This costs no coverage** — the excluded previews were never comparison
subjects. What it costs is maintenance: #11 derived the list by hand in the
consumer's own workflow, and it has to be re-derived every time the catalog
grows. So this workflow derives it instead, per shard, from the discovery
manifest:

```
--exclude-preview-id  =  every preview the module draws
                       −  the previews this shard compares
```

That is the `preview-manifest` input, and it is why the flag matters: the
complement is only as complete as the set it is taken against. Taken against
`design-map.json` it names the ~64 previews the *other shards* own and says
nothing about the 1,018 unmapped ones — every shard would still render the whole
module and sharding would divide nothing. Taken against the manifest, each shard
renders only its slice.

## Lever 2: divide what's left (shard)

Even correctly scoped, the marginal term grows with the *mapped* set. Run N jobs,
each rendering and comparing a disjoint slice of the same exhaustive component
list, then union the results with `design-parity merge`. Nothing is excluded,
nothing is hand-tuned, and the wall clock falls by roughly the marginal term
over N.

**Two reasons to try `shards: 1` with a correct `preview-manifest` first.** Every
shard pays `fixed` in full, so a fan-out over a small mapped set buys little (see
the table below). And each shard is an independent client of the reference API:
N shards make N concurrent callers on one token. The Figma adapter surfaces a 429
as a per-component failure with no retry — the component produces no verdict and
the run stays green — so an over-sharded run degrades into silent under-coverage,
which is the failure mode this document exists to avoid. `m3-catalog#12` is that
happening at N=1.

## What divides and what doesn't

Only the **marginal** cost divides. Every shard pays `fixed` in full, because
every shard compiles the module before it draws anything. So for a 1,000-component
catalog at ~4 min fixed and ~2.2 s per component:

| Shards | Wall clock | Runner-minutes |
| ---: | ---: | ---: |
| 1 | ~41 min | 41 |
| 4 | ~13 min | 52 |
| 6 | ~10 min | 61 |
| 8 | ~9 min | 71 |
| 16 | ~6 min | 100 |

**4–8 is the useful range.** Past that you are buying Gradle configure time, not
throughput: from 8 to 16 shards the wall clock improves by ~3 minutes and the
runner bill grows by ~30. Pick the smallest N that fits the run inside
`timeout-minutes` with headroom, and revisit it when the catalog doubles — not
every time it grows.

## Using it

The whole consumer-side workflow is a call:

```yaml
name: Design parity
on:
  push:
    branches: [main]

jobs:
  parity:
    uses: yschimke/design-parity/.github/workflows/design-parity-reusable.yml@main
    permissions:
      contents: write   # publish the artifacts to design-parity/main
    with:
      module: ':catalog'
      shards: 1
      # Optional: regenerate design-map.json from the repo before partitioning,
      # e.g. by projecting it out of @CatalogComponent(reference = …) annotations.
      design-map-command: >
        ./gradlew :catalog:composePreviewDiscover &&
        node scripts/generate-design-map.mjs
    secrets:
      figma-token: ${{ secrets.FIGMA_TOKEN }}
```

`shards: 1` (the default) is a single job doing exactly what a serial run does —
no artifacts, no merge — so a small catalog pays nothing for this machinery being
available. The component universe defaults to **every** component in
`design-map.json`; `components:` narrows it only if you want it narrowed.

**Check the render is actually scoped before you raise `shards`.** The exclusion
list comes from `preview-manifest`, which defaults to the path `module` implies
(`:catalog` ⇒ `catalog/build/compose-previews/previews.json`). If your discovery
pass writes it elsewhere, set the input — otherwise the job logs

```
Render not scoped: No preview manifest at '…' — every shard will render the
whole module.
```

and each shard pays the full render, which is the cost sharding was supposed to
divide. The per-shard log line to look for instead is

```
Shard 1/6: 13 of 77 component(s); 13 preview(s) to render, 1082 excluded.
```

## The pieces, and the one invariant

Three CLI surfaces carry this, all in the published `design-parity` package:

| Command | What it does |
| --- | --- |
| `design-parity shard --shard i/N` | Prints this shard's slice — component handles, or (`--field previewId`) the render ids they map to, or (`--complement --preview-universe <manifest>`) every preview the module draws *except* this slice, which is the render's exclusion list. |
| `design-parity run --shard i/N` | Compares this shard's slice and writes `shard.json` next to the reports. Partitions the **full** list it is given; a blocking verdict exits 0 here (see below). |
| `design-parity merge <shard-dir>... --out <dir>` | Verifies the shards cover the run exactly once, copies every component's report subdir, regenerates the landing page from the unioned rows, and applies the run's verdict as its exit code. |

> **Shard the render, not the reference fetch.** Sharding divides the render and
> the diff, but N shards fetching references live multiply the *reference* cost
> by N against a limiter that is per token — the header's warning that "it is
> the one that does not multiply the reference API's rate limit by N" is the
> reason. Set `reference-cache-branch` and every shard reads the same committed
> commit instead, at zero API cost. See [the reference cache](./REFERENCE_CACHE.md).

**The invariant: the render side and the comparison side must select the same
components.** If they disagree, a shard renders previews it never diffs and diffs
components it never rendered — which surfaces only as "no candidate render
available" warnings on an otherwise green run. So the partition has exactly one
implementation (`partitionComponents`, sort-then-round-robin over the unique
component handles), and both sides read it: the render step via
`design-parity shard`, the comparison via `run --shard`.

The consequence worth internalising: **`run --shard` is given the full component
list, not the slice.** It partitions what it is handed. Passing it a pre-sliced
list would make it partition the slice again and compare a fraction of a
fraction — silently, since every remaining component would still pass.

Round-robin rather than contiguous blocks, because component ids sort by path, so
a contiguous block is one directory: a screen with many variants clusters, and
whichever block holds it becomes the straggler every run. Interleaving spreads it.

## Two orderings that are deliberate

**Verify before merging.** The merge runs last, after every shard has spent its
full budget. A lost upload, a `--shard` typo, or a shard that checked out a
different commit would otherwise land as a merged index quietly missing a slice —
which reads as "clean", not as "not checked". So `merge` refuses to publish
unless the shards agree on the run size, no index repeats, no component is
claimed twice, and every shard reported. An empty slice (more shards than
components) is a legitimate no-op, but it still writes its `shard.json`, or it
would be indistinguishable from a shard that died.

**Publish before applying the verdict.** A blocking verdict is the *run's*, not a
shard's. Each shard records it in `shard.json` and exits 0; `merge` applies it
once, and writes its artifacts to disk *before* it fails. The workflow publishes
the branch and only then re-applies the exit code. A shard exiting non-zero would
take the fan-out down under `fail-fast` and strand the very reports that diagnose
the failure — which is the same ordering [`m3-catalog#11`][pr11] had to fix by
hand in its third commit.

## Related

- [`compose-ai-tools#3439`](https://github.com/yschimke/compose-ai-tools/pull/3439)
  — the same shape one layer down: `render-shards` on the design-artifacts
  reusable workflow, with `compose-preview bundle merge` reassembling the
  rendered bundles. That shards a *render*; this shards a *comparison*. A catalog
  that publishes artifacts and checks parity uses both.
- [`report-format.md`](./report-format.md) — the published `verdict.json`
  contract. `shard.json` is the parallel-run intermediate, versioned the same way
  (`SHARD_FORMAT_VERSION`) and checked by the merge before it is trusted.

[pr11]: https://github.com/yschimke/m3-catalog/pull/11
