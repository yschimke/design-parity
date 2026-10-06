# Consolidating the design-artifacts code

*Plan. Phases 1–6 are done; phase 7 is optional and not started. See [Phases](#phases).*

The design-artifacts export driver turns a rendered `@Preview` module and a `catalog.spec.json`
into the `design-artifacts/<system>` delivery branch that preview.coo.ee serves and the Figma
importer reads. Its code exists in three places, and this plan makes design-parity the one
home for it.

## Where the code was

Counts are from `main` on 2026-10-05, before phase 1. Since phase 6, design-parity holds the only
copy of both the engine and the driver.

| Copy | Files | Status |
| --- | --- | --- |
| compose-ai-tools `scripts/design-artifacts/` | 1,386 | **The live copy.** `design-artifacts-reusable.yml` runs it for every catalog repository, at the commit in `.github/design-artifacts-driver-pin.txt`. |
| compose-preview-server `scripts/design-artifacts/` | 1,344, now ~1,160 | A copy that had fallen 43 files behind. yschimke/compose-preview-server#1378 cut it to what the server uses. |
| design-parity `packages/known-differences/` (was `packages/diff/src/acceptance/vendor/`) | 9 modules, their tests, the fixture generator and corpus | The known-differences engine, published as `@design-parity/known-differences` since 1.4.0. It became the one copy in phase 3. |

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

- **`@design-parity/known-differences`** holds the nine engine modules and the
  known-differences cases as its conformance suite.
  - The modules keep the form `packages/diff` vendored them in: the upstream `.mjs` source
    with a `// @ts-nocheck` line and `.js` specifiers, compiled to `.js` and `.d.ts`.
  - `packages/diff` and compose-preview-server's `serve-web` import it from npm.
  - It is the source of truth: the engine's `node --test` suites, the fixture generator and
    the corpus live beside it, and the vendoring sync, provenance test and drift workflow are
    gone.
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

1. **Trim compose-preview-server's copy.** Delete what the server does not use. Done in
   yschimke/compose-preview-server#1378.
2. **Publish `@design-parity/known-differences`.** Done in yschimke/design-parity#512, released
   in 1.4.0.
   - Move the nine modules and the cases into design-parity from the compose-ai-tools commit
     the provenance file names, after checking that those hashes still match compose-ai-tools'
     `main`.
   - Switch `packages/diff` to import the package, and release it.
   - Before the first release, claim the npm name with one manual publish and register its
     trusted publisher (AGENTS.md § Releasing). Until then the release loop skips it and
     `@design-parity/diff` cannot install.
3. **Make the package the one copy of the engine.** Done in yschimke/design-parity#514 and
   yschimke/design-parity#516, yschimke/compose-preview-server#1391 and yschimke/compose-ai-tools#5711.
   - compose-preview-server's `serve-web` imports the package and deletes its copy of the nine
     modules: yschimke/compose-preview-server#1391. It also takes over the check that its
     browser scorer's tuning matches the engine's, which used to need a cross-repository checkout.
   - compose-ai-tools' driver turned out not to import the engine at all. Its copy was the
     upstream that design-parity synced from: the modules, their `node --test` suites, the
     fixture generator, the schema and the corpus. design-parity takes all of that over and
     retires the sync, then compose-ai-tools deletes its copy.
   - Both repositories already take `@design-parity/*` updates through Renovate.
4. **Publish `@design-parity/export-driver`.** Copy `scripts/design-artifacts/` here unchanged
   as `packages/export-driver`, with a `design-artifacts <script>` command to run any script from
   the published package, and release it. compose-ai-tools keeps running its own copy during this
   phase.
   - Done in yschimke/design-parity#517. From then on the package is the driver's source: changes
     land here, and compose-ai-tools' copy was frozen until phase 6 deleted it. Until then,
     `package-scripts/check-upstream.mjs` listed how the two differed; it went with the copy.
   - Eight driver tests check the driver against compose-ai-tools itself (its workflow, Kotlin
     sources, samples and lockfile). They stay in compose-ai-tools and are left out of this
     package's run.
5. **Run the published driver from the reusable workflow.** Done in yschimke/compose-ai-tools#5713.
   - compose-ai-tools commits a lockfile, `.github/design-artifacts-driver/package-lock.json`,
     naming `@design-parity/export-driver` at an exact version with its whole dependency tree.
     Every workflow that runs the driver installs from it (`.github/scripts/install-export-driver.sh`),
     and Renovate moves it.
   - The workflow still checks compose-ai-tools out at the pinned commit for its actions and
     version catalog, and reads the lock from that checkout. So the security property the pin
     exists for still holds: the privileged job runs a reviewed tree that no caller can choose,
     and npm provenance links each driver version to the design-parity run that built it.
6. **Delete compose-ai-tools' copy.** Done in yschimke/compose-ai-tools#5714, after
   yschimke/design-parity#520 moved the tests that only it ran.
   - compose-ai-tools keeps only what it reads itself: the two schemas behind public `$schema`
     URLs, and the scope scripts its own workflow runs.
   - The browser guards against the published Remote Compose players, and the
     compose-preview-server mirrors, run in this repository's `export-driver-browser` CI job.
   - The checks that the driver agrees with compose-ai-tools' own files (its workflow, Kotlin,
     samples, fonts and lock) are compose-ai-tools' `driver-contract.test.mjs`, run against the
     installed package. It also holds the two served schemas byte-identical to the driver's, so
     a schema change is made here and reaches compose-ai-tools with its lock bump: the first one
     went through yschimke/design-parity#521, 1.5.1 and yschimke/compose-ai-tools#5716.
7. **Optionally, move the reusable workflow.** Every catalog repository calls
   `yschimke/compose-ai-tools/.github/workflows/design-artifacts-reusable.yml@main`.
   - Moving the workflow to design-parity changes every one of those `uses:` lines.
   - Do it only if keeping the workflow in compose-ai-tools turns out to cost something. Until
     then it is a small file that runs a package.

Phases 1–3 remove the engine duplication, which is the part that has already drifted (the
provenance test records two silent reverts). Phases 4–6 remove the driver duplication.

## Open questions

- **Release cadence.** Answered by phase 5. A driver fix ships with the next design-parity
  release, which release-please cuts on every merged `feat:` or `fix:`. compose-ai-tools' own
  catalogs run it once Renovate's lock bump merges there. A repository calling the reusable
  workflow waits one hop more: it runs the lock at the compose-ai-tools release the driver pin
  names, so the fix reaches it with the first compose-ai-tools release after that bump.
- **The `.rc` fixtures** belong to the Remote Compose comparison lanes. They are served by
  compose-preview-server and produced by rc-players. They may belong in rc-players rather than
  in either package here.
- **Phase 4's tests.** Measured: `export-driver-browser`, which installs Chromium and runs the
  whole driver suite including the browser lanes, takes about two minutes.
