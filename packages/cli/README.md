# design-parity

The top-level CLI for [design-parity](https://github.com/yschimke/design-parity)
— prove a UI pull request is at parity with its intended design. Run it with no
checkout:

```sh
npx design-parity run \
  --components "ui/Home.kt#HomeScreen" \
  --candidate-bundles build/compose-previews/ \
  --out .design-parity/out
```

This package is a thin launcher over
[`@design-parity/action`](https://www.npmjs.com/package/@design-parity/action):
it owns the `design-parity` bin so the bare `npx design-parity` invocation
works, and it re-exports the orchestrator's programmatic API
(`import { orchestrate } from "design-parity"`). The candidate side is rendered
by the upstream [`compose-preview`](https://github.com/yschimke/compose-ai-tools)
CLI — design-parity owns the reference side and the diff.

See the [repo README](https://github.com/yschimke/design-parity#readme) and the
[CMP adoption guide](https://github.com/yschimke/design-parity/blob/main/docs/adopting-cmp.md)
for the full pipeline.
