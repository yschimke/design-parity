#!/usr/bin/env node
/**
 * CLI: detect maturity and bootstrap a committed baseline — interactively.
 *
 *   design-parity-bootstrap [--dir <path>] [--yes] [--force]
 *                           [--direction design-led|code-led]
 *
 * This is the interactive setup step (Principle 4). It refuses to run on the
 * unattended Action path: the Action enforces committed artifacts, it never
 * generates them (Principle 1) — it points the user here instead.
 */
import { argv, env, exit, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import type { ResolvedDirection } from "@design-parity/core";

import {
  applyBootstrap,
  planBootstrap,
  type BootstrapPlan,
} from "../bootstrap.js";

interface Args {
  dir: string;
  yes: boolean;
  force: boolean;
  direction?: ResolvedDirection;
  help: boolean;
}

function parseArgs(args: string[]): Args {
  const out: Args = { dir: ".", yes: false, force: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--yes":
      case "-y":
        out.yes = true;
        break;
      case "--force":
        out.force = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--dir":
        out.dir = args[++i] ?? ".";
        break;
      case "--direction": {
        const v = args[++i];
        if (v !== "design-led" && v !== "code-led") {
          throw new Error(`--direction must be design-led or code-led, got '${v}'`);
        }
        out.direction = v;
        break;
      }
      default:
        throw new Error(`unknown argument '${a}'`);
    }
  }
  return out;
}

const HELP = `design-parity-bootstrap — detect maturity and bootstrap a committed baseline

Usage:
  design-parity-bootstrap [options]

Options:
  --dir <path>        Repo root to bootstrap (default: current directory)
  --direction <d>     Force parity direction: design-led | code-led
  --yes, -y           Don't prompt; write the plan as-is
  --force             Overwrite artifacts that already exist
  --help, -h          Show this help

Interactive setup only. Run this once, locally; commit the artifacts it writes.
The GitHub Action runs those committed artifacts and never bootstraps.`;

function printPlan(plan: BootstrapPlan): void {
  const { maturity } = plan;
  console.log(`Detected maturity: ${maturity.rung} — ${maturity.label}`);
  if (maturity.signals.length > 0) {
    console.log("Evidence:");
    for (const s of maturity.signals) console.log(`  • ${s.kind}: ${s.path}`);
  }
  console.log(`\nParity direction: ${plan.direction}`);

  console.log("\nArtifacts:");
  for (const a of plan.artifacts) {
    const tag = a.exists ? " (exists — will skip unless --force)" : "";
    console.log(`  • ${a.path} — ${a.description}${tag}`);
  }

  if (plan.review.length > 0) {
    console.log(
      `\n${plan.review.length} UI component(s) discovered by convention (low confidence).`,
    );
    console.log("Wire each to a design reference in design-map.json when you adopt a design tool:");
    for (const c of plan.review) console.log(`  • ${c.code}`);
  }
}

async function confirm(question: string): Promise<boolean> {
  if (!stdin.isTTY) return false;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    console.error("\n" + HELP);
    return 2;
  }

  if (args.help) {
    console.log(HELP);
    return 0;
  }

  // Principle 1 & 4: never bootstrap on the unattended Action path.
  if (env.GITHUB_ACTIONS === "true" || env.CI === "true") {
    console.error(
      "design-parity-bootstrap is interactive setup and won't run in CI.\n" +
        "Run it locally, review the generated artifacts, and commit them. The\n" +
        "GitHub Action enforces those committed artifacts — it never bootstraps.",
    );
    return 1;
  }

  const plan = await planBootstrap(args.dir, { direction: args.direction });
  printPlan(plan);

  const toWrite = plan.artifacts.filter((a) => args.force || !a.exists);
  if (toWrite.length === 0) {
    console.log("\nNothing to write (all artifacts exist; pass --force to overwrite).");
    return 0;
  }

  if (!args.yes) {
    const ok = await confirm(`\nWrite ${toWrite.length} file(s) to ${args.dir}?`);
    if (!ok) {
      console.log("Aborted; nothing written.");
      return 0;
    }
  }

  const result = await applyBootstrap(plan, { force: args.force });
  for (const p of result.written) console.log(`wrote   ${p}`);
  for (const p of result.skipped) console.log(`skipped ${p} (exists)`);
  console.log("\nReview the artifacts and commit them.");
  return 0;
}

exit(await main());
