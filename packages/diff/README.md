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
- **Design system** — a whole-table audit: the reference's resolved token table
  (`DesignReference.themeTokens`, e.g. the Figma Variables + type ramp) vs the
  code's resolved theme (`SemanticTree.themeTokens`), keyed through the same
  alias. Covers colours (mode-aware), the type ramp (exact, spec-driven), and the
  numeric `radius`/`spacing` scale (within the committed tolerance). Typography
  and shape/spacing names resolve through the alias first, then the Material role
  they denote (`Body/Large` → `bodyLarge`, `radius/medium` → `medium`). Findings
  carry `detail.scope: "design-system"` so the orchestrator reports each drift
  once per run, not once per screen.
- **Semantics** — theme-coverage and structural (role/label) deltas.
- **Visual** — per-pixel diff via `pixelmatch`, plus the triptych.

Everything is committed config (see [`config.ts`](./src/config.ts)); the same
pair always yields the same verdict.

## Scoped known differences

Pass exact catalog scope for any visual pair that should consume
`.design-parity/known-differences.json`:

```ts
const result = await diff(reference, candidate, {
  repoRoot,
  knownDifferences: {
    scopes: {
      "default/light": {
        system: "m3",
        component: "IconButton/Tonal",
        previewId: "iconbutton-tonal__ideal__default__light",
        referenceId: "iconbutton-tonal-ideal-light",
        variant: "ideal/default/light",
        overrides: {},
        referenceSha256,
      },
    },
  },
});
```

The map key is the same `state/theme/size` key used by `visualScores`. Scope is
explicit because these catalog identities cannot be reconstructed safely from a
source-code handle. `result.acceptances` reports `raw`, `accepted`, and
`unaccepted` separately plus the status of every record. The original
`verdict.visualScores`, visual findings, and triptych are unchanged: accepting a
difference never deletes the raw finding.

Only `valid` masks enter the scoring union. Gate evaluation precedes that union,
and both inputs are split before any resampling, so a resolved/invalidated mask
cannot suppress neighbouring pixels and an accepted delta cannot cancel an
opposite regression at a mask edge.

## Develop

```sh
npm run build --workspace @design-parity/diff
npm test --workspace @design-parity/diff
```
