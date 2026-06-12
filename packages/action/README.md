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

## GitHub Action

`action.yml` + `dist/cli/action.js` run a parity check on a PR: read the
changed files, keep the `design-map.json` components whose file changed (a PR
that touches none is treated as non-UI and skipped), run the pipeline, and
**post/update a single verdict comment** (idempotent via the report marker). It
exits non-zero only when the direction blocks (`design-led` + a failure).

```yaml
# .github/workflows/design-parity.yml
on: pull_request
jobs:
  parity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # ... a prior step renders candidates -> candidates.json ...
      - uses: yschimke/design-parity/packages/action@main
        with:
          candidates: candidates.json   # CandidateRender[] for the changed components
```

The surface logic (`postReport`, `componentsForChangedFiles`, `checkConclusion`)
is pure and unit-tested with a fake client; the entrypoint adds a dependency-free
`fetch` GitHub client.

## Still to come (issue #8)

- Live `compose-preview` rendering in the candidate provider (today candidates
  come from a precomputed `CandidateRender[]`).
- Bundle + commit `dist/` so the action is directly consumable (e.g. via `ncc`).
- Upload triptychs as artifacts; consume the checks-config loader (#25).

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
