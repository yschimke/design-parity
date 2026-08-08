# Documentation index

Everything under `docs/`, grouped by what you're trying to do. The root
[`README.md`](../README.md) is the project overview and the package table;
[`AGENTS.md`](../AGENTS.md) is the working guide for humans and agents editing
this repo.

## Start here

| Doc | What it covers |
| --- | --- |
| [PRINCIPLES.md](./PRINCIPLES.md) | The binding constraints on every package and issue. When a design decision is unclear, resolve it in favour of these. |
| [NON-GOALS.md](./NON-GOALS.md) | The roads deliberately not taken, with the reasoning — so they don't get reintroduced. A non-goal is not "never", it's "not without revisiting this". |

## Adopting and using it

| Doc | What it covers |
| --- | --- |
| [adopting-cmp.md](./adopting-cmp.md) | Putting a Compose Multiplatform project under design parity, end to end. The Desktop/JVM target renders previews with no Android emulator, making it the cheapest way to try the tool. |
| [candidate-sources.md](./candidate-sources.md) | The four candidate-render backends (static bundle, CLI, local-compose-web, daemon) behind one seam, and how a run picks or composes them. |
| [REFERENCE_CACHE.md](./REFERENCE_CACHE.md) | Importing the design side on its own schedule into a committed cache, so a parity run makes **zero** Figma calls. Why the coupled version silently reported on a quarter of a catalog, and how the split converges under a rate limit instead of thrashing. |
| [PARALLEL_PARITY.md](./PARALLEL_PARITY.md) | Running an **exhaustive** check — every component, not a hand-picked subset — by splitting one run across N parallel jobs and merging them. The reusable workflow, how to pick a shard count, and why the alternative (excluding previews to fit the timeout) buys speed with coverage. |
| [page-backdrops.md](./page-backdrops.md) | **Opt-in, off by default.** Importing key design pages as backdrops, linking every component instance on them to the code that implements it, and laying the code renders on top. |

## Contracts and formats

| Doc | What it covers |
| --- | --- |
| [correspondence-and-token-matching.md](./correspondence-and-token-matching.md) | How the bot decides *which* design a code preview is compared against, and how design colours and type styles line up with the code's. Documents what exists, names the gaps, proposes a phased plan. |
| [page-backdrop-contract.md](./page-backdrop-contract.md) | The `PageBackdropManifest` wire format: what design-parity's Figma page importer emits, and why the consumer — not the producer — decides how it is drawn. Includes the cross-repo compatibility rules a contract with an independently released producer needs. |
| [reference-cache.md](./reference-cache.md) | The reference cache's **structural half**: how component properties and variant axes are stored as ordinary cache entries, why they invalidate on the same file `version` as the renders, and what a cache-only run can answer offline because of it. |
| [report-format.md](./report-format.md) | Versioning of the published `verdict.json`, and how its finding/verdict shapes line up with the compose-ai-tools reporting-branch contract so both projects converge on one history format. |

## Code → design (catalogs)

The reverse direction: render a component system and publish it as importable
design artifacts.

| Doc | What it covers |
| --- | --- |
| [design-artifacts/PLAN.md](./design-artifacts/PLAN.md) | The plan for generating importable sticker sheets per component system, derived from rendered code so they're correct by construction. |
| [design-artifacts/REFERENCE_KITS.md](./design-artifacts/REFERENCE_KITS.md) | Why published Figma kits are **seed only** in a code-led pipeline, and what that means in practice. |
| [design-artifacts/FIGMA_IMPORT.md](./design-artifacts/FIGMA_IMPORT.md) | The last hop: turning a published `design-artifacts/<system>` delivery branch into an importable Figma sticker sheet, one file per system, and keeping it fresh. |
| [design-artifacts/FIGMA_IMPORT_V2.md](./design-artifacts/FIGMA_IMPORT_V2.md) | *Design spec / proposal.* Where the importer is going: structured pages, non-destructive reconcile keyed on identity rather than position, and mode-aware placement. |

## Research and verdicts

Written-up investigations. These record a conclusion and its reasoning so the
question doesn't get relitigated from scratch.

| Doc | What it covers |
| --- | --- |
| [cmp-web-wasm-feasibility.md](./cmp-web-wasm-feasibility.md) | Feasibility verdict on a Compose-for-Web / wasm candidate backend, and why it is a deliberate stub. |
| [claude-design-sync-impact.md](./claude-design-sync-impact.md) | What Claude Design's move to beta and its `/design-sync` bridge changed for the `claude-design` source, whose whole premise was that no read API existed. |

## Assets

- [`images/`](./images) — screenshots referenced by the docs above.

Fixtures live outside this tree, in [`fixtures/`](../fixtures/README.md): one
golden reference per source plus a candidate render, so every package builds and
tests against stubs with no live design source or renderer.
