# AGENTS.md

Instructions for humans and AI agents working in this repo.

## What this repo is

`design-parity` is a TypeScript/Node monorepo. The orchestration, adapters, and
PR surface are TypeScript; candidate rendering shells out to the published
`compose-preview` CLI (JVM) — **do not reimplement rendering**. Delivery is a
GitHub Action that comments on PRs.

## Layout

- `packages/core` — shared contracts + `design-map` schema. **Every other
  package depends only on `@design-parity/core` for shared types.** Keep it
  source-agnostic.
- `packages/adapters/{figma,stitch,claude-design}` — one `ReferenceAdapter`
  driver each.
- `packages/{candidate,diff,resolver,action}` — candidate wrapper, diff engine,
  correspondence resolver, GitHub surface.
- `fixtures/` — golden references and a candidate render. Code against these;
  don't require a live source or renderer in unit tests.

## Conventions

- **Conventional commits** (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) for
  commit subjects and PR titles.
- **One issue = one branch + one PR.** Open the PR when the issue's acceptance
  criteria pass. Branch names use `agent/...`.
- **No AI-agent attribution in git history.** Author/committer must be a human
  identity; no `Co-authored-by` / `Signed-off-by` / `claude.ai/code` trailers.
- New packages are `@design-parity/<name>`, ESM (`"type": "module"`),
  `NodeNext` module resolution, and join the workspace via `packages/*` or
  `packages/adapters/*`.

## Design facts (verified — do not re-derive)

- **Figma is the keystone**: the only source with a machine-resolvable
  design↔code link (Code Connect). In CI use the **REST API + Code Connect
  CLI**, not the Dev Mode MCP server (that's local/desktop-oriented).
- **Google Stitch** ships `@google/stitch-sdk` + an MCP server but has **no
  Code Connect equivalent** — link via `design-map.json`.
- **Claude Design** is a research preview with **no read API** and no Figma
  export. Consume the reference as a committed HTML export, rasterized
  headlessly, linked via `design-map.json`.
- Maturity for the bot: Figma (machine link) > Stitch (SDK, manifest) >
  Claude Design (HTML export, manifest).
