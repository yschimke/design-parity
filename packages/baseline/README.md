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
- `design-map.json` — components that authored a binding next to them — a
  `@DesignRef("figma:…")` annotation or a `design-ref:` comment — become **real,
  high-confidence entries** (source inferred from the ref). The rest, discovered
  by name convention, are surfaced as **low-confidence review items** to wire to
  a design source later. With no authored refs the manifest is an empty scaffold.

This is the design→code half of the binding: the code references its design
element, and the resolver's `buildReverseIndex` inverts the manifest so a design
node can answer "what implements me?" without Code Connect.

## Compose Multiplatform (Principle 6)

`detectMaturity` also reports whether a repo is **Compose Multiplatform (CMP)
capable** — `cmpCapable: boolean` plus an evidence trail (`cmp.signals`) from a
bounded scan of Gradle build files (`build.gradle{,.kts}`, `settings.gradle*`,
`libs.versions.toml`). This is **orthogonal to the maturity rung**: a repo at any
rung may or may not be CMP-capable.

When a repo is **not** CMP-capable, `cmpSuggestion()` returns a non-blocking
advisory ("Compose Multiplatform would render candidates on the JVM/desktop with
no emulator — consider it"), surfaced via `plan.cmpSuggestion` and the CLI.
**Never a gate** — plain Jetpack Compose stays fully supported.

The live CMP render path (preferring `compose-preview`'s desktop/JVM render in
`@design-parity/candidate` when capable, plus a Compose-for-Web/wasm spike) is
deferred — it needs the JVM/Compose toolchain. See [docs/cmp.md](./docs/cmp.md).

## CLI

```sh
design-parity-bootstrap [--dir <path>] [--direction design-led|code-led] [--yes] [--force]
```

Interactive setup, run once locally; commit the artifacts it writes. It refuses
to run in CI — the GitHub Action enforces committed artifacts, it never
bootstraps.
