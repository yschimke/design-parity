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
  (light/dark become Figma modes);
- a **`design-map.json` correspondence** scaffold linking each code component to
  the frame the plugin just placed (see *Correspondence export* below).

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
| [`src/designMap.ts`](src/designMap.ts) | pure (tested) | `buildDesignMap(plan, {fileKey, nodeIds})` → the `design-map.json` correspondence, validated against `@design-parity/core`'s schema. |
| [`src/annotations.ts`](src/annotations.ts) | pure (tested) | Shared colour + label helpers for the greenline (severity) and redline (spacing spec) layers — one place so the SVG preview and Figma paints match. |
| [`src/reconcile.ts`](src/reconcile.ts) | pure (tested) | `reconcile(existing, plannedIds)` → the update/add/stale decision for a re-import, keyed by `componentId`. No `figma`. The decision half of non-destructive re-import; `scene.ts` executes it. |
| [`src/direction.ts`](src/direction.ts) | pure (tested) | `resolveDirection(raw)` → `code-led` \| `design-led` (unresolved ⇒ design-led, the safe default). The mode gate: design-led routes renders to a reference page and requires confirm-before-write. |
| [`src/scene.ts`](src/scene.ts) | main-thread logic (tested) | `applyImport(figma, plan, images)` — **stamps** every node with its identity and either builds a fresh page or **reconciles** an existing stamped board in place; image fills, greenline/redline overlays, variable collection; emits the `design-map.json`. Takes an **injected** `FigmaApi`, so it runs headlessly against a fake (see [Testing before Figma](#testing-before-figma)). |
| [`figma/ui.ts`](figma/ui.ts) | UI iframe | Fetches `catalog.json` + tokens + PNG bytes, runs the planner, posts the plan to the main thread. |
| [`figma/code.ts`](figma/code.ts) | main thread | Thin bootstrap: wires the UI and hands the real `figma` to `applyImport`. |
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
npm run test    --workspace @design-parity/figma-plugin   # vitest: planner, dtcg, preview, scene
npm run build:plugin --workspace @design-parity/figma-plugin  # esbuild: figma/ → dist/plugin/
```

`build:plugin` emits `dist/plugin/code.js` and a self-contained
`dist/plugin/ui.html`. In Figma: *Plugins → Development → Import plugin from
manifest…* and pick [`figma/manifest.json`](figma/manifest.json) (it points at
the bundled output).

## Testing before Figma

A Figma plugin can't run under Node, so the scene the plugin builds is verified
**headlessly** before it's ever loaded in Figma. The main-thread logic lives in
[`src/scene.ts`](src/scene.ts) as `applyImport(figma, plan, images)`, which takes
the scene API as an **injected** `FigmaApi` (a structural subset of Figma's
`PluginAPI`). [`test/scene.test.ts`](test/scene.test.ts) drives it against a fake
([`test/fakeFigma.ts`](test/fakeFigma.ts)) that records every created node,
image, variable, and font load, then asserts the exact tree — frame hierarchy,
image fills, greenline/redline rects and their strokes, the variable collection's
modes + values, and the emitted `design-map.json`. This catches wrong API calls,
ordering, and null handling (e.g. an unsaved file's `fileKey`) up front.

What's left for a manual Figma smoke test is only genuinely runtime-specific:
real font metrics, image decoding, and Figma's auto-parenting. To run it, feed
the plugin a catalog without publishing anything: serve a fixture directory
locally (`npx serve ./catalog`) and add `"http://localhost:*"` to the manifest's
`networkAccess.devAllowedDomains` (dev-only), or point it at a
`raw.githubusercontent.com` branch already in `allowedDomains`.

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

### Re-import reconciles in place — identity, not position

Importing the same system again is **not** a delete-and-rebuild. Every node the
plugin creates is stamped with invisible shared plugin data (`designParity`)
recording its role and, on each card, the catalog `componentId`. A re-import
finds the existing `<system>` board by that stamp and **reconciles** against it,
keyed by `componentId` (not by position, so a card a designer moved or regrouped
still matches):

- **matched** → the card's renders are refreshed on the *same* node, keeping its
  id, position, and any designer edits;
- **new in the catalog** → a card is added into its group;
- **gone from the catalog** → the card is tagged `stale` (name prefixed
  `(stale)`), never deleted;
- **unstamped** nodes — a designer's own content — are never touched.

The update/add/stale decision is the pure [`reconcile`](src/reconcile.ts).

### Mode-aware — code-led vs design-led

Who owns the file decides how the import behaves (the parity direction, resolved
by [`resolveDirection`](src/direction.ts) — only an explicit `code-led` lets the
importer own the file; `design-led`, an unresolved `auto`, or anything unknown is
treated as design-led, so an uncertain direction never clobbers a designer):

- **Code-led** (code is the source of truth): the plugin owns the
  `<system> — Catalog` page and builds / reconciles it directly, as above.
- **Design-led** (Figma is the source of truth): renders are a **comparison
  reference** only. They go onto a dedicated **`Code renders (reference)`** page,
  kept separate from the code-led catalog board (stamped `mode`, so one never
  reconciles into the other), and the plugin **refuses to write until you
  confirm** — the first Import is a dry run that reports what it *would* place,
  and a **Confirm write** button commits it. It never restructures
  designer-owned content unasked.

The direction is **stamped into `catalog.json`** by the generator from the
consumer repo's `.design-parity.json` (`generate-design-catalog.mjs` →
`toCatalogManifest`'s `direction`). The plugin's Mode selector defaults to
**From catalog** and honours it (a set-up repo has materialized a concrete
`code-led`/`design-led`; an unresolved `auto` or absent field falls back to the
safe design-led default), with **Code-led** / **Design-led** as manual
overrides.

### Structured pages — Themes/Tokens & per-screen

A **code-led** import with theme foundations and/or a screen graph lays out
multiple pages instead of one flat sheet, each its own reconcile **scope** (the
root is stamped `scope: tokens` / `screen:<id>` / `catalog`), so a re-import
refreshes each page in place independently:

- **`Themes / Tokens`** — the theme-foundation showcases (the `Theme/*` cards / a
  "Themes" group). The native Figma **variable collection** (light/dark modes,
  projected from the DTCG tokens) is the machine-readable half of this page and
  is created once per file.
- **One page per main screen** — from the catalog's screen graph
  (`catalog.json`'s `screens: [{ id, title?, related }]`): the screen's card plus
  its related secondaries/dialogs.
- **`<system> — Catalog`** — the remainder (everything not a theme or on a
  screen).

A catalog with neither themes nor `screens` — and any design-led import — stays a
single flat page as before.

## Correspondence export

Because the plugin *creates* the frames, it knows each imported component's
Figma node id — the one thing correspondence needs. After an import it emits a
[`design-map.json`](https://github.com/yschimke/design-parity/tree/main/packages/core#design-map)
linking each code component to the frame it placed, shown in a panel to copy and
commit into a consumer repo. Once committed, design-parity's resolver maps code
↔ design from it (its `Code Connect → design-map.json → name convention` chain).

![The correspondence panel — the emitted design-map.json](docs/ui-designmap.png)

It's a **scaffold**: the plugin fills the authoritative half of each entry —
`source: "figma"` and `ref: figma:<fileKey>/<nodeId>` — but a catalog carries
only a `componentId`, not the `file#symbol` code handle the schema requires, so
`code` is derived from the componentId (`Button/Filled` → `Button#Filled`) and
meant to be reconciled with the consumer's real component handle. A sample is
committed at [`docs/design-map.sample.json`](docs/design-map.sample.json). When
the file isn't saved yet (`figma.fileKey` is null) the ref carries a `FILE_KEY`
placeholder the panel flags.

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

- Generate true Code Connect (`*.figma.tsx`) rather than a design-map scaffold —
  needs each component's code import path, which the catalog doesn't yet carry.
