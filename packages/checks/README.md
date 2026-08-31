# @design-parity/checks

Deterministic **accessibility + internationalization** spec checks over a
`(DesignReference, CandidateRender)` pair. These are the high-value, spec-backed
findings the verdict leads with (see
[docs/PRINCIPLES.md](../../docs/PRINCIPLES.md) Principle 2): the objective
details developers routinely miss and design tools don't enforce.

Every check is a **pure function** that reads committed thresholds and the
captured semantics — **no network call and no model at run time** (Principle 1).
The same PR always scores the same.

## Checks

| Function | Kind | What it asserts |
| --- | --- | --- |
| `checkContrast` | `contrast` | WCAG 1.4.3/1.4.6 text contrast per theme; fails AA → `error`, meets AA but not AAA → `info`. |
| `checkTouchTargets` | `a11y` | Interactive targets ≥ 48dp (Material 3); below the WCAG 2.5.8 floor of 24dp → `error`. |
| `checkSemantics` | `a11y` | Interactive/image nodes expose an accessible label / content description. |
| `checkTextExpansion` | `i18n` | Pseudolocale text growth vs available width → truncation risk (`warn`). |
| `checkLocaleFormatting` | `i18n` | Hardcoded locale-specific currency/date/number literals in labels. |
| `checkRtlMirroring` | `i18n` | Directional icons that must mirror under RTL; right-to-left text. |
| `checkHardcodedStrings` | `i18n` | Un-keyed user-facing literals (**opt-in** — a render can't prove a string came from a resource). |

`runChecks(reference, candidate, config?)` runs the whole suite and returns
findings **a11y first, then i18n**, severity-ordered within each group.
`runA11yChecks` / `runI18nChecks` run one group.

A contrast failure stays an error unless the reference semantic tree contains
the same foreground/background pair failing the same threshold. That exact
design-led match is reported as a warning with `sharedWithReference: true`: the
accessibility debt remains visible, while parity does not ask code to diverge
from its source. An absent or unassessable reference never suppresses a
candidate failure.

## Configuration

All policy is committed and overridable via `ChecksConfig` (contrast level,
touch-target minimum, glyph-advance estimate, themes, hardcoded-string opt-in).
Defaults live in [`src/thresholds.ts`](./src/thresholds.ts) and encode WCAG 2.2
+ Material 3 + standard pseudolocale guidance.

A repo commits these knobs to **`design-parity.checks.json`** — the file
`@design-parity/baseline` writes during bootstrap. It is read deterministically
at run time so its tuned thresholds actually reach the engine (Principle 1):

- `loadChecksConfig(path)` — read, parse, and schema-validate a config file;
  throws a readable error if it is missing, not JSON, or schema-invalid.
- `loadChecksConfigOrDefault(path)` — same, but a **missing** file resolves to
  the committed defaults, so a repo in steady state with no setup still works. A
  present-but-invalid file still throws.
- `validateChecksConfig(value)` — validate an already-parsed object against the
  draft-07 [schema](./schema/checks-config.schema.json).

The config shape mirrors `ChecksConfig` exactly, so bootstrap output validates
and loads without translation. See
[`examples/design-parity.checks.json`](../../examples/design-parity.checks.json).

### Validate CLI

`design-parity-validate-checks [path ...]` validates one or more config files
against the schema and exits non-zero on the first invalid one, so it can gate
CI. Defaults to `design-parity.checks.json` in the cwd.

```sh
node packages/checks/dist/cli/validate-checks.js design-parity.checks.json
```

## Finding kinds

This package introduced the dedicated `a11y` and `i18n` `FindingKind`s in
`@design-parity/core` so the verdict can cleanly lead with them. `contrast`
keeps its own kind (it carries a numeric ratio and is the headline a11y
finding). Focus order and state-announcement gaps are **not** asserted yet:
`SemanticNode` does not model them, so adding those checks is a contract change
in core — tracked rather than faked.

## Develop

```sh
npm run build --workspace @design-parity/checks
npm test
```
