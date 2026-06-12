# @design-parity/adapter-bundle

The image-bundle [`ReferenceAdapter`](../../core/src/types.ts) for
design-parity. Depends only on `@design-parity/core` (plus the tiny,
dependency-free [`fflate`](https://www.npmjs.com/package/fflate) for in-memory
unzip).

## Raw images + a tiny manifest

There is a real workflow with **no design-tool API and no HTML export**: a
designer just hands over a **bundle of exported PNGs** — a committed folder or a
`.zip` — straight out of the design tool. The
[`adapter-claude-design`](../claude-design) driver already does
"committed HTML export + handoff", but that is more than this case needs. This
adapter generalizes it down to "raw images + a tiny `manifest.json`", so it
covers Figma/Stitch/Claude exports dumped as PNGs, or any tool with no
integration at all.

Same `linkMethod: "manifest"` (the only link method a source with no machine
link can have); simpler input.

```
design-map.json ──▶ fixtures/bundle/offer-card/  ──┐
   (manifest)        (dir or .zip of PNGs)          ├─▶ DesignReference
                       └─ manifest.json ────────────┘     (manifest)
```

## The bundle

The `ref` in `design-map.json` is a repo-relative path to a committed
**directory** or **`.zip`**. The bundle holds the reference PNGs plus a
`manifest.json`:

```json
{
  "componentId": "ui/Card.kt#OfferCard",
  "tokens": { "spacing": { "padding": 16 }, "radius": { "corner": 12 } },
  "images": [
    { "state": "default", "theme": "light", "size": "600px", "path": "offer-card.light.png" },
    { "state": "default", "theme": "dark",  "size": "600px", "path": "offer-card.dark.png" }
  ]
}
```

- **`images[].path`** — a PNG, resolved relative to the bundle root. Its
  `width`/`height` are read from the PNG's IHDR — not trusted from the manifest
  — so reference dimensions can never drift from the committed bytes. (`width`
  / `height` in the manifest, if present, are ignored hints.)
- **`images[].size`** — a producer's breakpoint label, canonicalized through
  `normalizeSize` from `@design-parity/core` (`"600px"` → `"medium"`) so the
  bundle's images **pair** with the candidate. An unrecognized label is kept
  verbatim.
- **`tokens`** — inline `DesignTokens` for token-compliance checks.
- **`componentId`** — optional; when present it must match the component the
  resolver asked for, else `resolve` throws.

A directory bundle's image `uri` is the repo-relative path to the PNG; a `.zip`
bundle has no standalone file per entry, so its `uri` is the unzipped PNG bytes
inlined as a `data:image/png;base64,…` URI. The diff engine and the HTML report
both decode `data:` URIs, so a `.zip` bundle is fully diff-able and renderable
end-to-end.

## Usage

```ts
import { createBundleAdapter } from "@design-parity/adapter-bundle";

const adapter = createBundleAdapter();
const ref = await adapter.resolve(
  "ui/Card.kt#OfferCard",          // resolver-supplied code handle
  "fixtures/bundle/offer-card",    // the design-map ref (dir or .zip, repo-relative)
  { repoRoot: process.cwd(), env: process.env },
);
```

## Errors

`resolve` throws a clear, prefixed, typed error (all extend `BundleError`):

- `BundleNotFoundError` — the directory / `.zip` named by the `ref` is missing.
- `BundleManifestError` — `manifest.json` is absent, not valid JSON, malformed,
  or its `componentId` contradicts the resolver.
- `BundleImageNotFoundError` — a manifest image references a file not in the
  bundle.

Everything runs **offline** — no network, no model.
