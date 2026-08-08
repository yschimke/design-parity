#!/usr/bin/env node
/**
 * `design-parity cache` — would this run reproduce the published board?
 *
 *   design-parity cache --previous previous \
 *     --part repo=<tree-sha> --part figma=<file-version> \
 *     --part renderer=0.19.45 --part tool=0.1.41 [--force]
 *
 * Prints `key=`, `skip=`, `reason=` and, when skipping, `blocked=` — one
 * `name=value` per line, which is both readable in a log and appendable to
 * `$GITHUB_OUTPUT` verbatim.
 *
 * The caller supplies the ingredients. What identifies "the same run" is
 * environment-shaped — a git tree hash here, a pinned renderer there, the
 * runner image on top — and a CLI guessing at it would either miss one (a
 * stale skip) or hash the world (never skipping). See `../cache.ts`.
 *
 * Exit code is 0 whether or not the run can be skipped: the answer is on
 * stdout, and a non-zero code would read as "the check failed".
 */
import { argv, cwd, exit, stdout } from "node:process";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import { computeCacheKey, decideSkip } from "../cache.js";
import { readRunManifest } from "../run-manifest.js";

interface Args {
  parts: Record<string, string>;
  previousDir?: string;
  force: boolean;
}

export function parseArgs(args: string[]): Args {
  const out: Args = { parts: {}, force: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[(i += 1)];
    switch (a) {
      case "cache":
        break;
      case "--previous":
        out.previousDir = next();
        break;
      case "--force":
        out.force = true;
        break;
      case "--part": {
        const raw = next() ?? "";
        const eq = raw.indexOf("=");
        // No `=` means a name with an empty value, not a parse error: an
        // ingredient a caller could not resolve (an unset version, a missing
        // file) still has to be IN the key, or its absence is invisible and two
        // materially different runs hash the same.
        if (eq < 0) out.parts[raw] = "";
        else out.parts[raw.slice(0, eq)] = raw.slice(eq + 1);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export async function main(rawArgs: string[] = argv.slice(2)): Promise<number> {
  const args = parseArgs(rawArgs);
  if (Object.keys(args.parts).length === 0) {
    stdout.write(
      "design-parity cache --part <name>=<value>... [--previous <dir>] [--force]\n",
    );
    return 2;
  }

  const key = computeCacheKey(args.parts);
  const previous = args.previousDir
    ? await readRunManifest(resolvePath(cwd(), args.previousDir))
    : undefined;
  const decision = decideSkip({ previous, key, force: args.force });

  stdout.write(`key=${key}\n`);
  stdout.write(`skip=${decision.skip}\n`);
  stdout.write(`reason=${decision.reason}\n`);
  if (decision.skip) stdout.write(`blocked=${decision.blocked === true}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  exit(await main());
}
