#!/usr/bin/env node
// `npx design-parity <subcommand> …` — the no-checkout entrypoint. A thin
// launcher that dispatches on the first arg to the matching @design-parity/action
// CLI. All the logic lives in the orchestrator package; this package exists only
// to own the `design-parity` name on the registry so `npx design-parity` works.
//   reverse → the design→code lookup;
//   shard   → print one shard's slice of the run (the render step reads this so
//             both sides of a sharded run partition identically);
//   merge   → reassemble a sharded run (`run --shard i/n`) into one artifact set;
//   anything else → a parity run.
//
// `run` and `merge` export `main` and we invoke it explicitly: importing the
// module does NOT self-run it (their `import.meta.url === argv[1]` guard is false
// when loaded through this launcher), so calling `main()` is what actually
// executes the command and sets the exit code. `reverse` self-executes on import.
if (process.argv[2] === "reverse") {
  await import("@design-parity/action/reverse");
} else if (process.argv[2] === "merge") {
  const { main } = await import("@design-parity/action/merge");
  process.exit(await main());
} else if (process.argv[2] === "shard") {
  const { main } = await import("@design-parity/action/shard");
  process.exit(await main());
} else {
  const { main } = await import("@design-parity/action/run");
  process.exit(await main());
}
