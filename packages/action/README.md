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

## Next increments (issue #8)

- Live `compose-preview` rendering in the CLI candidate provider.
- The GitHub Action surface: read the PR's changed components, post/update the
  single comment, upload triptychs, skip non-UI PRs, set the check status from
  `blocked`.
- Consume the canonical `size` contract (#24) and the committed checks config
  loader (#25) once they land.

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
