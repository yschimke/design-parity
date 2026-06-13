#!/usr/bin/env node
// `npx design-parity run …` — the no-checkout entrypoint. A thin launcher: it
// loads @design-parity/action's run CLI, which reads process.argv itself and
// sets the exit code. All the logic lives in the orchestrator package; this
// package exists only to own the `design-parity` name on the registry so the
// bare `npx design-parity` invocation works.
import "@design-parity/action/run";
