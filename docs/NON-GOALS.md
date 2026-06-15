# Non-goals

Deliberate boundaries — things design-parity has decided *not* to do, with the
rationale, so they don't get reintroduced later. A non-goal is not "never";
it's "not without revisiting this reasoning." Complements
[PRINCIPLES.md](./PRINCIPLES.md) (the binding constraints) by recording the
roads not taken.

## Style Dictionary token-codegen for Compose candidates (issue #88)

**design-parity does not adopt [Style Dictionary](https://styledictionary.com/)
as a token-codegen pipeline for Compose candidates, and does not assume
consumers run one.**

It's tempting, because the token ecosystem's standard move is "tokens are the
single source of truth → generate platform code from them," and Style Dictionary
is the tool-agnostic generator for that. But for mobile Compose specifically it
fights the grain:

- **Compose theming isn't resource-based.** Idiomatic Compose is
  `MaterialTheme` / `ColorScheme` / `Typography` / `Shapes` as Kotlin, not
  Android XML resources. Style Dictionary's Android outputs default to XML
  resources Compose doesn't naturally consume; the Compose/Kotlin format exists
  but is community-maintained and non-standard.
- **The canonical "tokens → Compose" path is Google's
  [Material Theme Builder](https://m3.material.io/theme-builder)** (it emits
  `Color.kt` / `Theme.kt` from the M3 token model), not Style Dictionary. If we
  ever want a "generate the theme from tokens" loop, that's the target.
- **Most Compose apps don't run Style Dictionary.** It's mainly large
  multi-platform (web + iOS + Android) design-system orgs. Assuming it would
  push an unwanted build step onto the typical consumer.
- **design-parity verifies, it doesn't generate.** Per
  [Principle 1](./PRINCIPLES.md#1-generate-scripts-dont-put-ai-in-the-loop) the
  bot's job is the grounded diff/verdict; a codegen pipeline is a different
  product surface and out of scope for the diff path.

### What we do instead

- Accept **DTCG token files on the reference side** as a standards-based
  token-spec format (issue #89) — `@design-parity/core`'s DTCG reader.
- Anchor the **token diff on Material/Compose semantic roles**, with a
  DTCG → role mapping layer (issue #87), comparing the candidate's *resolved*
  roles against mapped reference values.

If a "generate the theme from tokens" loop is ever wanted, target Material Theme
Builder output — revisit this entry before reaching for Style Dictionary.
