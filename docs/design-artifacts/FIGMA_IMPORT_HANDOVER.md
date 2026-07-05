# Figma import — handover

> **Purpose.** Pick-up notes for the next session working on the code→design
> Figma import. Captures (a) what actually exists on `main` today, (b) the
> per-screen "diff section" direction, (c) the four import cases the process
> must cover, and (d) the concrete next steps — including the skill we have
> **not** written yet.
>
> Read this first, then `FIGMA_IMPORT_V2.md` (the design spec) and the
> `@design-parity/figma-plugin` README (what's built).

## TL;DR

- **Built & merged:** a real Figma plugin (`@design-parity/figma-plugin`) that
  imports a published catalog onto canvas — ideal/layout variant toggle, a11y
  greenlines, spacing redlines, a token→variable collection, and a
  `design-map.json` correspondence export. Plus the v1 MCP runbook and the v2
  spec.
- **Not built yet:** the *structured, per-screen, mode-aware, non-destructive*
  importer described in `FIGMA_IMPORT_V2.md` — including the **per-screen diff
  section** below, and the **reconcile engine** that keeps designer work.
- **Not written yet:** a **skill** covering the import *process* and its cases
  (code-led vs design-led × new vs existing Figma). Today that knowledge is
  spread across a runbook + a plugin README + this spec. Proposed name and
  shape are in [The skill we still owe](#the-skill-we-still-owe).
- **Verify before acting:** the per-file Figma state (esp. cadence) and the
  weekly trigger are inherited from a prior *borked* session and are **not**
  git-verifiable — treat the table in [Live Figma state](#live-figma-state-verify)
  as claims to check, not facts.

## What exists today (on `main`)

| Piece | Where | What it does |
| --- | --- | --- |
| **v1 import runbook** | [`FIGMA_IMPORT.md`](./FIGMA_IMPORT.md) | Agent-session (Figma MCP) runbook: prep → `upload_assets` → `use_figma` layout of a **flat sticker sheet**, one file per system. Delete-and-rebuild on re-import. |
| **Deterministic prep** | `scripts/figma-import-prep.mjs` | Fetches a `design-artifacts/<system>` branch, downloads renders, writes `board.json` + `order.tsv`. The headless half. |
| **v2 design spec** | [`FIGMA_IMPORT_V2.md`](./FIGMA_IMPORT_V2.md) | The structured / mode-aware / non-destructive target. Principles: identity-not-position, mode-aware placement, page structure. **Design only — not implemented.** |
| **Figma plugin** | `packages/figma-plugin` (`@design-parity/figma-plugin`) | In-Figma client. Imports a catalog as authoritative renders grouped by group; **ideal render + a11y greenlines** OR **layout wireframe + spacing redlines** (UI toggle); a **variable collection** from DTCG tokens (light/dark → Figma modes); emits a **`design-map.json`** correspondence scaffold. |
| **Correspondence** | `design-map.json` (#178) | The plugin knows each placed node id, so it emits `design-map.json` linking each `componentId` → the frame it placed; the resolver consumes it (Code Connect → design-map → name convention). |
| **MCP allowlist** | merged in #173 | Figma MCP tools, `create_trigger`, `send_later` allowlisted for agent sessions — the "permission stream closed" thrash from the borked session is fixed at source. |

**Net:** we have a working *code-led, flat, per-system* import (both as an MCP
runbook and as a plugin). We do **not** have per-screen structure, variant
sets, in-place reconcile, or mode-awareness. That's all v2/v3.

## The direction: a diff **section per screen**

The next shape for the importer (refines `FIGMA_IMPORT_V2.md` §"page
structure"). Each **main screen gets its own page**, and each page is a
top-to-bottom **diff section**:

```
┌─ <Screen> page ───────────────────────────────────────────┐
│                                                            │
│  1. FIGMA SPEC  (the design intent; the top of the page)   │
│     · seeded from code on first import, then designer-owned │
│     · shown across breakpoint VARIANTS, e.g. Wear:          │
│         small round  (< 227dp,  ≈192dp)                     │
│         large round  (≥ 227dp,  ≈227dp)                     │
│                                                            │
│  2. COMPARISONS  (below the spec, one row per state×bp)     │
│     ┌─────────┬──────────────────┬───────────────────────┐ │
│     │ a) Figma│ b) SVG from code │ c) exact PNG from code│ │
│     │  (spec) │ (semantics-      │  (capture — pixel     │ │
│     │         │  wireframe SVG)  │   truth)              │ │
│     └─────────┴──────────────────┴───────────────────────┘ │
│     related secondary screens & dialogs follow on the page │
└────────────────────────────────────────────────────────────┘
```

The three comparison lanes, and why each earns its place:

| Lane | Source | Role in the diff |
| --- | --- | --- |
| **a) Figma spec** | designer-owned frame (seeded from code on first import) | The design intent / source of truth in design-led mode. |
| **b) SVG import from code** | `compose/semantics-wireframe` (vector) | **Structural** truth — bordered layout, scales cleanly, diffs geometry without pixel noise. Pairs with the **redline** (spacing) overlay. |
| **c) exact PNG render from code** | `compose-preview` `capture` PNG | **Pixel** truth — what the code actually renders. Pairs with the **a11y greenline** overlay. |

Both overlays (greenline on the PNG, redline on the SVG) **already exist** in
the plugin — this section arranges them into a per-screen, per-breakpoint diff
rather than a flat sheet.

Two things this needs that don't exist yet (tracked in `FIGMA_IMPORT_V2.md`
"What v2 needs"):

1. **Screen-relationship metadata** in `catalog.spec.json` — which entries are
   *main screens* and their related secondaries/dialogs (a screen graph). Today
   groups are flat.
2. **The SVG lane as a first-class import** — the wireframe SVG is produced but
   the plugin currently places it as the *layout variant of a component*, not as
   lane (b) beside the PNG in a per-screen row.

Breakpoint variants (the "below/above 227dp" example) come from the per-system
breakpoint table already in [`REFERENCE_KITS.md`](./REFERENCE_KITS.md) — Wear =
small round ≈192dp / large round ≈227dp; Compose M3 = compact/medium/expanded.
v3's `state × breakpoint` component sets are the native-Figma expression of
this; the per-screen section is the human-readable one.

## The four import cases

The process must branch on **two axes**: who owns the source of truth
(`.design-parity.json` parity direction), and whether the Figma file already
has designer content. This is the matrix the process — and the skill — must
spell out:

|  | **New / empty Figma file** | **Existing designer file** |
| --- | --- | --- |
| **code-led** (code is truth) | Plugin **builds** the full catalog + per-screen pages and **owns** them. | **Reconcile by `componentId` stamp:** update matched nodes in place, add new, tag removed `stale`; **never touch un-stamped (designer) nodes.** No delete-and-rebuild. |
| **design-led** (Figma is truth) | Import renders **only** into a `Code renders (reference)` page beside the (empty) design — never pre-build designer structure. | Same reference-only placement, **plus a first-touch confirmation gate**: surface a diff and require confirmation before writing into a designer-owned file. Figma spec stays authoritative; renders are comparison-only. |

Direction resolves from each repo's committed **`.design-parity.json`**
(`auto → code-led | design-led`, the `@design-parity/policy` concept).
**Unresolved `auto` ⇒ treat as design-led** (safe default: never clobber a
designer).

Identity is what makes the "existing file" column safe: every node the importer
creates is stamped `setSharedPluginData("designParity", …)` with its `role` +
`componentId`. Reconcile is keyed by that stamp (and, for pre-stamp boards, by
layer-name `== componentId`). No stamp ⇒ designer content ⇒ off-limits. See
`FIGMA_IMPORT_V2.md` "Principle 0".

## The skill we still owe

**Answer to "have we written this up as a skill yet?" — no.** The `skills`
repo has `compose-design-catalog`, `compose-preview`,
`compose-preview-design-board`, `compose-preview-review`. They stop at
**producing** the catalog bundle. None covers the **Figma import hop** or its
four cases. That knowledge currently lives only in `FIGMA_IMPORT.md` (runbook),
the plugin README (plugin usage), and `FIGMA_IMPORT_V2.md` (spec) — three
places, none of them a skill an agent auto-loads when a user says "import this
into Figma."

**Proposed:** a `figma-catalog-import` skill in `yschimke/skills`, the
import-hop sibling of `compose-design-catalog` (which is the *produce* hop).
It should:

- **Decide the case first** — read `.design-parity.json` (direction) and probe
  the target file (empty vs designer content), then route to one of the four
  cells above. State the case out loud before writing anything.
- **Prefer the plugin, document the MCP runbook as fallback** — the plugin is
  the durable path (deterministic plan, overlays, variables, design-map); the
  MCP `use_figma` runbook is the agent-session fallback when the plugin can't be
  loaded. Cross-link both.
- **Never delete-and-rebuild** — describe reconcile-by-stamp as the only
  re-import path, and the confirmation gate for design-led first-touch.
- **Cover the per-screen diff section** — figma spec on top, breakpoint
  variants, then the three comparison lanes (figma / SVG / PNG) with their
  overlays.
- **Cross-repo note** per `skills/CLAUDE.md`: content-only repo, update
  `README.md`, don't bump the plugin version unless asked, `name:` matches the
  dir.

Until v2 lands, the skill can ship describing today's **code-led** capability
honestly and marking design-led / per-screen / reconcile as "coming with v2,"
so it's not vaporware.

## Live Figma state (verify — inherited from a borked session)

These come from a prior session whose Figma channel was dropping calls; they
are **not** git-verifiable. **Check with `mcp__Figma__get_metadata` before
acting**, don't trust the table:

| System | Figma file | Claimed state | Baseline sha (claimed) |
| --- | --- | --- | --- |
| homeassistant-remotecompose | `y9mCRmIAatmv8PMwKuSxm0` | re-imported, ~62 components, v1 + stamps | `292780e` |
| meshcore-mobile | `gYzowY4cQ7rNr2gYoco1M6` | re-imported, ~33 components, v1 + stamps | `25b2708d` |
| cadence | _(pending first import)_ | skeleton + 19 renders uploaded; **cards not populated** | `d85e41ef` |

If cadence's cards are genuinely unpopulated, finishing it is one idempotent
populate pass (it self-skips already-placed cards). But given the plugin now
exists, **prefer running the plugin** over resuming the hand-rolled `use_figma`
populate — the plugin is the path we're keeping.

**Weekly trigger:** the borked session intended to (re)create a weekly trigger
that re-runs the import for every system after the 06:00 UTC catalog regen,
carrying the baseline shas above. Confirm whether it exists (`list_triggers`)
and whether its baselines are current before creating a duplicate.

## Pick up here (suggested order)

1. **Verify live state** — `get_metadata` on the three files; `list_triggers`.
   Reconcile the table above with reality before touching anything.
2. **Land the skill** — write `figma-catalog-import` in `yschimke/skills`
   (honest about code-led-now, v2-later), update that repo's `README.md`.
3. **Implement v2a** — the reconcile engine in the plugin (`buildImportPlan`
   already produces the plan; add match-by-stamp + in-place update + add/stale)
   and the mode gate from `.design-parity.json`. This is what stops the
   delete-and-rebuild for real, not just in the runbook prose.
4. **Then v2b / v3** — per-screen pages + screen-graph spec field; then native
   component sets with `state × breakpoint` variants (needs the renderer to
   emit the multi-state/breakpoint matrix). Order and dependencies are in
   `FIGMA_IMPORT_V2.md` "Phasing".

## Note for whoever pushes this

This branch was handed over as `claude/figma-import-reconcile-ztebm9`. The
user's global convention (`~/.claude/CLAUDE.md`) is `agent/…` branches with **no
agent attribution** in commits/PRs — Author/Committer/message come from the
human `git config`. Confirm the branch name and the committing identity with the
user before pushing; don't commit under an agent identity and fix it after.
