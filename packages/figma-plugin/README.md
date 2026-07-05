# `@design-parity/figma-plugin`

The in-Figma client for design-parity's **code → design** direction. It imports
a published `@design-parity/catalog-export` catalog — a compose-preview-rendered
component system: sticker-sheet PNGs plus a DTCG token set — straight onto a
Figma canvas as authoritative renders, grouped by component group, with:

- the **`ideal` render or the `layout` wireframe** variant (a UI toggle);
- an a11y **greenline** layer over the ideal render (touch-target, contrast,
  label findings from the catalog) — design-parity leads with a11y;
- a **redline** (spacing spec) layer over the layout wireframe — per-node box,
  padding, gap, and corner radius;
- a **variable collection** projected from the design system's tokens
  (light/dark become Figma modes).

Each variant gets its natural overlay: greenlines annotate the *ideal* render,
redlines annotate the *layout* wireframe. Figma is a *view* of the code, never
the source of truth — the same stance the upstream catalogs and the Figma
roundtrip take. The render is authoritative; the plugin only places it.

| Ideal variant — a11y greenlines | Layout variant — spacing redlines |
| --- | --- |
| ![Ideal render with greenlines](docs/canvas-preview.png) | ![Layout wireframe with redlines](docs/canvas-preview-layout.png) |

*Deterministic SVG proofs of the imported scene (`planToSvg`), rendered from the
shared [`docs/sample-catalog.json`](docs/sample-catalog.json) fixture. A Figma
plugin can't be rendered headlessly, so these stand in for canvas pixels in
review; regenerate with `npm run preview` (see [Keeping evidence
current](#keeping-evidence-current)).*

## Status

This package is **private** and ships to the **Figma Community**, not npm — a
Figma plugin is built-and-uploaded, so it carries no npm version tag and is
excluded from the release-please publish lane. `"version"` tracks the monorepo
for coherence only.

## Layout — two realms, one testable core

A Figma plugin runs in two sandboxes: a **main thread** with the `figma` scene
API but no network, and a **UI iframe** with `fetch`/DOM but no scene access.
Neither is unit-testable under Node. So all the decision logic lives in a pure
core and the two runtime files stay thin:

| Path | Realm | Role |
| --- | --- | --- |
| [`src/plan.ts`](src/plan.ts) | pure (tested) | `buildImportPlan(manifest, opts)` → an `ImportPlan` describing every frame, image URL, greenline/redline, and the Figma variable collection. No `figma`, no `fetch`. |
| [`src/dtcg.ts`](src/dtcg.ts) | pure (tested) | Slim, browser-safe DTCG token reader (core's `readDtcgTokens` is Node-only — it loads the schema from disk). |
| [`src/preview.ts`](src/preview.ts) | pure (tested) | `planToSvg(plan)` → the offline SVG layout proof used for review evidence. |
| [`src/annotations.ts`](src/annotations.ts) | pure (tested) | Shared colour + label helpers for the greenline (severity) and redline (spacing spec) layers — one place so the SVG preview and Figma paints match. |
| [`figma/ui.ts`](figma/ui.ts) | UI iframe | Fetches `catalog.json` + tokens + PNG bytes, runs the planner, posts the plan to the main thread. |
| [`figma/code.ts`](figma/code.ts) | main thread | Executes the plan against the scene: frames, image fills, greenline/redline overlays, variable collection. Mechanical. |
| [`figma/ui.html`](figma/ui.html) | UI iframe | Markup; esbuild inlines the compiled `ui.ts` into it. |
| [`figma/manifest.json`](figma/manifest.json) | — | Figma plugin manifest (network allowlist, entry points). |

The pure core is the package's exported surface (`src/index.ts`); the `figma/`
glue depends on the `figma` global and is bundled by esbuild, never imported by
Node.

### Why the `catalog-export/figma` subpath

`buildImportPlan` reuses `toFigmaVariables` from
[`@design-parity/catalog-export/figma`](../catalog-export/src/figma.ts) — the
package's browser-safe Figma-projection subpath — **not** the package barrel.
The barrel re-exports the on-disk catalog writer (`node:fs`), which can't be
bundled into a Figma plugin. The subpath keeps the browser bundle Node-free by
construction.

## Build

```sh
npm run build   --workspace @design-parity/figma-plugin   # tsc: the pure core → dist/
npm run test    --workspace @design-parity/figma-plugin   # vitest: plan + dtcg
npm run build:plugin --workspace @design-parity/figma-plugin  # esbuild: figma/ → dist/plugin/
```

`build:plugin` emits `dist/plugin/code.js` and a self-contained
`dist/plugin/ui.html`. In Figma: *Plugins → Development → Import plugin from
manifest…* and pick [`figma/manifest.json`](figma/manifest.json) (it points at
the bundled output).

## Using it

Run the plugin and paste the raw root of a published
`design-artifacts/<system>` branch — the folder containing `catalog.json`, e.g.

```
https://raw.githubusercontent.com/yschimke/design-parity/design-artifacts/compose-m3
```

Pick the **Ideal render** (with a11y greenlines) or the **Layout wireframe**
(with spacing redlines) variant, then Import. The plugin fetches the manifest,
its DTCG token file, and every PNG for that variant, then lays out a
`<system> — Catalog` page with the matching annotation layer and a variable
collection (light/dark become Figma modes). Add your own live-preview host to
the manifest's `networkAccess.allowedDomains` to import from
`compose-preview serve` instead of GitHub.

## Keeping evidence current

`planToSvg` is deterministic, so the committed `docs/canvas-preview*.svg` must
equal what the current code produces from
[`docs/sample-catalog.json`](docs/sample-catalog.json). A test
([`test/preview-evidence.test.ts`](test/preview-evidence.test.ts)) regenerates
them and fails if they drift — so any change to the planner / preview /
annotations that isn't reflected in the committed evidence is caught by
`npm test` in CI, forcing the PR to refresh its before/after proof. Regenerate
with:

```sh
npm run build --workspace @design-parity/figma-plugin
npm run preview --workspace @design-parity/figma-plugin   # rewrites the SVGs
```

then re-rasterize the PNGs (the generator prints the `chromium --screenshot`
command). Only the deterministic SVGs are gated; the PNGs are Chrome-rendered
and refreshed alongside by hand.

## Roadmap

- Code Connect authoring: map imported frames back to code components.
