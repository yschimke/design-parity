# @design-parity/action

The integration layer — it wires every other package into one parity run and
renders the verdict the bot posts on a PR.

```
resolver ──(Correspondence[])──┐
                               ▼
        registry[source].resolve ──(DesignReference)──┐
                                                       ▼
   candidate render ──(CandidateRender)──►  diff + checks ──(Verdict)──┐
                                                                       ▼
            policy direction ───────────────►  ParityReport ──► markdown
```

## What's here (this increment)

- **`createAdapterRegistry()`** — the `source → ReferenceAdapter` map (figma /
  stitch / claude-design). It lives here because it's the one place that imports
  all three drivers; `core` must not depend on adapters.
- **`orchestrate()`** — per component: resolve the reference via its adapter,
  pair with the candidate render, `diff` them, aggregate. **Fail-soft**: an
  adapter/diff error is captured and surfaced, never thrown, and never escalates
  the overall status — only real verdicts do. The parity **direction** decides
  whether a failure blocks (`design-led`) or is advisory (`code-led`).
- **`resolveRunConfig()`** — loads the committed `design-map.json` and
  `.design-parity.json` (deterministic; no model, no network).
- **`renderReport()`** — the single markdown comment (with a stable marker so
  the GitHub surface can update its own comment in place).
- **`design-parity run`** CLI — a local run; candidate renders come from
  `--candidates <file>` for now (reproducible offline).

Components that consume `.design-parity/known-differences.json` declare their
exact catalog locator per visual key on the corresponding `design-map.json`
entry. The scope is intentionally component-local: `default/light` is common
across a catalog and must never select another component's acceptance.

```json
{
  "code": "ui/IconButton.kt#Tonal",
  "source": "figma",
  "ref": "figma:AbCd/1:42",
  "knownDifferences": {
    "default/light": {
      "system": "m3",
      "component": "IconButton/Tonal",
      "previewId": "iconbutton-tonal__ideal__default__light",
      "referenceId": "iconbutton-tonal-ideal-light",
      "variant": "ideal/default/light",
      "overrides": {}
    }
  }
}
```

The current reference hash is computed from the reference bytes being diffed;
it is never copied into config. CLI, PR-comment, and baseline modes all load
these scopes through `resolveRunConfig()`.

## GitHub Action

`action.yml` + `dist/cli/action.js` **auto-select a mode from the triggering
event** (mirroring the sibling `compose-ai-tools` `apply` action):

- **comment** — a `pull_request`: read the changed files, keep the
  `design-map.json` components whose file changed (a PR that touches none is
  treated as non-UI and skipped), run the pipeline, and **post/update a single
  verdict comment** (idempotent via the report marker). Exits non-zero only when
  the direction blocks (`design-led` + a failure). If the repo has **no
  committed `design-map.json`** (parity isn't set up), it posts a one-time
  notice pointing at the interactive bootstrap (`design-parity-bootstrap`, #11)
  rather than guessing the design ↔ code mapping at run time — and never blocks.
- **baseline** — a `push` to the **`development_branch`** (default `main`):
  render the **full** mapped surface, run the pipeline, and **publish the
  browsable artifacts** — a top-level `README.md` + `index.html` landing page
  (linking each component's report, with a "generated, do not edit" banner),
  each component's self-contained `report.html` triptych, a machine-readable
  `findings.json` (`compose-preview-parity-findings/v1` — what the run
  *concluded*, keyed by preview id and code handle with each finding anchored to
  the region it is about, so a preview server can draw the verdict under its own
  comparison instead of linking out to a page it cannot read), a machine-readable
  `verdict.json` (a versioned `BaselineSummary` — carries `formatVersion` +
  `$schema`, validated against
  [`schema/verdict.schema.json`](./schema/verdict.schema.json); see
  [`docs/report-format.md`](../../docs/report-format.md)), and — when the run
  exposes any design-system tokens — the aggregated table as DTCG at the stable
  `tokens/design-system.tokens.json` (linked from the index; the known location
  to point Claude Design's GitHub import at) —
  to a permanent **`artifact_branch`** (default `design-parity/<dev-branch>`).
  This gives a stable, always-current view of `main`'s parity state without
  committing generated PNGs/HTML onto `main`, and a real baseline a PR can diff
  its candidate against. Requires `contents: write`.

  **History accrues automatically.** `publishBaseline` re-parents each run's tree
  on the existing branch tip (a linear commit chain, fast-forward push — no
  force), so the artifact branch already carries one commit per run. The landing
  page links a per-screen **History** to each `report.html`'s commit log. Because
  `report.html` is deterministic, a run that doesn't change a screen touches no
  file and adds no commit noise — the history shows exactly the runs where a
  screen's code or mock actually changed.
- **skip** — nothing applies (e.g. a push to a non-dev branch).

`mode: baseline|comment|skip` overrides the selector when needed.

```yaml
# .github/workflows/design-parity.yml
on:
  pull_request:
  push:
    branches: [main]
jobs:
  parity:
    runs-on: ubuntu-latest
    permissions:
      contents: write       # baseline mode force-updates the artifact branch
      pull-requests: write  # comment mode posts the verdict comment
    steps:
      - uses: actions/checkout@v4
      # ... a prior step renders candidates -> candidates.json (or bundles) ...
      - uses: yschimke/design-parity/packages/action@main
        with:
          candidates: candidates.json        # CandidateRender[] …
          # candidate_bundles: out/previews   # … and/or compose-preview bundles
          # development_branch: main          # push here → baseline mode
          # artifact_branch: design-parity/main
```

The selector + surface logic (`selectMode`, `postReport`,
`componentsForChangedFiles`, `checkConclusion`) and the artifact builders
(`baselineSummary`, `renderBaselineIndex`) are pure and unit-tested; the git
plumbing (`publishBaseline`) takes an injectable `GitRunner` so its
orphan/re-parent/force-push sequence is unit-tested without a real remote.

## Still to come (issue #8)

- Live `compose-preview` rendering in the candidate provider (today candidates
  come from a precomputed `CandidateRender[]` / preview bundles).
- Bundle + commit `dist/` so the action is directly consumable (e.g. via `ncc`)
  and can be pinned as `yschimke/design-parity/packages/action@<tag>`.
- Comment mode diffing the PR candidate against the published baseline (the
  `verdict.json` on the artifact branch) for regression detection.

## Use

```ts
import { createAdapterRegistry, orchestrate, renderReport } from "@design-parity/action";

const report = await orchestrate({
  repoRoot,
  registry: createAdapterRegistry(),
  correspondences,            // from @design-parity/resolver
  candidate: (id) => renders.get(id),
  direction,                  // from @design-parity/policy
});
console.log(renderReport(report));
```

## Sharding

`src/shard.ts` splits one run across N jobs and puts the pieces back: a
sort-then-round-robin partition every shard derives independently
(`partitionComponents`), a `shard.json` per shard, and `verifyShardReports` +
`mergeShards` to union them into what a serial run would have produced. It is
what lets an *exhaustive* comparison fit inside a job timeout instead of being
narrowed to a hand-picked subset.

The CLIs over it are `design-parity shard` (`cli/shard-cli.ts`, read by the
render step), `design-parity run --shard i/N` (`cli/run.ts`), and
`design-parity merge` (`cli/merge.ts`). Both sides of a shard read the *same*
partition implementation — see
[`docs/PARALLEL_PARITY.md`](https://github.com/yschimke/design-parity/blob/main/docs/PARALLEL_PARITY.md)
for the invariant and the two orderings (verify-before-merge,
publish-before-verdict) that it turns on.
