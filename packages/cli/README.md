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

## `reverse` — design → code

Ask the committed `design-map.json` which code implements a design node — the
direction a source without Code Connect (Stitch, Claude Design, bundle) otherwise
can't answer. Every node of a multi-node binding points back at its code handle.

```sh
npx design-parity reverse figma:AbCdEf/1:42   # → ui/Home.kt#HomeScreen
npx design-parity reverse --repo .            # dump the whole ref → code map
```

Exit codes: `0` found (or full dump), `1` the ref maps to nothing, `2` no
readable `design-map.json`.

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
