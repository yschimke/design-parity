# @design-parity/adapter-claude-design

The Claude Design [`ReferenceAdapter`](../../core/src/types.ts) for
design-parity. Depends only on `@design-parity/core`.

## There is no Claude Design read API

Claude Design is a research preview. It exposes **no read API and no Figma
export**, so — unlike the Figma adapter (REST + Code Connect) or even Stitch
(SDK) — there is nothing to fetch. The reference is consumed as a **committed
HTML export** that a human (or the
[`compose-preview-design-board`](https://github.com/yschimke/skills) skill,
which owns the reverse direction — building the HTML imported *into* Claude
Design) checks into the consumer repo. Because there is no machine link, the
correspondence is always a `design-map.json` entry and the resulting
`DesignReference` always has `linkMethod: "manifest"`.

```
design-map.json ──▶ design/reference/*.html ──▶ rasterize ─┐
   (manifest)         (committed export)        (headless)  ├─▶ DesignReference
                          └─ handoff manifest ──▶ tokens ───┘     (manifest)
```

## The HTML export

A committed export is an ordinary HTML document carrying one embedded handoff
manifest:

```html
<script type="application/design-parity+json">
  {
    "componentId": "ui/Card.kt#OfferCard",
    "tokens": { "spacing": { "padding": 16 }, "radius": { "corner": 12 } },
    "images": [
      { "state": "default", "theme": "light", "size": "medium",
        "src": "./offer-card.light.png" }
    ]
  }
</script>
```

- **`images[].src`** — a pre-rendered PNG, resolved relative to the HTML file.
  Its `width`/`height` are read from the PNG itself, so reference dimensions can
  never drift from the committed bytes. A variant with no `src` (or an export
  with no `images` at all) is **rasterized headlessly** from the document.
- **`tokens`** — inline `DesignTokens`, or a string path to a handoff token
  file (relative to the HTML) for token-compliance checks.
- **`componentId`** — optional; when present it must match the component the
  resolver asked for, else `resolve` throws.

## Usage

```ts
import { ClaudeDesignAdapter } from "@design-parity/adapter-claude-design";

const adapter = new ClaudeDesignAdapter();
const ref = await adapter.resolve(
  "ui/Card.kt#OfferCard",          // resolver-supplied code handle
  "design/reference/offer-card.html", // the design-map ref (repo-relative)
  { repoRoot: process.cwd(), env: process.env },
);
```

### Rasterization

Rasterizing raw HTML variants defaults to `browserRasterizer`, which drives a
headless **Chrome/Chromium already on `PATH`** (set `CHROME_BIN` to point at a
specific binary) — no browser-automation dependency is bundled, keeping the
package's only runtime dependency `@design-parity/core`. Inject your own to
render inside an existing harness:

```ts
new ClaudeDesignAdapter({ rasterizer: myRasterizer });
```

Exports that ship pre-rendered `src` images never invoke a rasterizer.

## Errors

`resolve` throws a clear, prefixed error when the export is missing, its handoff
block is malformed, a referenced token file or image is missing, or the export's
`componentId` contradicts the resolver.
