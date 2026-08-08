# The versioned report format (`verdict.json`)

How design-parity's published report — `verdict.json` on the artifact branch
(`design-parity/<dev-branch>`) — is versioned, and how its finding/verdict
shapes line up with the [compose-ai-tools reporting-branch contract][cat-branch]
so the two projects converge on **one versioned history format** rather than
two ad-hoc ones (design-parity#71, companion to [compose-ai-tools#1866][cat-epic]).

## What design-parity publishes

`baseline` mode writes a stable, browsable layout to a permanent artifact branch
(see [`packages/action/README.md`](../packages/action/README.md)):

```
design-parity/<dev-branch>
├── index.html                      # landing page (overall verdict + per-component links)
├── verdict.json                    # machine-readable roll-up — BaselineSummary
├── tokens/
│   └── design-system.tokens.json   # the run's design-system tokens, as DTCG (when any)
└── <sanitised-component>/
    └── report.html                 # self-contained per-component triptych
```

`verdict.json` is the baseline a PR run loads to diff its candidate against
`main`. It is the design-parity counterpart to compose-ai-tools' on-branch
`manifest.json` + per-render `entry.json` sidecars.

### The published design-system token file

When a run exposes any design-system tokens, `baseline` mode also writes them as
a W3C DTCG document to a **stable, known location** —
[`DESIGN_TOKENS_PATH`](../packages/action/src/baseline.ts) =
`tokens/design-system.tokens.json` — and records that path in
`verdict.json.tokens` and as a link on `index.html`. Because the path never
changes, anything can consume it directly off the report branch:

```
https://raw.githubusercontent.com/<owner>/<repo>/design-parity/<dev-branch>/tokens/design-system.tokens.json
```

The table is aggregated across components (`designSystemTokens`), with the side
authoritative for the resolved **direction** winning on conflict: the candidate
render's resolved `themeTokens` in `code-led` (the shipped app's real table), the
reference's in `design-led`. Emitting **DTCG** (via `tokensToDtcg`, the inverse
of the reader) makes it a standards-based file any DTCG consumer reads — Style
Dictionary, Tokens Studio, **Claude Design's GitHub import** — which is the
recommended way to get a Compose/Kotlin app's tokens onto the Claude Design
canvas without a JS mirror (see
[`claude-design-sync-impact.md`](./claude-design-sync-impact.md)). `tokens` is an
additive optional field — it does **not** bump `formatVersion`.

## Versioning

`verdict.json` carries an explicit **`formatVersion`** integer
([`VERDICT_FORMAT_VERSION`](../packages/action/src/baseline.ts)) and a `$schema`
pointer to the published JSON Schema at
[`packages/action/schema/verdict.schema.json`](../packages/action/schema/verdict.schema.json).
The schema is exported from `@design-parity/action`
(`./schema/verdict.schema.json`) and validated against a committed fixture by
`packages/action/test/baseline.test.ts`.

The bump policy matches compose-ai-tools' (see its
[`schema/README.md`][cat-schema-readme]):

- **Additive** change (a new optional field) → **no bump**. Readers must ignore
  unknown fields; the schema does **not** set `additionalProperties: false` to
  shut out additive growth — except where the shape is closed today (it is, so a
  bump is required to add a field; relax this if additive growth is wanted).
- **Incompatible** change (rename/remove a field, change a type, tighten
  `required`) → **bump `formatVersion`** and revise the schema in the same change.

`formatVersion` versions the **`verdict.json` layout** — the analogue of the
`formatVersion` on the compose-ai-tools `manifest.json`, which likewise versions
the branch layout while each data-product file declares its own `schemaVersion`.

## Shape crosswalk

design-parity findings (`visual`/`semantic`/`token`/`contrast`/`a11y`/`i18n`/`layout`/`pairing`)
overlap with compose-ai-tools' archived a11y/semantics data. Where they describe
the same thing, the field conventions and severity vocabulary should stay
aligned; where they diverge, that is intentional and noted here.

### Top-level document

| design-parity `verdict.json` (`BaselineSummary`) | compose-ai-tools reporting branch | Notes |
|---|---|---|
| `formatVersion` | `manifest.json.formatVersion` | **Aligned** — integer, versions the on-branch layout. |
| `$schema` | (per-file schema in [`schema/`][cat-schema-readme]) | **Aligned** — points at the published schema. |
| `generatedAt` (ISO 8601) | `manifest.json.generatedAt` | **Aligned** — `date-time`. |
| `commit` | `manifest.json.commit` / `entry.json.git.commit` | **Aligned** — source-tree commit the report was rendered from. |
| `components[]` | `manifest.json.previews[]` | Parallel — design-parity keys on the **code handle**; compose-ai-tools keys on the **preview id**. |
| `direction`, `status`, `blocked` | — | **design-parity only** — parity is a pass/warn/fail gate; the renderer's history has no verdict. |

### Findings & severity

The full `Finding`/`Verdict` objects ([`packages/core/src/types.ts`](../packages/core/src/types.ts))
live in each component's `report.html`; `verdict.json` carries only the
per-component status + finding **count**. Their vocabulary maps to
compose-ai-tools' a11y findings ([`a11y-atf.schema.json`][cat-a11y]) as:

| design-parity `Finding` | compose-ai-tools `AccessibilityFinding` | Notes |
|---|---|---|
| `severity: "error"` | `level: "ERROR"` | **Aligned vocab**, different casing — design-parity uses lower-case `info`/`warn`/`error`, ATF uses `INFO`/`WARNING`/`ERROR`/`NOT_RUN`. A consumer maps `error↔ERROR`, `warn↔WARNING`, `info↔INFO`; design-parity has **no** `NOT_RUN` (a finding is only emitted when a check ran). |
| `severity: "warn"` | `level: "WARNING"` | Aligned. |
| `severity: "info"` | `level: "INFO"` | Aligned. |
| `message` | `message` | **Aligned** — one-line human-readable. |
| `kind: "a11y" \| "contrast"` | `type` (ATF check class) | **Overlapping** — both name the *kind* of a11y defect; design-parity's `kind` is a fixed taxonomy, ATF's `type` is the originating check class name. |
| `detail` (expected/actual deltas) | `viewDescription` / `boundsInScreen` | **Diverges intentionally** — design-parity's findings are *comparative* (candidate vs reference), so the payload carries deltas; ATF findings are *absolute* per-render. |
| `kind: "pairing"` | — | **design-parity only** — says the pair was not comparable (the reference depicts a different point in the component's property space) rather than reporting a difference. An `info` one states what the reference depicts; a `warn` one names the contradiction and records that the pair was left undiffed. Never `error`: the fix is a better reference, not a change to the code. |

### Stable references

design-parity's source handles (`Correspondence.ref`, `RefVariant.ref`, e.g.
`figma:<fileKey>/<nodeId>`) play the role compose-ai-tools' stable semantic
`ref` does ([compose-ai-tools#1784][cat-refs]): a durable identity for an element
across runs so history "drift over time" can line up the same element commit to
commit. They are **not** the same namespace (design source handle vs. compose
semantics node ref) and should not be conflated, but both are the join key a
history reader uses.

## Why this matters for hosted history (#13)

The hosted "stored baselines / drift over time" surface (#13) wants **one**
versioned history format it can ingest from both projects. With `verdict.json`
now carrying `formatVersion` + a published schema, and the crosswalk above
pinning where the finding/severity vocabularies agree, #13 can consume a
design-parity baseline and a compose-ai-tools reporting-branch entry through a
single versioned contract instead of two bespoke parsers.

[cat-epic]: https://github.com/yschimke/compose-ai-tools/issues/1866
[cat-branch]: https://github.com/yschimke/compose-ai-tools/blob/main/docs/daemon/REPORTING-BRANCH.md
[cat-schema-readme]: https://github.com/yschimke/compose-ai-tools/blob/main/schema/README.md
[cat-a11y]: https://github.com/yschimke/compose-ai-tools/blob/main/schema/a11y-atf.schema.json
[cat-refs]: https://github.com/yschimke/compose-ai-tools/issues/1784
