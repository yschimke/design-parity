# @design-parity/baseline

Detect a repo's design-system maturity and, for a repo with no design system,
bootstrap an opinionated **committed** baseline. This is the one place AI
generates artifacts (see [docs/PRINCIPLES.md](../../docs/PRINCIPLES.md),
Principles 1, 3, 4, 5); the steady-state Action only runs what this writes.

## Maturity rungs

`detectMaturity(repoRoot)` classifies a repo by scanning committed files,
returning core's `MaturityRung`:

1. **`machine-link`** — Figma Code Connect (`figma.config.json` or
   `*.figma.{tsx,kt,swift,…}`). → direction `design-led`.
2. **`manifest`** — a `design-map.json` or a design-token source
   (`*.tokens.json`, a `tokens/` tree, Style Dictionary). → `code-led`.
3. **`bootstrap`** — neither. → `code-led`, and **bootstrap**.

Direction resolution is delegated to `@design-parity/policy` so setup and the
Action's late fallback agree.

## Bootstrap (`bootstrap` rung)

`planBootstrap` decides what to write; `applyBootstrap` writes it. Every rung
gets a concrete parity direction in policy's committed `.design-parity.json` —
`auto` is never left behind. The `bootstrap` rung additionally gets:

- `design-tokens.json` — Material 3 + WCAG AA + i18n-ready token baseline,
- `design-parity.checks.json` — `@design-parity/checks`'s `ChecksConfig`
  (WCAG AA, hardcoded-string lint on),
- `design-map.json` — a schema-valid starter scaffold. Components discovered by
  name convention are surfaced as **low-confidence review items** to wire to a
  design source later.

## CLI

```sh
design-parity-bootstrap [--dir <path>] [--direction design-led|code-led] [--yes] [--force]
```

Interactive setup, run once locally; commit the artifacts it writes. It refuses
to run in CI — the GitHub Action enforces committed artifacts, it never
bootstraps.
