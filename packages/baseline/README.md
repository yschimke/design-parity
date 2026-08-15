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

## Proposing references

A `design-map.json` entry is only useful once it names a real node, and node ids
are not discoverable without API access: a design tool's MCP server exposes only
the page a user is looking at, and Code Connect — which would hand the mapping
back directly — is gated behind a paid seat. So something has to guess which
node goes with which component.

`design-parity-propose-refs` is that guess. It fetches the design file's
components, ranks them against each code component by name, and prints the
`reference = "figma:<fileKey>/<nodeId>"` line to paste. It **writes nothing** —
the reference belongs wherever the repo keeps correspondence (an annotation, a
`design-map.json` entry), put there by a human who read the table.

```sh
FIGMA_TOKEN=figd_… design-parity-propose-refs \
  --file ocdacdEsnHipMJD3egzxKb \
  --previews catalog/build/compose-previews/previews.json
```

Subjects come from a compose-preview manifest (`--previews`), a convention scan
of the repo (`--dir`, the same discovery the bootstrap review list uses), or one
name at a time (`--subject`). Candidates come from `/v1/files/:key/components`
when the file publishes any, and from a page-by-page tree walk when it doesn't —
a community duplicate subscribes to the original library rather than
republishing it, and publishes nothing.

Ranking is token overlap over the shorter name, weighted: icons are dropped
outright (a glyph named `radio_button_checked` otherwise beats the real
`Checkbox` set on "Checkbox Checked"), and building blocks, other platforms' XR
components, and a kit's private `.`-prefixed components are demoted rather than
dropped so they can still win when nothing else fits. Ties go to the candidate
accounting for more of the subject — between `Button` and `Button - elevated`
for a `Button/Elevated`, the specific one — and a short stemmer bridges the two
spellings a boundary produces (`Checkboxes` for `Checkbox`, `outline` for
`Outlined`).

Measured against the 116 references a human accepted by hand for the
[m3-catalog](https://github.com/yschimke/m3-catalog) Material 3 kit, the top
proposal is the accepted node for 79 of them and it appears somewhere in the
three for 110. That measurement is a committed fixture
([`test/fixtures/m3-ref-proposals.json`](./test/fixtures/m3-ref-proposals.json))
with floors asserted in CI, so a change to the ranking has to say what it costs.

The `GOOD`/`MAYBE`/`LOW` label is a confidence band, not a verdict: a kit names
by its own taxonomy (`Button - tonal`, `Connected button group`), which does not
always agree with a component's documented name. The remaining misses are mostly
components whose accepted reference is not a component set at all — a specimen
sheet, one node inside a set — which no name match can reach.

## CLI

```sh
design-parity-bootstrap    [--dir <path>] [--direction design-led|code-led] [--yes] [--force]
design-parity-propose-refs --file <fileKey> [--previews <path> | --dir <path> | --subject <name>…]
                           [--limit <n>] [--json]
```

Interactive setup, run once locally; commit the artifacts it writes.
`design-parity-bootstrap` refuses to run in CI — the GitHub Action enforces
committed artifacts, it never bootstraps.
