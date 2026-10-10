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
- `ci/native-references.sh`: invoked with the pilot directory as its first
  argument from the repository root, inside the pinned native renderer image.
  `_preview_server` contains the matching pinned reference publisher. The script
  writes `build/pilot/references/` including its index and UID documents.
- `ci/test_*.py`: validation tests, run before comparison/packaging.
- `ci/evidence.py --plan PATH --root PATH`: validates the expected captures and
  writes `index.html`, `evidence.json` and diff PNGs below `build/pilot/`.
- `package.py`: validates and writes the preview-server zip below `build/`.

The current Home Assistant and MeshCore helpers intentionally enforce their
specific eight-capture matrix, 840dp distinct tablet selections, and 1800px cap.
They remain app-owned; this extraction does not turn those pilot assertions into
universal parity policy. Pixel changes remain advisory; missing or invalid
captures, duplicate tablet states and invalid packages fail the job.

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
