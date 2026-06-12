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

One `ReferenceAdapter` interface, three drivers, a source-agnostic diff engine:

```
reference source ─┐
 figma (REST +    │   ┌──────────────┐      ┌───────────┐     ┌─────────┐
  Code Connect)   ├─▶ │ DesignReference│ ──▶ │ diff engine│ ──▶ │ Verdict │
 stitch (SDK)     │   └──────────────┘      └───────────┘     └─────────┘
 claude-design    │           ▲                   ▲
  (HTML export)  ─┘           │                   │
                      correspondence        CandidateRender
                       resolver              (compose-preview)
```

Correspondence is resolved by **Code Connect** where available (Figma), else by
an in-repo [`design-map.json`](./examples/design-map.json), else by name
convention with a low-confidence flag.

## Packages

| Package | Status | What it owns |
| --- | --- | --- |
| [`@design-parity/core`](./packages/core) | ✅ this PR | Shared contracts (`DesignReference`, `CandidateRender`, `DesignTokens`, `SemanticTree`, `ReferenceAdapter`, `Verdict`) + the `design-map.json` schema, loader, and validator CLI. |
| `@design-parity/adapter-figma` | issue #2 | Figma REST + Code Connect driver. |
| `@design-parity/adapter-stitch` | issue #3 | Google Stitch SDK + manifest driver. |
| `@design-parity/adapter-claude-design` | issue #4 | Claude Design committed-HTML-export driver. |
| `@design-parity/candidate` | issue #5 | `compose-preview` CLI wrapper → `CandidateRender`. |
| `@design-parity/diff` | issue #6 | Visual + semantic + token diff → `Verdict`. |
| `@design-parity/resolver` | issue #7 | Correspondence (code ↔ design). |
| `@design-parity/action` | issue #8 | GitHub Action / PR-comment surface. |

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
