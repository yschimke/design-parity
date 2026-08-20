#!/usr/bin/env node
/**
 * `design-parity publish` — put a staged artifact directory on its branch.
 *
 *   design-parity publish --dir out --branch design-parity/main \
 *     --message "design-parity artifacts for <sha>" [--allow-unchanged]
 *
 * A thin CLI over {@link publishBaseline}, which re-parents the staged tree on
 * the branch tip (orphan only when the branch does not exist yet) and retries
 * the push when a concurrent run moved it.
 *
 * This exists so the sharded workflow publishes the *same way* baseline mode
 * already does. The reusable workflow used to inline its own `git init` +
 * `push -f`, which replaced the branch with a fresh single-commit orphan on
 * every run — and the board's own README links a per-component History
 * (`commits/<branch>/<component>/report.html`), so it advertised a trend it
 * destroyed each time. One publisher, one history.
 *
 * Reads `GITHUB_TOKEN`, `GITHUB_REPOSITORY` and (optionally) `GITHUB_SERVER_URL`
 * from the environment rather than the command line, so a token never lands in
 * a workflow log or a process listing.
 */
import { argv, cwd, env, exit, stderr, stdout } from "node:process";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import { publishBaseline } from "../github/publish.js";

interface Args {
  dir?: string;
  branch?: string;
  message?: string;
  /**
   * Commit even when the staged tree matches the branch tip. Off by default:
   * an identical board is not a data point, and an empty commit per run would
   * bury the ones that mean something.
   */
  allowUnchanged: boolean;
}

export function parseArgs(args: string[]): Args {
  const out: Args = { allowUnchanged: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = (): string | undefined => args[(i += 1)];
    switch (a) {
      case "publish":
        break;
      case "--dir":
        out.dir = next();
        break;
      case "--branch":
        out.branch = next();
        break;
      case "--message":
        out.message = next();
        break;
      case "--allow-unchanged":
        out.allowUnchanged = true;
        break;
      default:
        if (a?.startsWith("--")) throw new Error(`unknown option: ${a}`);
    }
  }
  return out;
}

export async function main(rawArgs: string[] = argv.slice(2)): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(rawArgs);
  } catch (err) {
    stderr.write(`design-parity publish: ${(err as Error).message}\n`);
    return 2;
  }

  if (!args.dir || !args.branch) {
    stderr.write("design-parity publish: --dir and --branch are required\n");
    return 2;
  }

  const token = env["GITHUB_TOKEN"];
  const repo = env["GITHUB_REPOSITORY"];
  if (!token || !repo) {
    stderr.write(
      "design-parity publish: GITHUB_TOKEN and GITHUB_REPOSITORY are required\n",
    );
    return 2;
  }

  const serverUrl = env["GITHUB_SERVER_URL"];
  const result = await publishBaseline({
    sourceDir: resolvePath(cwd(), args.dir),
    branch: args.branch,
    repo,
    token,
    message: args.message ?? `design-parity artifacts${sourceSuffix()}`,
    skipIfUnchanged: !args.allowUnchanged,
    ...(serverUrl ? { serverUrl } : {}),
  });

  stdout.write(
    result.pushed
      ? `design-parity: published to ${result.branch} (${result.sha?.slice(0, 12)})\n`
      : `design-parity: board unchanged vs ${result.branch} — nothing to publish\n`,
  );
  return 0;
}

function sourceSuffix(): string {
  const sha = env["GITHUB_SHA"];
  return sha ? ` for ${sha}` : "";
}

if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  exit(await main());
}
