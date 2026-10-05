# Consolidating the design-artifacts code

*Plan. Nothing here has moved yet.*

The design-artifacts export driver turns a rendered `@Preview` module and a `catalog.spec.json`
into the `design-artifacts/<system>` delivery branch that preview.coo.ee serves and the Figma
importer reads. Its code exists in three places, and this plan makes design-parity the one
home for it.

## Where the code is today

Counts are from `main` on 2026-10-05.

| Copy | Files | Status |
| --- | --- | --- |
| compose-ai-tools `scripts/design-artifacts/` | 1,386 | **The live copy.** `design-artifacts-reusable.yml` runs it for every catalog repository, at the commit in `.github/design-artifacts-driver-pin.txt`. |
| compose-preview-server `scripts/design-artifacts/` | 1,344, falling to ~1,160 | A copy that had fallen 43 files behind. yschimke/compose-preview-server#1378 cuts it to what the server uses. |
| design-parity `packages/diff/src/acceptance/vendor/` | 8 modules plus a fixture archive | The known-differences engine, translated to TypeScript, with a provenance test that hashes it against a pinned compose-ai-tools commit. |

### What each repository actually uses

- **compose-ai-tools** runs the whole driver: 117 scripts and 103 `node --test` files.
  Twelve of the scripts import npm packages (`playwright`, `pngjs`, `pixelmatch`, `fflate` and
  `@design-parity/{candidate,catalog-export,adapter-figma}`). The rest use only Node built-ins,
  which is why the workflow's partition and spec steps run without `npm ci`.
- **compose-preview-server** uses two things.
  - **The known-differences engine**, nine dependency-free modules: `known-differences.mjs`,
    `known-difference-{plane,resample,score,tuning}.mjs`, `png-lite.mjs`, `png-write.mjs`,
    `inflate-lite.mjs` and `sha256-lite.mjs`. `serve-web` bundles it so the viewer and the
    driver agree on what an acceptance means.
  - **`fixtures/`**:
    - 1,141 known-differences cases;
    - three wire fixtures (`parity-issues.json`, `parity-locators.json`,
      `parity-activity.json`), which pin a format the driver writes and the server reads;
    - a few `.rc` documents.
- **design-parity** uses the same engine and the same 1,141 cases, through the vendored
  TypeScript copy.

So there are two distinct things to consolidate: a **library** (the engine, needed by all three)
and an **application** (the driver, run only by compose-ai-tools' workflow).

## Target

```text
design-parity/packages/
  known-differences/   @design-parity/known-differences  (library, dependency-free ESM)
  export-driver/       @design-parity/export-driver      (application, bin: design-artifacts)
```

- **`@design-parity/known-differences`** holds the nine engine modules exactly as they are
  (plain `.mjs`, with `.d.ts` beside them for TypeScript callers) and the known-differences
  cases as its conformance suite.
  - `packages/diff` imports it in place of `src/acceptance/vendor/`.
  - `serve-web` and the driver import it from npm.
  - The vendoring script and provenance test go away: there is nothing left to drift.
- **`@design-parity/export-driver`** holds the rest of `scripts/design-artifacts/`, with its
  `node --test` suites. It stays JavaScript: rewriting 117 tested scripts in TypeScript is
  risk with no payoff. It runs its own tests (`node --test`), next to the repository's
  `vitest` run. It keeps shelling out to the `compose-preview` CLI for rendering, as
  AGENTS.md requires.
- **The wire fixtures** move with the driver, because the driver is their producer.
  compose-preview-server keeps a copy for its Kotlin tests, which read them from disk. A test
  there compares that copy with the published package's, so drift fails a build instead of
  going unnoticed.

## Phases

Each phase is one PR per repository and leaves every caller working.

1. **Trim compose-preview-server's copy.** Delete what the server does not use. This is
   yschimke/compose-preview-server#1378, open.
2. **Publish `@design-parity/known-differences`.**
   - Move the nine modules and the cases into design-parity from the compose-ai-tools commit
     the provenance file names, after checking that those hashes still match compose-ai-tools'
     `main`.
   - Switch `packages/diff` to import the package, and release it.
3. **Point the engine's consumers at the package.**
   - compose-ai-tools' driver and compose-preview-server's `serve-web` import
     `@design-parity/known-differences` and delete their copies of the nine modules.
   - Both repositories already take `@design-parity/*` updates through Renovate.
4. **Publish `@design-parity/export-driver`.** Move the remaining scripts and their tests, and
   release it. compose-ai-tools keeps running its own copy during this phase. A CI job in
   compose-ai-tools runs both against the same fixtures and fails if they disagree.
5. **Run the published driver from the reusable workflow.**
   - `design-artifacts-reusable.yml` runs `npx @design-parity/export-driver@<version>` instead
     of checking out compose-ai-tools at the pinned commit.
   - `design-artifacts-driver-pin.txt` then holds a package version instead of a commit, and
     `refresh-driver-pin.yml` bumps it on each release.
   - The security property the pin exists for still holds: the privileged job runs a published,
     immutable artifact that no caller can choose. npm provenance attestation links each version
     to the design-parity workflow run that built it.
6. **Delete compose-ai-tools' copy.** It now holds only what its own Gradle and Kotlin tests
   read, as compose-preview-server's does after phase 1.
7. **Optionally, move the reusable workflow.** Every catalog repository calls
   `yschimke/compose-ai-tools/.github/workflows/design-artifacts-reusable.yml@main`.
   - Moving the workflow to design-parity changes every one of those `uses:` lines.
   - Do it only if keeping the workflow in compose-ai-tools turns out to cost something. Until
     then it is a small file that runs a package.

Phases 1–3 remove the engine duplication, which is the part that has already drifted (the
provenance test records two silent reverts). Phases 4–6 remove the driver duplication.

## Open questions

- **Release cadence.** compose-ai-tools releases often, and a driver fix currently reaches
  callers with the next pin bump. After phase 5 it ships with the next design-parity release
  instead. design-parity's release-please already releases on every merged `feat:` or `fix:`,
  so this should be no slower. It is worth confirming before phase 5.
- **The `.rc` fixtures** belong to the Remote Compose comparison lanes. They are served by
  compose-preview-server and produced by rc-players. They may belong in rc-players rather than
  in either package here.
- **Phase 4's tests.** The driver has 103 test files. Running them in design-parity's
  CI adds a few minutes, which seems fine but should be measured.
