#!/usr/bin/env node
// `npx design-parity <subcommand> …` — the no-checkout entrypoint. A thin
// launcher: it dispatches on the first arg to the matching @design-parity/action
// CLI, which reads process.argv itself and sets the exit code. All the logic
// lives in the orchestrator package; this package exists only to own the
// `design-parity` name on the registry so `npx design-parity` works.
//   reverse → the design→code lookup; anything else → a parity run.
if (process.argv[2] === "reverse") {
  await import("@design-parity/action/reverse");
} else {
  await import("@design-parity/action/run");
}
