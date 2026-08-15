# PageBackdropManifest contract

The wire format between the **producer** — design-parity's Figma page importer —
and any **consumer** that draws the result. The producer emits a design page's
geometry plus its design→code mapping; **how it is drawn is entirely the
consumer's decision.**

- **Source of truth:** [`packages/page-backdrop/schema/page-backdrop.schema.json`](../packages/page-backdrop/schema/page-backdrop.schema.json).
  The TypeScript types in [`types.ts`](../packages/page-backdrop/src/types.ts)
  mirror it; the schema is what a non-TypeScript consumer generates from.
- **Sample:** [`fixtures/page-backdrop/`](../fixtures/page-backdrop) — a real
  import covering all four link methods, plus the renders that overlay it.
- **Version:** `version` equals `PAGE_BACKDROP_VERSION` (currently `1`).
- **Feature overview:** [`page-backdrops.md`](./page-backdrops.md).

## Why the consumer decides

A baked HTML viewer ships with this package, and it is the *fallback* — offline,
artifact-friendly, no server needed. It is not the intended surface.

The manifest is the surface. A consumer with a renderer behind it can do
strictly better than a static page: given a placement's `previewId` and its
`bounds`, a preview server can **render the component live at the placement's
exact dimensions**. That turns the overlay from a fixed-size screenshot scaled to
fit into a real render at the right size — which is a materially stronger parity
comparison, and something the producer cannot do because it has no renderer (and
[must not grow one](../AGENTS.md)).

So the producer's job stops at: *here is the screen, here is what is on it, here
is which code implements each part, and here is enough to render that code
yourself.*

## Conventions

- **Units:** every geometric quantity is **frame-local design units (dp)**, with
  the page frame's top-left as the origin. Deliberately *not* image pixels — the
  backdrop PNG is exported at some `image.scale`, and pinning geometry to the
  unscaled frame means a re-export at a different resolution doesn't invalidate
  the manifest. Position by ratio (`x / frame.width`) and no density arithmetic
  is needed anywhere.
- **Images:** `image.uri` is relative to the manifest file. It is the page as the
  design tool renders it — the backdrop, not a component. `image.format` says
  which kind it is: absent or `png` for a raster, `svg` for an export carrying
  `data-node-id` on every element. An `svg` backdrop is **addressable** — a
  consumer can find the element for any `placement.nodeId` and act on it (hide
  it, outline it, measure it) rather than only knowing the box the manifest
  recorded. A consumer that just draws the image needs no change either way.
- **Ordering:** pages follow the committed config's order (the repo's stated
  priority); placements are ordered top-left first, so a re-import produces a
  readable diff rather than a reshuffle.
- **Determinism:** nothing is timestamped. Re-importing an unchanged design
  produces a byte-identical manifest.

## Shape

See the schema for the authoritative definition. In brief:

```jsonc
{
  "version": 1,
  "source": "figma",
  "fileKey": "AbCdEf123456",
  "pages": [
    {
      "id": "now-playing",            // slug; also the backdrop PNG's basename
      "name": "Now Playing",
      "nodeId": "1:2",
      "frame": { "width": 360, "height": 720 },
      "image": { "uri": "now-playing.png", "scale": 1 },
      "placements": [
        {
          "nodeId": "2:6",
          "name": "Button/Play",
          "componentId": "10:40",      // the main component
          "componentSetId": "10:4",    // the variant set, where Code Connect usually sits
          "bounds": { "x": 146, "y": 490, "width": 68, "height": 68 },
          "depth": 0,
          "ref": "figma:AbCdEf123456/2:6",          // always present
          "code": "ui/Player.kt#PlayButton",
          "previewId": "app.PlayerKt.PlayButton_Light",
          "link": "code-connect",
          "confidence": "high",
          "matchedRef": "figma:AbCdEf123456/10:4",  // which ref carried the link
        },
      ],
    },
  ],
}
```

## The three fields a consumer can't do without

Everything else is geometry. These are what make the manifest self-contained:

| Field | Why it's here |
| --- | --- |
| `ref` | **Always present**, linked or not. A consumer must be able to deep-link a hotspot back into the design tool even for a part of the screen no code implements — which is exactly the case worth clicking through on. |
| `previewId` | Present whenever `design-map.json` names one. Without it, a consumer holding a code handle would need the *producer's* inputs to turn it into something renderable, and the manifest would stop being self-contained. Note it is looked up **by code handle, not by ref** — a placement can link via Code Connect and still take its `previewId` from the manifest. |
| `confidence` | Stated, not implied. A consumer styling weak links shouldn't have to hardcode that `convention` means low and the others mean high. |

## Reading `link`

Precedence, applied per instance: **`code-connect` → `manifest` → `convention` →
`unlinked`**. The page-specific wrinkle is *which ref gets looked up*: a page
holds **instances**, but a link attaches to a **component** — usually the
component *set* rather than one variant. So each placement is tried against the
set, then the main component, then the instance itself, and `matchedRef` records
which one won.

`unlinked` is not an error or an omission. A component instance with no code
behind it is the finding a whole-screen view exists to surface, so it is always
kept.

## Compatibility rules

The producer releases to npm independently of every consumer, so a consumer will
routinely read manifests written by a *newer* producer. Both sides have
obligations:

**The producer must:**
- bump `version` only for a **breaking** shape change — a removed or retyped
  field, or a changed meaning;
- treat new optional fields as additive and **not** bump `version` for them.

**A consumer must:**
- **ignore unknown fields** rather than fail to parse. The schema deliberately
  does not set `additionalProperties: false`, and there is a test asserting an
  unknown field still validates;
- check `version` as *"a version I understand"*, **not** `=== 1`. Requiring
  equality makes every future additive release look like a breaking one.

This is the one place this contract differs from an in-repo wire format like
compose-ai-tools' `SpatialScene`, where producer and consumer always ship
together and neither rule is needed.
