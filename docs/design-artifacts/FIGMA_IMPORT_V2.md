# Figma import v2 — structured, mode-aware, non-destructive

> Status: **design spec / proposal.** v1 (flat sticker-sheet) is shipped and
> documented in [`FIGMA_IMPORT.md`](./FIGMA_IMPORT.md). This describes where the
> importer is going. Companion to the `design-artifacts` catalog pipeline.

## Why v2

v1 imports a whole catalog as one flat "sticker sheet" board and **rebuilds it
by deleting and recreating** on every re-import. Two problems:

1. **Destructive.** A delete-and-rebuild nukes anything a designer added
   (annotations, moved frames, comments) and regenerates every node id, so
   nothing downstream is stable.
2. **Unstructured.** One long board doesn't match how designers actually work —
   they want tokens in one place, components (with their variants) in another,
   and each screen with its related secondary screens and dialogs together.

v2 makes the import **structured**, **non-destructive** (reconcile in place),
and **mode-aware** (respects who owns the source of truth).

## Principle 0 — identity, not position

Every node the importer creates is stamped with `setSharedPluginData("designParity", …)`:

| key | value |
| --- | --- |
| `role` | `catalog-root` / `page` / `group` / `group-row` / `card` / `image` / `title` / `caption` / `chips` / `link` |
| `componentId` | the catalog `componentId` (on `card` + `image`) |
| `system` | the design-system id (on root/pages) |

Re-import is a **reconcile keyed by `componentId`**, never by position:

- **match found** → update the render fill on the *same* image node (via
  `upload_assets` targeting that node id) + refresh caption/chip/link text. The
  card keeps its position, size, and any designer edits.
- **new in catalog** → add a card into its group/page.
- **gone from catalog** → tag it `stale`, don't delete.
- **no `designParity` stamp** → a designer's own content; **never touched.**

Bootstrapping: the v1 boards are already stamped, and the reconcile also matches
by layer name (`img.name === componentId`) so pre-stamp boards self-heal on the
first v2 run.

## Principle 1 — mode-aware placement (`.design-parity.json`)

The importer reads each repo's committed **parity direction**
(`.design-parity.json`, `auto → code-led | design-led` — the existing `@design-parity/policy` concept):

- **code-led** (code is source of truth): the importer **owns** the Figma
  catalog — it builds and reconciles the pages below directly. This is the
  current app repos (meshcore, cadence).
- **design-led / design-first** (Figma is source of truth): the renders are
  imported **only as a comparison reference**, into a dedicated
  **`Code renders (reference)`** page — and the importer **must not replace or
  restructure designer-owned content without explicit confirmation**, even on
  the very first import. The renders sit beside the design for parity diffing,
  they don't overwrite it.

`auto` resolves per the policy package's deterministic rules (maturity / who
moved last); the importer treats unresolved `auto` as design-led (safe default:
never clobber).

## Principle 2 — page structure

Instead of one board, the file gets **pages**:

1. **`Themes / Tokens`** — the theme-foundation showcases **and** the real design
   tokens as native **Figma variables** (collections with light/dark modes),
   projected from the system's DTCG token set.
2. **`Components`** — each component as a native Figma **component set**: states
   become **variant properties** (e.g. `ContactList` → `state = Empty | Few |
   Many`), with **breakpoint** as a second variant axis (`compact | medium |
   expanded`). One instance per cell; the set is the reusable artifact.
3. **`<Screen>` (one page each)** — each *main screen* with its **directly
   related secondary screens and dialogs** grouped on the same page (e.g.
   `Scanner` page = the scanner + its permission dialog + its empty/populated
   secondaries). Ordered by the app's primary navigation.

## What v2 needs that doesn't exist yet

Each of these is a discrete work item; none is just a layout change:

| Need | Where | Note |
| --- | --- | --- |
| **Figma variables** on the Tokens page | delivery branch + importer | The generated bundle must emit `figma-variables.json` (the `@design-parity/catalog-export` `writeCatalog` already produces it; the `generate-design-catalog.mjs` driver must stop dropping it). Then the importer creates a variable collection (not just the theme *picture*). |
| **Multi-state × breakpoint renders** | renderer + `catalog.spec.json` | Component sets need every `state × breakpoint` rendered. Today the catalog renders **one image per component**; `breakpoints` exists in the spec but isn't multi-rendered. Requires the compose-preview override matrix to fan out and the spec to declare the states per component. |
| **Screen-relationship metadata** | `catalog.spec.json` schema | Per-screen pages need to know which entries are *main screens* and their related secondaries/dialogs — a screen graph (`screens: [{ id, primary, related: […] }]`). Today groups are flat. |
| **Reconcile engine** | importer | Match-by-`componentId`, in-place render refresh, add/stale. Replaces the delete-and-rebuild. **Done in the plugin** (`figma-plugin/src/reconcile.ts` + `scene.ts`). |
| **Confirmation gate** | importer / trigger | design-led first-touch must confirm before writing into a designer-owned file. **Done in the plugin** (`direction.ts` + `scene.ts`): design-led dry-runs and writes to a separate `Code renders (reference)` page only on confirm. Automating the direction from `.design-parity.json` is the remaining thread. |

## Phasing

- **v1 (done)** — flat sticker-sheet, identity stamps, non-destructive reconcile
  foundation. meshcore / HA / cadence imported.
- **v2a — done (in the plugin).** Reconcile engine + mode gate.
  - *Reconcile engine:* the plugin stamps every node with its identity
    (`designParity` shared plugin data) and a re-import updates matched cards in
    place / adds newcomers / tags removed cards `stale`, keyed by `componentId`
    (`packages/figma-plugin/src/reconcile.ts` + `scene.ts`).
  - *Mode gate:* the parity direction (`packages/figma-plugin/src/direction.ts`,
    surfaced as the plugin's Mode selector) routes **design-led** imports onto a
    separate `Code renders (reference)` page and gates them behind an explicit
    confirm (dry-run first); **code-led** owns the catalog board as before. The
    one remaining thread is feeding the direction from the consumer repo's
    `.design-parity.json` automatically rather than via the UI selector.
- **v2b** — page structure: `Themes/Tokens` (with Figma variables), `Components`,
  per-screen pages. Needs `figma-variables.json` on the delivery branch and the
  screen-graph spec field.
- **v3** — native component sets with `state × breakpoint` variants. Needs the
  renderer to emit the multi-state/breakpoint matrix.

## Open questions

- **Component-set granularity:** one set per component with `state`/`breakpoint`
  axes, or per-(component,breakpoint)? (Leaning: one set, two axes.)
- **Screen graph source:** hand-authored in `catalog.spec.json`, or derived from
  the app's nav graph where one exists?
- **Removed components:** tag `stale` in place (proposed) vs. move to an
  `Archive` page vs. delete-with-confirm.
- **Variables vs. images on the Tokens page:** variables are the durable
  artifact; keep the theme-foundation *image* too as a human-readable overview,
  or variables only?
