# @design-parity/export-driver

The design-artifacts export driver. It turns a rendered `@Preview` module and a `catalog.spec.json`
into the importable `design-artifacts/<system>` delivery branch that preview.coo.ee serves and the
Figma importer reads: the catalog, design pages, design references, parity findings and issues, and
the Remote Compose comparison lanes.

Rendering itself is the `compose-preview` CLI's job; the driver reads its output.

## Running a script

Every script is one file in this package. Run any of them through the `design-artifacts` command,
with the script's name and its own arguments:

```sh
npx -p @design-parity/export-driver@<version> design-artifacts validate-catalog-spec --spec catalog.spec.json
npx -p @design-parity/export-driver@<version> design-artifacts generate-design-catalog --help
```

The name may carry its `.mjs` or `.sh` extension or not. Pin an exact version: the reusable
workflow that runs this driver treats the version as the code it executes.

Two inputs default to paths inside a compose-ai-tools checkout. Pass them explicitly when running
from the package:

- `rc-compare --fonts <dir>`: the typeface directory the Remote Compose lanes render with.
- `RC_PLAYER_JS_BUNDLE=<bundle.js>`: the Remote Compose player bundle the browser lanes and tests
  load.

## Where the source is

The driver was written in compose-ai-tools' `scripts/design-artifacts/`, and its workflow still runs
that copy. Until it runs this package instead (phase 5 of
[`docs/design-artifacts/CONSOLIDATION.md`](../../docs/design-artifacts/CONSOLIDATION.md)), the two
must hold the same bytes:

```sh
node packages/export-driver/package-scripts/check-upstream.mjs <compose-ai-tools-checkout> [ref]
```

It compares every file except `package.json` and `package-lock.json`, and fails on any difference.
Land a change in compose-ai-tools first, then copy it here. `bin/`, `package-scripts/` and this
README are this package's own.

## Tests

`npm test` runs the driver's `node --test` suites through `package-scripts/run-tests.mjs`. That
leaves out eight checks that assert the driver agrees with compose-ai-tools itself (its workflow
file, Kotlin sources, sample specs, fonts and lockfile), which compose-ai-tools keeps running; the
runner lists each with its reason. Browser lanes skip without Playwright's Chromium and the player
bundle, and the cross-repository mirrors skip without a compose-preview-server checkout
(`COMPOSE_PREVIEW_SERVER_ROOT`), as they do in compose-ai-tools.
