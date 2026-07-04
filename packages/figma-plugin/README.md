# `@design-parity/figma-plugin`

The in-Figma client for design-parity's **code → design** direction. It imports
a published `@design-parity/catalog-export` catalog — a compose-preview-rendered
component system: sticker-sheet PNGs plus a DTCG token set — straight onto a
Figma canvas as authoritative renders, grouped by component group, alongside a
**variable collection** projected from the design system's tokens.

Figma is a *view* of the code, never the source of truth — the same stance the
upstream catalogs and the Figma roundtrip take. The render is authoritative;
the plugin only places it.

> **Prototype.** Today it imports the `ideal` sticker variant and builds the
> variable collection. The `layout` (wireframe) variant, greenline/redline
> annotation layers, and Code Connect authoring are planned — see *Roadmap*.

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
| [`src/plan.ts`](src/plan.ts) | pure (tested) | `buildImportPlan(manifest, opts)` → an `ImportPlan` describing every frame, image URL, and the Figma variable collection. No `figma`, no `fetch`. |
| [`src/dtcg.ts`](src/dtcg.ts) | pure (tested) | Slim, browser-safe DTCG token reader (core's `readDtcgTokens` is Node-only — it loads the schema from disk). |
| [`figma/ui.ts`](figma/ui.ts) | UI iframe | Fetches `catalog.json` + tokens + PNG bytes, runs the planner, posts the plan to the main thread. |
| [`figma/code.ts`](figma/code.ts) | main thread | Executes the plan against the scene: frames, image fills, variable collection. Mechanical. |
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

The plugin fetches the manifest, its DTCG token file, and every `ideal` PNG,
then lays out a `<system> — Catalog` page and creates a variable collection
(light/dark become Figma modes). Add your own live-preview host to the
manifest's `networkAccess.allowedDomains` to import from
`compose-preview serve` instead of GitHub.

## Roadmap

- `layout` (wireframe) variant toggle — the planner already accepts `variant`.
- Greenline (a11y) / redline (spacing) annotation layers from the manifest.
- Code Connect authoring: map imported frames back to code components.
- Wire the plugin's rendered output into the preview-diff workflow so plugin
  UI changes get before/after evidence automatically.
