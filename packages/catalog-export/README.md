# @design-parity/catalog-export

Turn a rendered Compose **component system** into an importable **design-artifact
catalog** — the code → design-tool direction of design-parity.

Where the rest of design-parity proves a PR is at parity with a design, this
package goes the other way: it takes a whole component system (Compose M3, Wear
Compose M3, Glimmer, Glance, …), rendered by the upstream
[`compose-preview`](https://github.com/yschimke/compose-ai-tools) CLI, and lays
it out as a **sticker sheet** designers can import into Figma, Google Stitch, or
Claude Design.

The pipeline is **code-led**: every value comes from the renderer's own data
products, so the catalog is correct by construction. Published design kits are
seed/reference only — see
[`docs/design-artifacts/REFERENCE_KITS.md`](../../docs/design-artifacts/REFERENCE_KITS.md).

## What it produces

For each component, in its primary modes (state × theme × size):

- **Two variants** — the `ideal` render (the capture PNG) and the `layout`
  render (the `compose/semantics-wireframe` bordered view, so padding / gaps /
  structure are visible).
- **A greenline layer** — accessibility annotations anchored to the render:
  *issue* greenlines from the renderer's a11y / contrast / i18n findings, and
  `info` *spec* greenlines documenting each interactive node's role and measured
  touch-target size.
- **A redline layer** — the layout spacing spec: for each node with geometry, its
  box plus the content `padding`, inter-slot `gap` (`Arrangement.spacedBy`), and
  corner radius — so a component and its slots each carry an importable box +
  spacing, not just a picture. (Walks the semantics tree, so a slot with no
  semantics — a decorative icon — has no box; full slot coverage is a
  renderer-side follow-up.)
- **A token set** — the system's resolved `colors` / `typography` / `radius`
  (shapes), exported as a W3C **DTCG** file plus a **Figma variable-collection**
  projection (light/dark as modes).

The on-disk bundle is a superset of the `@design-parity/adapter-bundle`
`manifest.json`, so a catalog round-trips back through the parity flow.

## Use

```ts
import {
  buildCatalog,
  writeCatalog,
  type ComponentSource,
} from "@design-parity/catalog-export";

// `sources` are normalized via @design-parity/candidate's data-product mappers
// (nativeFindings, semanticsToSemanticTree, composeThemeToTokens).
const catalog = buildCatalog(
  { system: "compose-m3", title: "Compose Material 3" },
  sources satisfies ComponentSource[],
);

await writeCatalog(catalog, ".design-artifacts/compose-m3", {
  sourceRoot: "build/compose-previews",
});
```

Output:

```
catalog.json            # the index: provenance, components, variants, greenlines
tokens.dtcg.json        # the system token set (W3C DTCG)
figma-variables.json    # Figma variable-collection projection
images/<component>/<variant>__<state>[__theme][__size].png
```

## Layout

| Module | Role |
| --- | --- |
| `types.ts` | The `Catalog` / `CatalogComponent` / `Greenline` model. |
| `ingest.ts` | `buildCatalog` / `buildComponent` from normalized inputs. |
| `greenlines.ts` | Findings + semantics → the greenline annotation layer. |
| `manifest.ts` | The pure `catalog.json` builder (paths only, no I/O). |
| `figma.ts` | `DesignTokens` → a Figma variable collection. |
| `write.ts` | The one I/O step: materialize the bundle to disk. |

Depends only on `@design-parity/core`.
