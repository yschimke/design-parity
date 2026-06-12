#!/usr/bin/env node
/**
 * `design-parity run` — a local parity run.
 *
 *   design-parity run --repo . --components ui/Button.kt#PrimaryButton \
 *     --candidates candidates.json --out .design-parity/out
 *
 * Reads the committed `design-map.json` + `.design-parity.json`, resolves each
 * changed component to a design reference, diffs it against the candidate
 * render, and prints the markdown report. Exits non-zero only when the parity
 * direction blocks (`design-led` + a failure).
 *
 * Candidate renders come from `--candidates <file>` (a precomputed
 * `CandidateRender[]`) so a run is reproducible offline; live `compose-preview`
 * rendering is the next increment.
 */
import { argv, cwd, env, exit, stdout } from "node:process";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import type { CandidateRender } from "@design-parity/core";
import { resolve as resolveCorrespondences } from "@design-parity/resolver";

import { resolveRunConfig } from "../config.js";
import { createAdapterRegistry } from "../registry.js";
import { orchestrate } from "../orchestrate.js";
import { renderReport } from "../report.js";

interface Args {
  repoRoot: string;
  components: string[];
  candidatesPath?: string;
  outDir?: string;
}

function parseArgs(args: string[]): Args {
  const out: Args = { repoRoot: cwd(), components: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[(i += 1)];
    switch (a) {
      case "run":
        break;
      case "--repo":
        out.repoRoot = resolvePath(next() ?? ".");
        break;
      case "--components":
        out.components.push(...(next() ?? "").split(",").filter(Boolean));
        break;
      case "--candidates":
        out.candidatesPath = next();
        break;
      case "--out":
        out.outDir = next();
        break;
      default:
        if (a && !a.startsWith("--")) out.components.push(a);
    }
  }
  return out;
}

async function loadCandidates(
  repoRoot: string,
  path: string,
): Promise<Map<string, CandidateRender>> {
  const raw = JSON.parse(
    await readFile(resolvePath(repoRoot, path), "utf8"),
  ) as CandidateRender[] | { candidates: CandidateRender[] };
  const list = Array.isArray(raw) ? raw : raw.candidates;
  return new Map(list.map((c) => [c.componentId, c]));
}

async function main(): Promise<number> {
  const args = parseArgs(argv.slice(2));
  if (args.components.length === 0) {
    stdout.write(
      "design-parity run --components <code#Member,...> [--repo .] [--candidates file.json] [--out dir]\n",
    );
    return 2;
  }

  const { designMap, direction, warnings } = await resolveRunConfig(args.repoRoot);
  const resolved = resolveCorrespondences(args.components, { designMap });

  const candidates = args.candidatesPath
    ? await loadCandidates(args.repoRoot, args.candidatesPath)
    : undefined;

  const report = await orchestrate({
    repoRoot: args.repoRoot,
    env,
    registry: createAdapterRegistry(),
    correspondences: resolved.correspondences,
    candidate: (id) => candidates?.get(id),
    direction,
    ...(args.outDir ? { outDir: args.outDir } : {}),
  });

  report.warnings.unshift(
    ...warnings,
    ...resolved.warnings,
    ...resolved.unresolved.map((u) => `unresolved (no source matched): ${u}`),
  );

  stdout.write(renderReport(report) + "\n");
  return report.blocked ? 1 : 0;
}

exit(await main());
