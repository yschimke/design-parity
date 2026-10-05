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
| `schema/known-differences.schema.json` | The JSON Schema of the committed known-difference document. |

## Changing the engine

This package is the one copy of the engine; compose-ai-tools and compose-preview-server depend on
it rather than keeping their own. The tests and the conformance cases live beside it:

- `test/conformance/*.test.mjs` are the engine's own `node --test` suites, run against the built
  `dist/` by `npm run test:conformance` (and by the root `npm test`).
- `test/conformance/fixtures/known-differences/` is the 1,141-file conformance corpus, generated
  by `test/conformance/build-known-difference-fixtures.mjs`. Edit the generator, regenerate, and
  commit both: `known-differences.test.mjs` fails if the committed tree differs from what the
  generator writes.
- `packages/diff/test/known-differences-conformance.test.ts` runs the same corpus through
  `@design-parity/diff`'s adapter.

```sh
npm run build --workspace @design-parity/known-differences
node packages/known-differences/test/conformance/build-known-difference-fixtures.mjs
npm run test:conformance --workspace @design-parity/known-differences
```

The modules came from compose-ai-tools' `scripts/design-artifacts/` and keep the form they were
vendored in: a `// @ts-nocheck` line and `.js` specifiers. They are untyped JavaScript, so
`scripts/widen-declarations.mjs` corrects the declarations TypeScript emits for them, and
`test/declarations.test.ts` checks the result.
