# Design-artifact catalogs — plan

Generate high-quality, importable **sticker sheets** for each Compose component
system, derived from the *rendered code* so they are correct by construction.

## Goal

For each component system, produce importable design artifacts:

- per-component **sticker sheets**, each component in its primary modes (state ×
  theme × size), with padding, text options (`maxLines` / overflow), and layout
  identified;
- **two variants** per component — the `ideal` render and a `layout` render that
  borders every composable (`compose/semantics-wireframe`);
- an extracted **token set** (typography / shapes / colours), and
- an accessibility **greenline** annotation layer;

laid out so it imports into Figma / Stitch / Claude Design, on **one branch per
design system**.

## Code is the source of truth

The pipeline is **code-led**. Every number — padding, corner radius, type,
colour, touch-target size — comes from the renderer's own data products, so the
output is authoritative. The published Figma kits
([`REFERENCE_KITS.md`](./REFERENCE_KITS.md)) are seed/reference for the one-off
import (inventory + naming); a kit/render divergence is a bug in the kit, not in
ours.

## Systems

| System | Library | Breakpoints / surfaces |
| --- | --- | --- |
| Compose M3 (**+ M3 Adaptive**) | `androidx.compose.material3` (+ `material3.adaptive`) | window size classes `compact` / `medium` / `expanded`, light + dark |
| Wear Compose M3 | `androidx.wear.compose.material3` | small/large round, square; dark-first |
| Glimmer (Android XR) | `androidx.xr.glimmer:glimmer:1.0.0-alpha07` | AI-glasses display surface(s) |
| Wear widgets / Glance | `androidx.glance` (app widgets + Glance Wear Widgets) | widget canonical layouts × cell sizes |

## Where everything lives

- **`compose-ai-tools/samples/`** — one Gradle `@Preview` **catalog module per
  system** (`@Preview` discovery is local-module only, so the components must be
  authored against each library). M3 first as the reference template, then
  replicate. See `samples/design-catalog-m3` and `docs/design/DESIGN_CATALOGS.md`
  in that repo.
- **`design-parity`** — `@design-parity/catalog-export` (this package set) turns
  the rendered data products into the importable catalog bundle. The
  `@design-parity/candidate` daemon mappers (`nativeFindings`,
  `semanticsToSemanticTree`, `composeThemeToTokens`) normalize the raw products
  upstream of it.
- **`skills`** — the `compose-design-catalog` skill documents the end-to-end
  workflow; pairs with `compose-preview` and `compose-preview-design-board`.

## Data products → artifacts (reuse, don't rebuild)

| Artifact | Source data product (compose-preview ≥ 0.16) |
| --- | --- |
| `ideal` variant | `capture` PNGs (override matrix: device / pseudolocale / display-filter) |
| `layout` variant | `compose/semantics-wireframe` (SVG + PNG) |
| padding / `maxLines` / overflow / bounds | `compose/semantics` v6 (`textOverflow`, `tokens.padding`, …) |
| token set | `compose/theme` v2 (`colorScheme` + `typography` + `shapes`) |
| greenlines | `a11y/atf` + `a11y/touchTargets` (+ `a11y-overlay` PNG) |

## Per-system output branch

Tooling lands on `main` via normal PRs. The generated importable artifacts are
committed to **one branch per system** — the delivery surface a designer pulls
from:

```
design-artifacts/compose-m3
design-artifacts/wear-m3
design-artifacts/glimmer
design-artifacts/glance-wear
```

Each holds the `catalog-export` bundle (`catalog.json`, `tokens.dtcg.json`,
`figma-variables.json`, `images/…`) for that system.

## Importing into Figma

The delivery branches are the handoff point; turning one into an importable
Figma sticker sheet (one file per system) and keeping it fresh is documented in
[`FIGMA_IMPORT.md`](./FIGMA_IMPORT.md), with the deterministic prep owned by
[`scripts/figma-import-prep.mjs`](../../scripts/figma-import-prep.mjs).

## Status

- ✅ `@design-parity/catalog-export` — model, ingest, greenlines, manifest, DTCG
  + Figma export, on-disk writer; unit-tested.
- ✅ Reference-kit catalogue + code-led principle ([`REFERENCE_KITS.md`](./REFERENCE_KITS.md)).
- 🚧 Per-system Gradle catalog modules (`compose-ai-tools/samples`) — M3 template
  first; Glance/Wear-widget capture and Glimmer XR headless render are the two
  feasibility spikes.
- 🚧 Per-system `design-artifacts/*` branches — produced by running the pipeline
  once the catalog modules render in CI.
