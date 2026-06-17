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
import { pathToFileURL } from "node:url";

import { resolve as resolveCorrespondences } from "@design-parity/resolver";
import { FigmaCanvasWriter } from "@design-parity/adapter-figma";

import { buildCandidateProvider } from "../candidate.js";
import { resolveRunConfig } from "../config.js";
import { createAdapterRegistry } from "../registry.js";
import { orchestrate } from "../orchestrate.js";
import { loadSpecTokens } from "../specTokens.js";
import { pushBack } from "../pushback.js";
import { renderReport } from "../report.js";

interface Args {
  repoRoot: string;
  components: string[];
  candidatesPath?: string;
  bundlePaths: string[];
  outDir?: string;
  pushBack: boolean;
  canvasEndpoint?: string;
  repoSlug?: string;
  branch?: string;
  sourceCommit?: string;
  bundleImage?: string;
}

export function parseArgs(args: string[]): Args {
  const out: Args = { repoRoot: cwd(), components: [], bundlePaths: [], pushBack: false };
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
      case "--push-back":
        out.pushBack = true;
        break;
      case "--canvas-endpoint":
        out.canvasEndpoint = next();
        break;
      // Landing-page link context: when the index is published to a GitHub
      // branch (where GitHub serves .html as source), passing the repo + branch
      // makes the README's report links render on click (htmlpreview), instead
      // of falling back to relative links. Consumers no longer post-process.
      case "--repo-slug":
        out.repoSlug = next();
        break;
      case "--branch":
        out.branch = next();
        break;
      case "--source-commit":
        out.sourceCommit = next();
        break;
      case "--bundle-image":
        out.bundleImage = next();
        break;
      default:
        if (a && !a.startsWith("--")) out.components.push(a);
    }
  }
  return out;
}

/** Landing-page link context from the CLI flags, or `undefined` when none set. */
export function indexOptions(args: Args): NonNullable<Parameters<typeof orchestrate>[0]["index"]> | undefined {
  const index: NonNullable<Parameters<typeof orchestrate>[0]["index"]> = {};
  if (args.repoSlug) index.repoSlug = args.repoSlug;
  if (args.branch) index.branch = args.branch;
  if (args.sourceCommit) index.sourceCommit = args.sourceCommit;
  if (args.bundleImage) index.bundleImage = args.bundleImage;
  return Object.keys(index).length > 0 ? index : undefined;
}

async function main(): Promise<number> {
  const args = parseArgs(argv.slice(2));
  if (args.components.length === 0) {
    stdout.write(
      "design-parity run --components <code#Member,...> [--repo .] " +
        "[--candidates file.json] [--candidate-bundles <png|dir,...>] [--out dir] " +
        "[--repo-slug owner/repo --branch <branch> --source-commit <sha> --bundle-image <file>] " +
        "[--push-back [--canvas-endpoint <url>]]\n",
    );
    return 2;
  }

  const { designMap, direction, cmpCapable, warnings } = await resolveRunConfig(
    args.repoRoot,
  );
  const resolved = resolveCorrespondences(args.components, { designMap });
  // Spec tokens a component declares via a committed DTCG file (design-map
  // `tokensFile`, issue #89), loaded once up front so a bad file warns (#1).
  const spec = await loadSpecTokens(designMap, args.repoRoot);

  const candidateOpts: Parameters<typeof buildCandidateProvider>[0] = {
    repoRoot: args.repoRoot,
    bundlePaths: args.bundlePaths,
  };
  if (designMap) candidateOpts.designMap = designMap;
  if (args.candidatesPath) candidateOpts.candidatesPath = args.candidatesPath;
  const { provider, warnings: candidateWarnings } =
    await buildCandidateProvider(candidateOpts);

  const index = indexOptions(args);
  const report = await orchestrate({
    repoRoot: args.repoRoot,
    env,
    registry: createAdapterRegistry(),
    correspondences: resolved.correspondences,
    candidate: provider ?? (() => undefined),
    direction,
    ...(designMap?.tokens ? { tokenAlias: designMap.tokens } : {}),
    ...(spec.byCode.size > 0 ? { referenceTokens: spec.byCode } : {}),
    ...(args.outDir ? { outDir: args.outDir } : {}),
    ...(index ? { index } : {}),
  });

  report.warnings.unshift(
    ...warnings,
    ...resolved.warnings,
    ...candidateWarnings,
    ...spec.warnings,
    ...resolved.unresolved.map((u) => `unresolved (no source matched): ${u}`),
  );

  // Promote CMP in the comment for Android-only repos (Principle 6). Read from
  // the committed config (set false by bootstrap on a non-CMP repo); advisory
  // only, so it never touches the verdict or exit code.
  if (typeof cmpCapable === "boolean") report.cmpCapable = cmpCapable;

  stdout.write(renderReport(report) + "\n");

  // Optional Code-to-Canvas push-back (#9): no-op (with a log) unless the
  // `--push-back` flag is set, the direction is `code-led`, and a figma bridge
  // endpoint is configured. A side effect only — it never affects the exit code.
  const endpoint = args.canvasEndpoint ?? env.FIGMA_CANVAS_ENDPOINT;
  await pushBack({
    report,
    enabled: args.pushBack,
    ...(endpoint ? { writer: new FigmaCanvasWriter({ endpoint }) } : {}),
    ctx: { repoRoot: args.repoRoot, env },
    log: (m) => stdout.write(m + "\n"),
  });

  // Point at the self-contained HTML comparison pages, when written (#50).
  const pages = report.results
    .map((r) => r.reportPath)
    .filter((p): p is string => p !== undefined);
  if (pages.length > 0) {
    stdout.write(
      `\nWrote ${pages.length} comparison page(s):\n` +
        pages.map((p) => `  ${p}`).join("\n") +
        "\n",
    );
  }

  return report.blocked ? 1 : 0;
}

// Run as a CLI; guarded so tests can import the arg helpers without executing.
if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  exit(await main());
}
