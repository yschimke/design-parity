# UID reference parity in CI

`uid-parity-reusable.yml` runs the deterministic desktop UID pilot lane:
app interactions and captures, independent native UID reference rendering, then
bounded image comparison and a validated preview-server bundle. It owns the
runner setup, renderer/publisher pins, dependency setup and artifact handoff.
It does not replace the full semantic/a11y parity engine: this lane compares
pixels, and a match does not establish usability or accessibility.

The app keeps its trigger/path filters, concurrency policy, build command,
committed `.uid` documents, capture plan, guidelines and app-specific validation.
For example:

```yaml
name: Adaptive UID pilot
on:
  pull_request:
    paths: ['adaptive-uid-pilot/**', 'gradle/**', 'build-logic/**', '*.gradle.kts', '.github/workflows/adaptive-uid-*.yml']
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  parity:
    uses: yschimke/design-parity/.github/workflows/uid-parity-reusable.yml@<reviewed-commit-sha>
    with:
      pilot-directory: adaptive-uid-pilot
      bundle-name: screens
      build-command: >-
        ./gradlew -PadaptiveUidPilot=true
        :adaptive-uid-pilot:ktfmtCheck
        :adaptive-uid-pilot:test
        :adaptive-uid-pilot:renderPilot
```

Pin the reusable workflow to an immutable commit. It needs no secrets and never
publishes a branch, posts a comment, or deploys a preview. All jobs have read-only
repository permissions and disable persisted checkout credentials. Application
code and UID compilation run only in those unprivileged jobs.

## Caller contract

Relative to `pilot-directory`:

- `build/pilot/previews/*.png`: written by `build-command`.
- `build/reports/tests/`: optional test-report artifact.
- `references.json`: committed capture plan.
- UID documents referenced by the plan.

The workflow pins the shared tools in [`scripts/uid`](../scripts/uid/README.md)
and the server's `scripts/ui-builder/render-ci-references.sh`. Consumers do not
copy either implementation or the renderer dependency pins. `bundle-name`
(default `screens`) chooses the zip basename under `build/`.

The plan is authoritative for capture count, dimensions, theme and state.
`distinctCaptures` lists pairs of preview IDs that must produce different images
in both the app and UID lanes. For example:

```json
"distinctCaptures": [["tablet-list-light", "tablet-detail-light"]]
```

This preserves each pilot's selection coverage without hard-coding eight captures
or an 840dp breakpoint in shared validation. The 1800px image cap remains.
Pixel changes are advisory; missing/invalid captures, declared duplicate states
and invalid packages fail the job. Shared tool tests run in this repository's UID
workflow tests, rather than being copied into each app.

Artifacts keep their existing names: `adaptive-uid-candidates`,
`adaptive-uid-tests`, `adaptive-uid-references`, `adaptive-uid-evidence`, and
`adaptive-uid-bundle` by default. For multiple calls or a matrix, set a distinct
`artifact-prefix` per pilot (for example `phone-uid` and `wear-uid`). Every upload
and download uses that prefix, and the matching audit must set
`evidence-artifact: <prefix>-evidence` and a distinct `audit-artifact`.
Uploads replace an existing artifact of the same name on retries. Different
pilots must still use different prefixes; overwriting is not isolation.
Download `<prefix>-evidence`
and open `index.html` to inspect reference / exact pixel diff / actual.

## Optional model audit

The existing opt-in model critique is separate from this deterministic workflow.
Its shared setup is in compose-ai-tools' `uid-design-audit-reusable.yml`, alongside
the guidelines engine. It consumes image evidence through a default-branch
`workflow_run` caller and the existing `OPENROUTER_API_KEY` secret. It never
changes the deterministic parity verdict. See that repository's
`docs/UID_DESIGN_AUDIT_CI.md` for the trust boundary and caller example.

The audit caller must be merged to the app's default branch before GitHub starts
it. On first adoption, merge the shared workflows before the app callers and pin
those callers to commits that remain available. A provider branch SHA can be used
to exercise a consumer PR before merging; update it to the landed revision when
adopting the shared workflow.

`build-command` is trusted shell code supplied by the caller, executed with Bash
and `-e -o pipefail`. Passing it via an environment variable preserves the text;
it is not input sanitization. Do not interpolate PR titles, bodies, branch names
or other untrusted metadata into this command. Use separately quoted data inputs
inside a committed build script when those values are needed.

## Add UID references to an existing app catalog

Set `export-catalog: true` to export `<artifact-prefix>-catalog`: a prepared section
containing the candidate PNGs, captured UID documents, and native reference PNGs.
This read-only workflow never writes a delivery branch or registers another catalog.
The app's existing design-artifacts workflow consumes the artifact through
`catalog-section-artifact` and folds it into `catalog-section: Screens` before its
normal publisher runs. The primary catalog retains its identity, themes, live
bundles, existing screens and references.

Add publication metadata to the committed `references.json` plan. Use the app's
existing catalog system ID:

```json
{
  "repository": "my-org/my-app",
  "publication": {
    "system": "my-app",
    "title": "My app",
    "sourceModule": ":adaptive-uid-pilot",
    "sourceDirectory": "adaptive-uid-pilot",
    "components": [{
      "designId": "browser",
      "componentId": "Browser",
      "defaultState": "list",
      "sourceFile": "src/main/kotlin/example/Browser.kt"
    }]
  }
}
```

`sourceModule` is the logical Gradle project path; `sourceDirectory` is its
repository-relative directory (an empty string for the root project). Components
and capture axes must have distinct identities. The canonical catalog writer
supplies sticker IDs and the existing section merger preserves reference bindings
while combining reference manifests. Duplicate reference IDs with different data
fail publication instead of silently replacing another screen's reference.

Have the existing design-artifacts caller invoke the app's pilot workflow with
`workflow_call`, then pass its artifact to the shared catalog publisher. Both jobs
render the same source commit. Include the pilot's files in that caller's push
paths so UID edits republish the existing catalog. PR runs keep their downloadable
evidence and prepared section; main publishes through the existing delivery branch.
Hosting remains optional: all CI artifacts work without a preview server.

`defaultState` names the captured initial state (for example `list`). The exporter maps it to the canonical catalog `default` state so the screen appears in the catalog listing; other states remain selectable variants. Omitting it requires a capture already named `default`.
