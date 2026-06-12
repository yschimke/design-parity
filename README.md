# design-parity

A tool-neutral bot that proves a UI pull request is at **parity** with its
intended design. On a UI PR it (1) resolves which design reference matches the
changed component, (2) renders the new code (the *candidate*), (3) diffs
candidate vs reference (visual + semantic + token), and (4) posts a verdict in
the PR — e.g. *"implements Figma `Button/Primary`; padding 12dp vs spec 16dp;
dark-theme contrast fails AA."*

The candidate side is owned by the upstream
[`compose-preview`](https://github.com/yschimke/compose-ai-tools) renderer. The
value here is the **reference side** (Figma / Google Stitch / Claude Design) and
the **correspondence layer** that decides which design maps to which code
component.

## Architecture

One `ReferenceAdapter` interface, four drivers, a source-agnostic diff engine:

```
reference source ─┐
 figma (REST +    │   ┌──────────────┐      ┌───────────┐     ┌─────────┐
  Code Connect)   │   │ DesignReference│ ──▶ │ diff engine│ ──▶ │ Verdict │
 stitch (SDK)     ├─▶ └──────────────┘      └───────────┘     └─────────┘
 claude-design    │           ▲                   ▲
  (HTML export)   │           │                   │
 bundle (PNGs +  ─┘    correspondence        CandidateRender
  manifest)             resolver              (compose-preview)
```

Correspondence is resolved by **Code Connect** where available (Figma), else by
an in-repo [`design-map.json`](./examples/design-map.json), else by name
convention with a low-confidence flag.

Six principles shape the design — generate committed scripts over runtime AI;
lead with a11y + i18n; bootstrap a baseline for projects with no design system;
interactive for setup, unattended in steady state; parity has a committed
direction; and promote (never require) Compose Multiplatform for cheaper
rendering. See [docs/PRINCIPLES.md](./docs/PRINCIPLES.md).

## Packages

| Package | Status | What it owns |
| --- | --- | --- |
| [`@design-parity/core`](./packages/core) | ✅ this PR | Shared contracts (`DesignReference`, `CandidateRender`, `DesignTokens`, `SemanticTree`, `ReferenceAdapter`, `Verdict`) + the `design-map.json` schema, loader, and validator CLI. |
| [`@design-parity/adapter-figma`](./packages/adapters/figma) | ✅ #2 | Figma REST + Code Connect driver. |
| [`@design-parity/adapter-stitch`](./packages/adapters/stitch) | ✅ #3 | Google Stitch SDK + manifest driver. |
| [`@design-parity/adapter-claude-design`](./packages/adapters/claude-design) | ✅ #4 | Claude Design committed-HTML-export driver (no read API; rasterized headlessly, linked via `design-map.json`). |
| [`@design-parity/adapter-bundle`](./packages/adapters/bundle) | ✅ #32 | Image-bundle driver: a committed directory or `.zip` of reference PNGs + a `manifest.json` (no design-tool API, no HTML export), linked via `design-map.json`. |
| [`@design-parity/candidate`](./packages/candidate) | ✅ | `compose-preview` CLI wrapper → `CandidateRender`. |
| [`@design-parity/diff`](./packages/diff) | ✅ #6 | Visual + semantic + token diff → `Verdict` (a11y + i18n first, then tokens, then pixels). |
| [`@design-parity/resolver`](./packages/resolver) | ✅ | Correspondence (code ↔ design): Code Connect → `design-map.json` → name convention. |
| [`@design-parity/checks`](./packages/checks) | ✅ #25 | a11y + i18n spec checks (the high-value findings) + the committed `design-parity.checks.json` (schema, loader, validator CLI) so bootstrap's tuned thresholds reach the engine at run time. |
| [`@design-parity/baseline`](./packages/baseline) | ✅ | Detect maturity (3 rungs); materialize a concrete parity direction; bootstrap an opinionated committed baseline (tokens, starter `design-map.json`, check config) when there's no design system. Interactive CLI; never on the Action path. |
| [`@design-parity/policy`](./packages/policy) | ✅ issue #12 | Committed `.design-parity.json` (schema, loader, validator CLI) + the deterministic `auto` → `design-led`/`code-led` direction resolver. |
| [`@design-parity/action`](./packages/action) | 🚧 #8 | Orchestrator + CLI landed (registry → resolve → diff → policy → report); GitHub Action surface next. |
| [`@design-parity/report-html`](./packages/report-html) | ✅ #31 | Per-run self-contained HTML comparison page: reference \| candidate \| diff side by side with the verdict findings, inlined to one offline `.html` (data-URI PNGs + inline CSS/JS, no external assets). Deterministic; leaf consumer. |

`fixtures/` holds one golden reference per source plus a candidate render, so
every package can be built and tested against stubs with no live source or
renderer. See [`fixtures/README.md`](./fixtures/README.md).

## Develop

```sh
npm install
npm run build      # tsc --build across the workspace
npm test           # vitest
npm run validate   # validate design-map.json against the schema
```

Requires Node ≥ 22.

## Contributing

See [AGENTS.md](./AGENTS.md). In short: conventional commits, one issue per
branch + PR, human-only git authorship, and `agent/...` branch names.
