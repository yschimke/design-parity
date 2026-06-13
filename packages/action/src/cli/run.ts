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
 * Candidate renders come from committed, offline inputs (reproducible — no live
 * render at run time): `--candidates <file>` (a precomputed `CandidateRender[]`)
 * and/or `--candidate-bundles <png|dir,...>` (compose-ai-tools preview-bundle
 * polyglots, read statically by `@design-parity/candidate`; issue #38 Phase 1).
 * When both are given, bundles win and the JSON is the fallback.
 */
import { argv, cwd, env, exit, stdout } from "node:process";
import { resolve as resolvePath } from "node:path";

import { resolve as resolveCorrespondences } from "@design-parity/resolver";

import { buildCandidateProvider } from "../candidate.js";
import { resolveRunConfig } from "../config.js";
import { createAdapterRegistry } from "../registry.js";
import { orchestrate } from "../orchestrate.js";
import { renderReport } from "../report.js";

interface Args {
  repoRoot: string;
  components: string[];
  candidatesPath?: string;
  bundlePaths: string[];
  outDir?: string;
}

function parseArgs(args: string[]): Args {
  const out: Args = { repoRoot: cwd(), components: [], bundlePaths: [] };
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
      case "--candidate-bundles":
        out.bundlePaths.push(...(next() ?? "").split(",").filter(Boolean));
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

async function main(): Promise<number> {
  const args = parseArgs(argv.slice(2));
  if (args.components.length === 0) {
    stdout.write(
      "design-parity run --components <code#Member,...> [--repo .] " +
        "[--candidates file.json] [--candidate-bundles <png|dir,...>] [--out dir]\n",
    );
    return 2;
  }

  const { designMap, direction, warnings } = await resolveRunConfig(args.repoRoot);
  const resolved = resolveCorrespondences(args.components, { designMap });

  const candidateOpts: Parameters<typeof buildCandidateProvider>[0] = {
    repoRoot: args.repoRoot,
    bundlePaths: args.bundlePaths,
  };
  if (designMap) candidateOpts.designMap = designMap;
  if (args.candidatesPath) candidateOpts.candidatesPath = args.candidatesPath;
  const { provider, warnings: candidateWarnings } =
    await buildCandidateProvider(candidateOpts);

  const report = await orchestrate({
    repoRoot: args.repoRoot,
    env,
    registry: createAdapterRegistry(),
    correspondences: resolved.correspondences,
    candidate: provider ?? (() => undefined),
    direction,
    ...(args.outDir ? { outDir: args.outDir } : {}),
  });

  report.warnings.unshift(
    ...warnings,
    ...resolved.warnings,
    ...candidateWarnings,
    ...resolved.unresolved.map((u) => `unresolved (no source matched): ${u}`),
  );

  stdout.write(renderReport(report) + "\n");
  return report.blocked ? 1 : 0;
}

exit(await main());
