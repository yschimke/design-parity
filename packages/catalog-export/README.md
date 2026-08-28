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
- **Source identity** — every render retains the fully-qualified Compose
  `previewId` that produced it. This is per image, so separate light/dark or
  state previews remain machine-resolvable through `design-map.json` even when
  the catalog uses a friendlier component id.

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
themes/<theme>.dtcg.json # one per alternate named theme, when the system declares any
figma-variables.json    # Figma variable-collection projection
images/<component>/<variant>__<state>[__theme][__size].png
```

### Alternate themes

`tokens.dtcg.json` is the **system** token set: the one resolved theme the
stickers were rendered under. A system that declares alternate themes — a Compose
`@ThemeCatalog` / `@WearThemeCatalog` provider (Brand Light, High Contrast, a
watch face's night palette) — has more than one, and they differ in exactly the
way a token set describes: colours, and often the typeface too, since a theme is
free to swap the type scale.

Pass them as `buildCatalog`'s fourth argument (or `catalogFromCandidates`'
`themes` option) and each is written as its own DTCG file under `themes/`, listed
in the manifest:

```jsonc
"tokensFile": "tokens.dtcg.json",        // still the system token set
"themes": [
  {
    "id": "com.example.BrandDarkThemeCatalog",  // the provider FQN
    "name": "Brand Dark",
    "dark": true,
    "tokensFile": "themes/com.example.branddarkthemecatalog.dtcg.json"
  }
]
```

They are **never lifted from the renders** the way `themeTokens` is: a
component's semantics record the one theme it was rendered under, so the
generator — which knows which render belongs to which declared theme — supplies
them. That includes `dark`: the generator holds the surface the renderer composed
each specimen on, so it answers once here rather than leaving every consumer to
work it out from the palette and disagree. Absent means *unknown*, not light. A theme with a blank id or an empty token set is dropped rather than
published as something a consumer can select and find nothing behind, and a
repeated id keeps its first entry.

The `id` is the provider FQN because that is what a preview server's
`?theme=theme:<providerFqn>` deep link already names, so a consumer can join
these tokens to the theme a page is showing without a second mapping. That is the
point of publishing them at all: anything that wants to show what a theme **is**
rather than what it is called — a picker chip painted in the theme's own colours
and typeface, a per-theme Figma variable mode, a contrast audit across every
theme a system ships — needs the tokens, and re-rendering to recover them is the
expensive thing this export exists to avoid.

`figma-variables.json` stays a projection of the **system** token set only:
fanning it per theme is a variable-*modes* question for the importer to answer,
not one to guess at here.

## Layout

| Module | Role |
| --- | --- |
| `types.ts` | The `Catalog` / `CatalogComponent` / `Greenline` model. |
| `ingest.ts` | `buildCatalog` / `buildComponent` from normalized inputs. |
| `greenlines.ts` | Findings + semantics → the greenline annotation layer. |
| `redlines.ts` | Semantics → the redline (layout) annotation layer. |
| `annotations.ts` | Redlines + typography → the `compose-preview-annotations/v1` manifest. |
| `parityFindings.ts` | A run's verdicts → the `compose-preview-parity-findings/v1` manifest, with each finding anchored to the region it is about. |
| `manifest.ts` | The pure `catalog.json` builder (paths only, no I/O). |
| `figma.ts` | `DesignTokens` → a Figma variable collection. |
| `write.ts` | The one I/O step: materialize the bundle to disk. |

Depends only on `@design-parity/core`.

## The parity verdict (`parity/findings.json`)

The annotation layers above say what each side **is**. A comparison also needs
what a run **concluded** — that a label truncates once localized, that padding is
24 where the spec asserts 16, that the two frames were never comparable — and
neither an annotation nor a visual score can produce that: an annotation reports
both numbers without knowing which one the spec asserts, and a percentage moves
identically for a padding change and a colour change.

So `parityFindings.ts` projects a run's `Verdict`s into
`compose-preview-parity-findings/v1`, keyed by the ids a preview server routes
on and scoped by the reference each verdict compared against. `writeCatalog`
writes it when a caller passes `parityFindings` — a plain sticker-sheet export
has no verdicts and writes nothing, and neither does a run whose components all
passed.

The interesting half is the **anchors**: a finding has to say where it is, in
each panel's own pixel space, or the server can only print it as prose. Findings
carry no geometry, so it is recovered from the trees the run already diffed —
a box the check measured (`detail.bounds`, which the a11y checks emit) is used as
it stands; a `detail.label` is matched against each tree by label, the same match
`@design-parity/report-html`'s overlay makes, deliberately rather than a second
rule that could disagree with it; and a `token` finding anchors to each tree's
root frame, because that is the scope of the claim. Anything else gets no anchor
and reads as prose — a highlight pointing at the wrong element is worse than
none, since the reader has no way to tell.

## Annotation layers, and what they promise

A compare page draws two annotated columns — the render (`previews`) and the
design reference (`references`) — from the same walk, so a difference between
the two labels is a difference in the spec rather than in how each side was
measured. Two properties keep that true, and both are visible in the output:

- **Units.** A render resolves `dp`/`sp`; a design board reports its own pixels.
  A tree that carries a `density` (source px per dp) is converted into the code's
  units, and `detail` records `density` + `sourceUnit` so the original number is
  recoverable. A tree with no density has its own unit named (`text 52.5px`)
  rather than guessed at — quoting a 3× board's pixels as `sp` would invent a
  threefold discrepancy.
- **Provenance.** Spacing a source *declared* is a spec. Spacing measured off
  child geometry — which is how a hand-placed (non-auto-layout) design frame gets
  a layout layer at all — is an observation, prefixed `≈` in the label and tagged
  `detail.spacingSource = "derived"`.
