# @design-parity/known-differences

The `compose-preview-known-differences/v1` acceptance engine: the document ladder, the gates, the
separated-plane scorer, and a dependency-free PNG reader and writer. It is the code that decides
whether a candidate render's difference from its reference is an accepted, known difference.

One module per entry point, and no dependencies:

```js
import { evaluateKnownDifferences } from "@design-parity/known-differences/known-differences";
import { scoreComparison } from "@design-parity/known-differences/known-difference-score";
import { decodePng } from "@design-parity/known-differences/png-lite";
```

| Entry point | What it is |
| --- | --- |
| `known-differences` | The document ladder, the gates and the acceptance result. |
| `known-difference-plane` | Plane resolution and tag-index projection. |
| `known-difference-resample` | Cropping and resampling to a common frame. |
| `known-difference-score` | The separated-plane scorer. |
| `known-difference-tuning` | The scorer's constants, including `SCORE_VERSION`. |
| `png-lite`, `png-write`, `inflate-lite`, `sha256-lite` | Dependency-free PNG decode and encode, inflate, and SHA-256. |
| `PROVENANCE.json` | The compose-ai-tools commit these modules match, with digests. |

## Where the source of truth is

For now, compose-ai-tools' `scripts/design-artifacts/*.mjs` is still the source of truth, and the
modules here are generated from it. Don't edit `src/` by hand: land the change in compose-ai-tools
first, then re-sync.

```sh
node packages/known-differences/test/sync-known-differences-vendor.mjs <compose-ai-tools-checkout>
node packages/known-differences/test/sync-known-differences-fixtures.mjs <compose-ai-tools-checkout>
```

`test/vendor-provenance.test.ts` checks every module against the commit in `src/PROVENANCE.json`
offline, and the weekly `vendor-drift.yml` workflow reports when that commit falls behind
compose-ai-tools' `main`. Once compose-ai-tools and compose-preview-server import this package
instead of keeping their own copies, this package becomes the source of truth and the sync goes
away. The steps are in
[`docs/design-artifacts/CONSOLIDATION.md`](../../docs/design-artifacts/CONSOLIDATION.md).

The 1,141-case conformance corpus is in `test/fixtures/known-differences.zip`.
`packages/diff/test/known-differences-conformance.test.ts` runs it through `@design-parity/diff`'s
adapter.
