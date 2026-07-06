# Importing a design-artifact catalog into Figma

The code→design direction ends at a `design-artifacts/<system>` delivery branch
(`catalog.json` + `images/` + `wireframes/`), produced by each repo's
`design-artifacts.yml` and served by the public preview site. This doc covers the
last hop: turning that published catalog into an importable **Figma sticker
sheet** — one file per design system — and keeping it fresh.

## Development plugin import

For the in-Figma catalog importer in this repo, load the development plugin from
the local manifest:

```text
packages/figma-plugin/figma/manifest.json
```

Figma path: *Plugins → Development → Import plugin from manifest…*.

Inside the plugin, use this default **Catalog base URL**:

```text
https://raw.githubusercontent.com/yschimke/compose-ai-tools/refs/heads/design-artifacts/compose-m3
```

This is the raw root containing `catalog.json`; do not append `/catalog.json`.
The plugin appends it when fetching the catalog.

It is deliberately a **runbook for an agent session** (Claude Code with the Figma
MCP), not a headless script: placing images and laying out the board require the
Figma MCP tools `upload_assets` and `use_figma`, which only exist inside an agent
context. The deterministic half (fetch + download + shape) is owned by
[`scripts/figma-import-prep.mjs`](../../scripts/figma-import-prep.mjs).

## File registry

| System | Delivery branch | Figma file |
| --- | --- | --- |
| meshcore-mobile | `design-artifacts/meshcore-mobile` | [`gYzowY4cQ7rNr2gYoco1M6`](https://www.figma.com/design/gYzowY4cQ7rNr2gYoco1M6) |
| homeassistant-remotecompose | `design-artifacts/homeassistant-remotecompose` | [`y9mCRmIAatmv8PMwKuSxm0`](https://www.figma.com/design/y9mCRmIAatmv8PMwKuSxm0) |
| cadence | `design-artifacts/cadence` | _(pending first import)_ |

## Environment prerequisites

These bite in exactly the order below — check them first, fail fast, do **not**
half-import:

1. **Figma connector present.** The session needs the Figma MCP tools
   (`mcp__Figma__whoami` succeeds). Interactively-authenticated connectors can be
   absent in headless/scheduled sessions — if so, stop and ask a human to log in.
2. **`mcp.figma.com` egress allowed.** `upload_assets` hands back submit URLs on
   `mcp.figma.com`; the image bytes are POSTed there. On a sandboxed runner this
   host must be on the egress allowlist or the POST returns `403 CONNECT`. This is
   a hard dependency, because…
3. **…there is no URL→image path inside `use_figma`.** In the plugin sandbox
   `fetch` is `undefined` and `figma.createImageAsync` throws *"not a supported
   API"*, so you cannot pull the render PNGs from their `raw.githubusercontent.com`
   URLs directly. `figma.createImage(bytes)` exists but base64-in-code blows the
   ~50 KB `use_figma` code limit for larger PNGs. Net: every image goes through
   `upload_assets`.

## Steps

### 1. Prep (deterministic)

```sh
node scripts/figma-import-prep.mjs \
  --repo yschimke/meshcore-mobile \
  --branch design-artifacts/meshcore-mobile \
  --out .figma-import/meshcore-mobile
```

Downloads every render, writes `board.json` (the layout model, `nodeId: null`
placeholders) and `order.tsv` (components in catalog order). For a *re*-import,
first compare the branch HEAD sha (`mcp__github__list_branches`) against the last
imported sha — if unchanged, skip the system.

### 2. Upload the renders

- `upload_assets(fileKey, count = <number of rows in order.tsv>)` → N submit URLs.
- POST each `images/<slug>.png` to `url[i]` as **multipart/form-data** with
  `filename="<slug>.png"` (the multipart filename becomes the Figma layer name),
  in `order.tsv` order. Each POST response carries `placedOnNodeId`.
- Splice those ids into `board.json`'s `nodeId` fields (same order).

```sh
# with SUBMIT_URLS a newline file of the N urls, in returned order:
paste .figma-import/<sys>/order.tsv SUBMIT_URLS | while IFS=$'\t' read -r cid path slug url; do
  curl -sS -X POST -F "file=@.figma-import/<sys>/$path;filename=${slug}.png;type=image/png" "$url"
done
```

### 3. Lay out the board (`use_figma`, load `resource:figma-use` first)

Build one file per system. Keep to ~10 logical ops per `use_figma` call — split
the skeleton from the card population, and split large groups across calls.

- **Root:** a vertical auto-layout frame `"<title> — Design Catalog"`, fixed
  width (~1360), light background, with a header (title + a provenance sub-line:
  renderer, `generatedAt`, `source` repo/ref/module, source branch).
- **Per group:** a vertical block = heading (Inter Semi Bold 24) + a full-width
  rule + a horizontal **`layoutWrap: "WRAP"`** row.
- **Per component:** a fixed-width (380) vertical card containing, in order:
  the render (reparent the uploaded frame by its `nodeId`, resize to preserve
  aspect at the card's inner width, corner radius 8, clip), the `componentId`
  (Inter Semi Bold 15), a `state · theme · size` chip line, the caption (Inter
  Regular 13, grey, 135% line height), and a `Live preview ↗` text with a URL
  hyperlink (`setRangeHyperlink`) to the image's `livePreview`.

Finish with `get_screenshot` on the root to verify (check for clipped text and
overlaps).

For a re-import, delete all existing top-level frames on the first page and
rebuild from scratch — do not try to diff in place.

## Scheduling

A durable weekly trigger (fresh session, Mondays after the 06:00 UTC catalog
regen) runs this runbook for every system, guarded by the environment
precheck above, and reports which systems changed. Because the trigger prompt
can't be edited after creation, keep the standing procedure here and keep the
trigger prompt thin (a pointer to this doc + the file registry + last-imported
shas).

## Known gaps

- The delivery bundle carries `catalog.json` + `images/` + `wireframes/` but not
  `figma-variables.json` / `tokens.dtcg.json`, so the import is a **render
  sticker sheet**, not native Figma variables/components. Emitting the Figma
  variable projection onto the delivery branch would let a second pass build a
  real variable collection (light/dark modes) beside the sheet.
- Each repo's `design-artifacts.yml` is copy-paste with per-repo edits (module,
  CLI-version pin, setup steps). A `workflow_call` reusable workflow in
  `compose-ai-tools` would collapse them and keep the CLI/plugin pin in one place.
