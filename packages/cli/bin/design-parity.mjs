#!/usr/bin/env node
// `npx design-parity <subcommand> …` — the no-checkout entrypoint. A thin
// launcher that dispatches on the first arg to the matching @design-parity/action
// CLI. All the logic lives in the orchestrator package; this package exists only
// to own the `design-parity` name on the registry so `npx design-parity` works.
//   reverse → the design→code lookup; anything else → a parity run.
//
// `run` exports `main` and we invoke it explicitly: importing the module does
// NOT self-run it (its `import.meta.url === argv[1]` guard is false when loaded
// through this launcher), so calling `main()` is what actually executes the
// parity run and sets the exit code. `reverse` self-executes on import.
if (process.argv[2] === "reverse") {
  await import("@design-parity/action/reverse");
} else {
  const { main } = await import("@design-parity/action/run");
  process.exit(await main());
}
