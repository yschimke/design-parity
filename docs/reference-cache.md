# The reference cache's structural half

*How component properties and variant axes live in the cache
[#289](https://github.com/yschimke/design-parity/issues/289) built, rather than
beside it — and why that was worth deciding rather than letting a second
artifact grow.*

## Why there is a second half at all

The cache imports, per node, the **structure** and the **rendered image**, keyed
`fileKey/nodeId` and stamped with the file `version` they were fetched at
([`reference-cache.ts`](../packages/adapters/figma/src/reference-cache.ts)). A
parity run on a code change then makes zero Figma calls.

That is enough to *compare* a reference. It is not enough to know **what the
reference is a picture of**. `GET /v1/images` renders a node at its component
property **defaults**, and those defaults appear nowhere in the variant's name:
the M3 kit's `Button` defaults `Show icon` to `true`, so a node named
`Type=Round, Size=Small, State=Enabled` renders with an icon that nothing in the
cached structure announces. Diff label-only code against it and the report
blames the code.

The properties are not in the node, either — Figma returns
`componentPropertyDefinitions` on the **component set**, and only for nodes
asked for **directly**. A consumer that walks a file records properties for zero
nodes and cannot tell that it did. `yschimke/m3-catalog` worked around this with
a committed `figma-kit-index.json`, rebuilt by a script and staleness-gated in
CI — which is precisely this cache's structural half, maintained twice.

## How it is stored

No new file kind, no second manifest, no second gate: **a component set is a
cache entry like any other node.**

```
  index.json                       — the manifest
  <fileKey>/variables.json         — one per file
  <fileKey>/<nodeId>/node.json     — structure (+ the `components` map)
  <fileKey>/<nodeId>/image.svg     — the render
  <fileKey>/<setId>/node.json      — the set: properties + variant names
```

Two additive fields carry it:

| Field | What it is for |
| --- | --- |
| `CachedNodeDoc.components` | The nodes response's file-level component metadata. The load-bearing part is `componentSetId` — a variant's own document holds **no** pointer to the set that owns its properties, so without this the cache cannot tell that the node it holds has a family at all. |
| `ReferenceCacheEntry.structureOnly` | Marks a set. Rendering one produces a grid of every variant at once, which nothing compares against, so `image` is absent **by design** rather than because an import half-finished — which is what a reader would otherwise conclude. |

Both are optional and additive, so `REFERENCE_CACHE_FORMAT_VERSION` does not
move: an older cache is read exactly as before, and simply has no properties
(the adapter degrades to a reference without them rather than reaching for the
network on a `cacheOnly` run).

## Invalidation: one version, both halves

The structural half rides the same file `version` as the rendered half, because
they cannot meaningfully disagree — a kit edit that changes a default changes
the render, and a kit edit that changes the render may have changed a default.
Two gates would let a report show a current picture described by last month's
properties, which is worse than either being plainly old.

Concretely, in [`import.ts`](../packages/action/src/import.ts):

- The set pass runs **only for a file whose version moved** — it sits after the
  `version`-unchanged short-circuit, so an unchanged kit still costs one
  request for the whole file.
- It reads the sets of the nodes refreshed *this run*, in one batched request,
  and skips any set already cached at this version.
- A set that is itself a catalog reference (a `refSet`, [#299](https://github.com/yschimke/design-parity/issues/299))
  is imported as an ordinary node, render included — something asked for it by
  name. An imageless entry stays "due", so a set first cached structure-only
  gets its render as soon as the map names it.
- Failure is a warning. Properties are additive: the reference degrades to one
  without them rather than the import failing.

## What the run does with it

`FigmaAdapter` reads a set the same way it reads a node — this run's warm, then
the committed cache, then the API — so:

- `DesignReference.properties` is populated on a `cacheOnly` run, offline.
- `resolveSibling` (`Size=Small` → `Size=Medium`) is a lookup in the cached
  set's children, also offline. The variant names *are* axis vectors, which is
  what makes it a lookup rather than a guess.

## What stays out

The consumer's own dialect: the map from *its* preview knobs to the source's
axis names (`size`→`Size`, `xs`→`XSmall`, `status`→`State`), and which of its
renders count as single-axis rather than combinations. That is catalog-shaped —
caching one consumer's vocabulary as if it were the source's would make every
other consumer's cache wrong.
