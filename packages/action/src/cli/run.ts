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
 *
 * `--shard <i>/<n>` runs one slice of the component list in this job and writes
 * a `shard.json` next to the reports; `design-parity merge` unions the slices
 * back into the artifact set a serial run would have produced. That is how an
 * *exhaustive* comparison (every component, not just the ones a hand-tuned
 * workflow could afford) fits inside a job timeout — see `../shard.ts` and
 * `docs/PARALLEL_PARITY.md`.
 */
import { argv, cwd, env, exit, stdout } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import { resolve as resolveCorrespondences } from "@design-parity/resolver";
import { FigmaCanvasWriter } from "@design-parity/adapter-figma";

import { buildCandidateProvider } from "../candidate.js";
import { resolveRunConfig } from "../config.js";
import { createAdapterRegistry } from "../registry.js";
import { orchestrate, type ParityReport } from "../orchestrate.js";
import { loadSpecTokens } from "../specTokens.js";
import { pushBack } from "../pushback.js";
import { renderReport } from "../report.js";
import {
  parseShard,
  partitionComponents,
  SHARD_FORMAT_VERSION,
  type ShardReport,
  type ShardSelector,
} from "../shard.js";

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
  shard?: ShardSelector;
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
      // One slice of the run (`--shard 2/6`). Throws on a malformed or
      // out-of-range selector: a typo that silently compared everything (or
      // nothing) would land as a merged index that looks complete.
      case "--shard":
        out.shard = parseShard(next());
        break;
      default:
        if (a && !a.startsWith("--")) out.components.push(a);
    }
  }
  return out;
}

/**
 * Write this shard's `shard.json` — the declaration `design-parity merge` reads:
 * what the shard was responsible for, and the landing-page rows it produced.
 *
 * Written even for an empty slice (see the caller), because the merge treats a
 * shard that never reported as a hard error rather than an absence.
 */
export async function writeShardReport(
  outDir: string,
  shard: ShardSelector,
  components: string[],
  report: Pick<
    ParityReport,
    "direction" | "status" | "blocked" | "warnings" | "indexEntries"
  >,
): Promise<string> {
  const doc: ShardReport = {
    formatVersion: SHARD_FORMAT_VERSION,
    index: shard.index,
    total: shard.total,
    components,
    direction: report.direction,
    status: report.status,
    blocked: report.blocked,
    warnings: report.warnings,
    entries: report.indexEntries ?? [],
  };
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, "shard.json");
  await writeFile(path, JSON.stringify(doc, null, 2) + "\n");
  return path;
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

export async function main(): Promise<number> {
  const args = parseArgs(argv.slice(2));
  if (args.components.length === 0) {
    stdout.write(
      "design-parity run --components <code#Member,...> [--repo .] " +
        "[--candidates file.json] [--candidate-bundles <png|dir,...>] [--out dir] " +
        "[--repo-slug owner/repo --branch <branch> --source-commit <sha> --bundle-image <file>] " +
        "[--shard <index>/<total>] [--push-back [--canvas-endpoint <url>]]\n",
    );
    return 2;
  }

  // This shard's slice, derived from the full list every shard is given — so the
  // caller passes the same `--components` to all of them and no job has to know
  // what its siblings took.
  const components = args.shard
    ? partitionComponents(args.components, args.shard)
    : args.components;
  if (args.shard) {
    stdout.write(
      `Shard ${args.shard.index}/${args.shard.total}: ${components.length} of ` +
        `${new Set(args.components).size} component(s)\n`,
    );
  }
  const { designMap, direction, cmpCapable, warnings } = await resolveRunConfig(
    args.repoRoot,
  );

  // More shards than components leaves the tail shards empty. That is a no-op,
  // not a failure — but it still has to write its `shard.json`, or the merge
  // reports the shard as missing and refuses the whole run.
  if (args.shard && components.length === 0) {
    if (args.outDir) {
      await writeShardReport(args.outDir, args.shard, components, {
        status: "pass",
        blocked: false,
        direction,
        warnings: [],
        indexEntries: [],
      });
    }
    return 0;
  }

  const resolved = resolveCorrespondences(components, { designMap });
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

  // Emitted before push-back and the page listing so a shard that dies in either
  // still leaves the merge a complete declaration of what it did.
  if (args.shard && args.outDir) {
    const path = await writeShardReport(args.outDir, args.shard, components, report);
    stdout.write(`\nWrote ${path}\n`);
  }

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

  // A blocking verdict is the RUN's verdict, not a shard's, so a sharded run
  // reports it in `shard.json` and exits 0 here; `design-parity merge` applies it
  // once, after the merged artifacts exist. Exiting non-zero per shard would take
  // the fan-out down (fail-fast) and strand the reports that diagnose the very
  // failure being reported — the same "publish, then apply the verdict" ordering
  // a hand-written workflow has to get right by hand.
  if (args.shard) return 0;
  return report.blocked ? 1 : 0;
}

// Self-execute when invoked directly (`node dist/cli/run.js …`), guarded so
// tests can import the arg helpers without running the orchestrator. The
// published `design-parity` bin reaches `main` a different way: it *imports*
// this module (so the guard is false) and calls the exported `main()` itself —
// see packages/cli/bin/design-parity.mjs. Both paths run `main` exactly once.
if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  exit(await main());
}
