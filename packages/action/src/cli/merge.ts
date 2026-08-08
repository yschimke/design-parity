#!/usr/bin/env node
/**
 * `design-parity merge` — put a sharded run back together.
 *
 *   design-parity merge shards/parity-shard-* --out .design-parity/out \
 *     --repo-slug owner/repo --branch design-parity/main --source-commit "$SHA"
 *
 * Each argument is one shard's `--out` directory (or its `shard.json` directly).
 * The merge verifies the shards cover the run exactly once, copies every
 * component's report subdir into `--out`, and regenerates the landing page from
 * the unioned rows — producing the artifact set a single serial run would have
 * written, so nothing downstream (publish, the branch layout, a consumer reading
 * `index.html`) has to know the run was sharded at all.
 *
 * Exit code carries the run's verdict: 1 when any shard blocked, 0 otherwise.
 * That is deliberately the LAST thing this does — the artifacts are on disk
 * before the process fails, so a blocking run still publishes the reports that
 * explain it.
 */
import { argv, cwd, exit, stderr, stdout } from "node:process";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import { renderIndex } from "@design-parity/report-html";

import { mergeShards, verifyShardReports, type ShardReport } from "../shard.js";
import {
  RUN_MANIFEST_VERSION,
  carryForward,
  readRunManifest,
  writeRunManifest,
} from "../run-manifest.js";

interface Args {
  shardDirs: string[];
  outDir?: string;
  repoSlug?: string;
  branch?: string;
  sourceCommit?: string;
  bundleImage?: string;
  previousDir?: string;
  cacheKey?: string;
}

export function parseArgs(args: string[]): Args {
  const out: Args = { shardDirs: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[(i += 1)];
    switch (a) {
      case "merge":
        break;
      case "--out":
      case "-o":
        out.outDir = next();
        break;
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
      case "--previous":
        out.previousDir = next();
        break;
      case "--cache-key":
        out.cacheKey = next();
        break;
      default:
        if (a && !a.startsWith("-")) out.shardDirs.push(a);
    }
  }
  return out;
}

/**
 * The directory holding a shard's artifacts, given whatever the caller pointed
 * at. Accepts the out dir itself or the `shard.json` inside it, because CI globs
 * land on either (`find … -name shard.json` is the reliable way to enumerate
 * downloaded artifacts, and passing the file is then one less `dirname`).
 */
function shardDirOf(path: string): string {
  return basename(path) === "shard.json" ? dirname(path) : path;
}

/** Read one shard's declaration, failing with the path when it isn't one. */
export async function readShardReport(dir: string): Promise<ShardReport> {
  const path = join(dir, "shard.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `${path}: no shard.json — a shard's --out dir must come from a ` +
        `\`design-parity run --shard <i>/<n>\``,
    );
  }
  const doc = JSON.parse(raw) as ShardReport;
  if (typeof doc.index !== "number" || typeof doc.total !== "number") {
    throw new Error(`${path}: not a shard report (missing index/total)`);
  }
  return doc;
}

/**
 * Copy a shard's per-component report subdirs into the merged out dir.
 *
 * Only directories are copied: the shard's own `index.html` / `README.md` /
 * `shard.json` are per-shard views that the merged ones replace, and copying
 * them would have the last shard's partial index win over the merged one.
 * Component dirs are disjoint across shards by construction (the partition is
 * disjoint and a dir is named for its component), so there is nothing to
 * reconcile — `verifyShardReports` has already established that.
 */
async function copyComponentDirs(from: string, to: string): Promise<number> {
  let copied = 0;
  const entries = await readdir(from, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    await cp(join(from, e.name), join(to, e.name), { recursive: true });
    copied += 1;
  }
  return copied;
}

/**
 * `rawArgs` defaults to the process argv; passing it explicitly is how tests
 * drive the command without mutating `process` (the `node:process` named imports
 * are bound at module load, so stubbing `process.argv` would not reach them).
 */
export async function main(rawArgs: string[] = argv.slice(2)): Promise<number> {
  const args = parseArgs(rawArgs);
  if (args.shardDirs.length === 0 || !args.outDir) {
    stdout.write(
      "design-parity merge <shard-out-dir|shard.json>... --out <dir> " +
        "[--repo-slug owner/repo --branch <branch> --source-commit <sha> " +
        "--bundle-image <file> --previous <dir> --cache-key <key>]\n",
    );
    return 2;
  }

  const dirs = args.shardDirs.map((p) => resolvePath(cwd(), shardDirOf(p)));
  const reports: ShardReport[] = [];
  for (const dir of dirs) reports.push(await readShardReport(dir));

  const problems = verifyShardReports(reports);
  if (problems.length > 0) {
    // Loud and specific: this runs after every shard has spent its full budget,
    // so a merged index quietly missing a slice is the expensive failure.
    stderr.write(
      "Shard verification failed — refusing to publish a partial run:\n" +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\n",
    );
    return 1;
  }

  const merged = mergeShards(reports);
  const outDir = resolvePath(cwd(), args.outDir);
  await mkdir(outDir, { recursive: true });

  let components = 0;
  for (const dir of dirs) components += await copyComponentDirs(dir, outDir);

  // Carry forward what this run did not produce. A reference the run could not
  // read — rate limited, a source briefly unreachable — would otherwise vanish
  // from the branch entirely, because publishing replaces it wholesale: the run
  // would not merely lack a verdict for that component, it would delete the last
  // one anybody had. Rolling the previous rows in makes the board complete and
  // its rows individually dated, which is the honest description of a partial
  // refresh (design-parity#289).
  const previous = args.previousDir
    ? await readRunManifest(resolvePath(cwd(), args.previousDir))
    : undefined;
  const carried = carryForward(merged.entries, previous);
  for (const entry of carried) {
    const dir = entry.reportPath?.split("/")[0];
    if (!dir) continue;
    await cp(
      join(resolvePath(cwd(), args.previousDir!), dir),
      join(outDir, dir),
      { recursive: true },
    ).catch(() => {
      // The row survives without its report dir: a link to a missing page is a
      // smaller loss than dropping the component off the board silently.
    });
  }
  const entries = [...merged.entries, ...carried].sort((a, b) =>
    a.code.localeCompare(b.code),
  );

  // The verdict covers the union. A blocking finding does not stop being one
  // because this run could not re-measure it, and a run that went green by
  // losing sight of the failure is the exact outcome this is guarding against.
  const blocked = merged.blocked || carried.some((e) => e.status === "fail");

  const { readme, html } = renderIndex({
    entries,
    ...(args.repoSlug ? { repoSlug: args.repoSlug } : {}),
    ...(args.branch ? { branch: args.branch } : {}),
    ...(args.sourceCommit ? { sourceCommit: args.sourceCommit } : {}),
    ...(args.bundleImage ? { bundleImage: args.bundleImage } : {}),
  });
  await writeFile(join(outDir, "README.md"), readme);
  await writeFile(join(outDir, "index.html"), html);
  await writeRunManifest(outDir, {
    formatVersion: RUN_MANIFEST_VERSION,
    ...(args.sourceCommit ? { sourceCommit: args.sourceCommit } : {}),
    direction: merged.direction,
    status: merged.status,
    blocked,
    ...(args.cacheKey ? { cacheKey: args.cacheKey } : {}),
    entries,
  });

  stdout.write(
    `Merged ${reports.length}/${merged.total} shard(s): ` +
      `${merged.entries.length} component(s), ${components} report dir(s), ` +
      `${merged.warnings.length} warning(s) → ${outDir}\n` +
      (carried.length > 0
        ? `Carried ${carried.length} component(s) forward from the previous run ` +
          `(not refreshed here) — ${entries.length} on the board.\n`
        : "") +
      `Parity ${merged.status} (${merged.direction})${blocked ? " — blocking" : ""}\n`,
  );
  if (merged.warnings.length > 0) {
    stdout.write(merged.warnings.map((w) => `  ! ${w}`).join("\n") + "\n");
  }

  // Verdict last, artifacts first — see the module header.
  return blocked ? 1 : 0;
}

if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  exit(await main());
}
