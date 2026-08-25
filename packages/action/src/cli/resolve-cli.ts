#!/usr/bin/env node
import { argv, cwd, exit, stderr, stdout } from "node:process";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveKnownDifferences } from "../resolution.js";

interface Args {
  repoRoot: string;
  evidencePath: string;
  ownedIssues: string[];
  bodyPath?: string;
}

export function parseArgs(args: string[]): Args {
  let repoRoot = cwd();
  let evidencePath = "";
  const ownedIssues: string[] = [];
  let bodyPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = (): string => {
      const value = args[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case "resolve": break;
      case "--repo": repoRoot = resolvePath(next()); break;
      case "--evidence": evidencePath = resolvePath(next()); break;
      case "--owned-issue": ownedIssues.push(next()); break;
      case "--body-out": bodyPath = resolvePath(next()); break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }
  if (!evidencePath) throw new Error("--evidence is required");
  return { repoRoot, evidencePath, ownedIssues, ...(bodyPath ? { bodyPath } : {}) };
}

export async function main(): Promise<number> {
  try {
    const args = parseArgs(argv.slice(2));
    const result = await resolveKnownDifferences(args);
    if (result.removed.length === 0) {
      stdout.write("design-parity: no unambiguous resolved acceptances; nothing changed\n");
      return 0;
    }
    stdout.write(
      `design-parity: removed ${result.removed.length} resolved acceptance(s): ${result.removed.join(", ")}\n`,
    );
    if (args.bodyPath) stdout.write(`design-parity: wrote PR body to ${args.bodyPath}\n`);
    else stdout.write("\n" + result.body);
    return 0;
  } catch (error) {
    stderr.write(`design-parity resolve: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(argv[1] ?? "").href) exit(await main());
