# @design-parity/diff

The source-agnostic diff engine. Consume a `(DesignReference, CandidateRender)`
pair — from any adapter plus the candidate renderer — and emit a deterministic
[`Verdict`](../core/src/types.ts), a markdown summary, and a
reference/candidate/diff triptych per image.

Per [docs/PRINCIPLES.md](../../docs/PRINCIPLES.md): the engine runs **only
committed, deterministic rules/config — no model calls at run time**, and the
verdict **leads with a11y + i18n**, then token compliance, then the raw visual
diff.

## Use

```ts
import { diff } from "@design-parity/diff";

const { verdict, summary, triptychs } = await diff(reference, candidate, {
  repoRoot,          // image `uri`s resolve against this (default: cwd)
  outDir: "out",     // optional: write triptych-<key>.png here
  // config: { spacingTolerance: 0, pixelThreshold: 0.05, ... },
  // checksConfig: { contrastLevel: "AAA" },  // a11y/i18n thresholds
  // checks: myProvider,   // swap the default @design-parity/checks provider
});
```

`verdict.status` is `pass | warn | fail` (any `error` finding ⇒ `fail`); findings
are ordered a11y → token → semantic → visual; `verdict.visualScores` maps each
`state/theme/size` key to its differing-pixel fraction.

## Dimensions

- **a11y + i18n** — delegated to [`@design-parity/checks`](../checks) (#10)
  through a [`ChecksProvider`](./src/checks.ts) seam: WCAG contrast, touch
  targets, semantic roles/labels, and i18n risks. `defaultChecks` wires the real
  package; inject a custom provider (or `checksConfig`) to override.
- **Token compliance** — flatten the candidate's tree tokens and compare against
  the reference spec: numeric tokens honour a committed tolerance, typography
  matches exactly, colours match modulo a full-alpha suffix (with a same-role
  value fallback). When the design and code token vocabularies differ, a
  `design-map.json` `tokens` alias (code-name → design-name) canonicalises the
  reference to code names first, so e.g. design `color/on-surface` lines up with
  code `onSurface`.
- **Design system** — a whole-palette audit: the reference's resolved token
  table (`DesignReference.themeTokens`, e.g. the Figma Variables) vs the code's
  resolved theme (`SemanticTree.themeTokens`), keyed through the same alias.
  Findings carry `detail.scope: "design-system"` so the orchestrator reports
  each drift once per run, not once per screen.
- **Semantics** — theme-coverage and structural (role/label) deltas.
- **Visual** — per-pixel diff via `pixelmatch`, plus the triptych.

Everything is committed config (see [`config.ts`](./src/config.ts)); the same
pair always yields the same verdict.

## Develop

```sh
npm run build --workspace @design-parity/diff
npm test --workspace @design-parity/diff
```
