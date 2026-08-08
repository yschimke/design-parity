#!/usr/bin/env node
/**
 * `design-parity import` — refresh the committed reference cache.
 *
 *   design-parity import --repo . --cache reference-cache [--max 200] \
 *     [--force] [--format svg|png] [--scale 2] [--prune]
 *
 * Reads `design-map.json`, works out which Figma nodes the catalog needs, and
 * brings the cache directory up to date IN PLACE — refreshing what has moved,
 * oldest first, and leaving everything it could not fetch exactly as it was.
 * The parity run then reads that directory and makes no Figma calls at all
 * (`design-parity run --reference-cache <dir> --reference-cache-only`).
 *
 * Run it on a schedule, on dispatch, or when the kit changes. It is safe to run
 * as often as you like: an unchanged file costs one request.
 *
 * Prints `refreshed=`, `carried=`, `failed=`, `unchanged=`, `pruned=` and
 * `complete=` — one `name=value` per line, readable in a log and appendable to
 * `$GITHUB_OUTPUT` verbatim.
 *
 * Exit code is 0 for a partial import. That is the designed outcome, not a
 * failure: the cache is strictly better than it was, and the next run finishes
 * the job. Only a missing token or an unusable design map exits non-zero.
 */
import { argv, cwd, env, exit, stderr, stdout } from "node:process";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import {
  FigmaRestClient,
  type FigmaRestClientOptions,
} from "@design-parity/adapter-figma";

import { resolveRunConfig } from "../config.js";
import { figmaRefsOf, importReferences } from "../import.js";

const TOKEN_ENV = ["FIGMA_TOKEN", "FIGMA_PAT", "FIGMA_ACCESS_TOKEN"] as const;

export const USAGE =
  "design-parity import --cache <dir> [--repo .] [--max <n>] [--force] " +
  "[--format svg|png] [--scale <n>] [--prune]\n";

export interface ImportArgs {
  repoRoot: string;
  cacheDir?: string;
  max: number;
  force: boolean;
  prune: boolean;
  format: "png" | "svg";
  scale?: number;
}

export function parseArgs(args: string[]): ImportArgs {
  const out: ImportArgs = {
    repoRoot: cwd(),
    max: 0,
    force: false,
    prune: false,
    format: "svg",
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[(i += 1)];
    switch (a) {
      case "import":
        break;
      case "--repo":
        out.repoRoot = resolvePath(next() ?? ".");
        break;
      case "--cache":
        out.cacheDir = next();
        break;
      // A ceiling on how much one import re-reads. Combined with oldest-first
      // it turns a kit too large for a single job into one imported over
      // several — each run finishing where the last left off.
      case "--max":
        out.max = Number(next() ?? 0) || 0;
        break;
      case "--force":
        out.force = true;
        break;
      case "--prune":
        out.prune = true;
        break;
      case "--format": {
        const v = next();
        if (v === "png" || v === "svg") out.format = v;
        break;
      }
      case "--scale":
        out.scale = Number(next() ?? 0) || undefined;
        break;
      default:
        break;
    }
  }
  return out;
}

export async function main(rawArgs: string[] = argv.slice(2)): Promise<number> {
  const args = parseArgs(rawArgs);
  if (!args.cacheDir) {
    stdout.write(USAGE);
    return 2;
  }

  const oauthToken = env.FIGMA_OAUTH_TOKEN;
  const token = TOKEN_ENV.map((k) => env[k]).find(Boolean);
  if (!oauthToken && !token) {
    stderr.write(
      "design-parity import: no credentials — set FIGMA_TOKEN (PAT) or FIGMA_OAUTH_TOKEN.\n",
    );
    return 1;
  }

  const { designMap, warnings } = await resolveRunConfig(args.repoRoot);
  for (const warning of warnings) stdout.write(`warning: ${warning}\n`);
  const refs = figmaRefsOf(designMap);
  if (refs.length === 0) {
    stdout.write("No figma references in design-map.json — nothing to import.\n");
    // Not an error: a repo can map every component to another source, and a
    // scheduled import that fails on it would be noise for a correct config.
    stdout.write("refreshed=0\ncarried=0\nfailed=0\nunchanged=\npruned=0\ncomplete=true\n");
    return 0;
  }

  const clientOpts: FigmaRestClientOptions = {};
  if (oauthToken) clientOpts.oauthToken = oauthToken;
  if (token) clientOpts.token = token;

  const result = await importReferences({
    cacheDir: resolvePath(args.repoRoot, args.cacheDir),
    refs,
    client: new FigmaRestClient(clientOpts),
    limit: args.max,
    force: args.force,
    prune: args.prune,
    imageFormat: args.format,
    ...(args.scale !== undefined ? { imageScale: args.scale } : {}),
    log: (m) => stdout.write(m + "\n"),
  });

  for (const warning of result.warnings) stdout.write(`warning: ${warning}\n`);
  stdout.write(
    `\n${result.refreshed} refreshed, ${result.carried} carried forward` +
      (result.failed > 0 ? ` (${result.failed} of them due a refresh)` : "") +
      `${result.pruned.length > 0 ? `, ${result.pruned.length} pruned` : ""}.\n`,
  );
  if (!result.complete) {
    stdout.write(
      "The cache is not fully fresh. Nothing was lost — the stale entries are " +
        "next run's oldest, so they refresh first.\n",
    );
  }

  stdout.write(`refreshed=${result.refreshed}\n`);
  stdout.write(`carried=${result.carried}\n`);
  stdout.write(`failed=${result.failed}\n`);
  stdout.write(`unchanged=${result.unchanged.join(",")}\n`);
  stdout.write(`pruned=${result.pruned.length}\n`);
  stdout.write(`complete=${result.complete}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  exit(await main());
}
