#!/usr/bin/env node
// `npx design-parity <subcommand> …` — the no-checkout entrypoint. A thin
// launcher that dispatches on the first arg to the matching @design-parity/action
// CLI. All the logic lives in the orchestrator package; this package exists only
// to own the `design-parity` name on the registry so `npx design-parity` works.
//   reverse → the design→code lookup;
//   shard   → print one shard's slice of the run (the render step reads this so
//             both sides of a sharded run partition identically);
//   merge   → reassemble a sharded run (`run --shard i/n`) into one artifact set;
//   cache   → would this run reproduce the published board? (skip decision);
//   import  → refresh the committed reference cache the run reads (the design
//             side moves on its own schedule, so it is imported, not re-fetched
//             on every commit);
//   publish → put a staged artifact dir on its branch, re-parented on the tip
//             (the sharded workflow's publisher; baseline mode calls the same
//             code in-process);
//   anything else → a parity run.
//
// `run` and `merge` export `main` and we invoke it explicitly: importing the
// module does NOT self-run it (their `import.meta.url === argv[1]` guard is false
// when loaded through this launcher), so calling `main()` is what actually
// executes the command and sets the exit code. `reverse` self-executes on import.
// A subcommand this launcher doesn't know used to fall through to the `else`
// and run a *parity comparison* — printing "Parity pass" and exiting 0 while
// doing nothing the caller asked for. That is the same silent-success trap the
// `run-bin` tests were written for, and version skew walks straight into it: a
// workflow pinned `@main` calling a subcommand the *published* CLI predates
// (`publish`, once) would have quietly stopped publishing behind a green step.
// Only a leading `-` means "no subcommand, flags for a parity run".
const SUBCOMMANDS = new Set(["run", "reverse", "merge", "cache", "import", "shard", "publish"]);
const subcommand = process.argv[2];
if (subcommand && !subcommand.startsWith("-") && !SUBCOMMANDS.has(subcommand)) {
  const { version } = await import("node:fs/promises")
    .then((fs) => fs.readFile(new URL("../package.json", import.meta.url), "utf8"))
    .then(JSON.parse)
    .catch(() => ({ version: "unknown" }));
  process.stderr.write(
    `design-parity: unknown subcommand '${subcommand}' (this is design-parity ${version}).\n` +
      `Known: ${[...SUBCOMMANDS].join(", ")}.\n` +
      `If a workflow expects it, the pinned design-parity is older than the workflow.\n`,
  );
  process.exit(2);
}

if (process.argv[2] === "reverse") {
  await import("@design-parity/action/reverse");
} else if (process.argv[2] === "merge") {
  const { main } = await import("@design-parity/action/merge");
  process.exit(await main());
} else if (process.argv[2] === "cache") {
  const { main } = await import("@design-parity/action/cache");
  process.exit(await main());
} else if (process.argv[2] === "import") {
  const { main } = await import("@design-parity/action/import");
  process.exit(await main());
} else if (process.argv[2] === "publish") {
  const { main } = await import("@design-parity/action/publish");
  process.exit(await main());
} else if (process.argv[2] === "shard") {
  const { main } = await import("@design-parity/action/shard");
  process.exit(await main());
} else {
  const { main } = await import("@design-parity/action/run");
  process.exit(await main());
}
