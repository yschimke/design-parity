#!/usr/bin/env node
/**
 * `design-parity shard` — print one shard's slice of the run.
 *
 *   design-parity shard --shard 2/6 --repo .                # component handles
 *   design-parity shard --shard 2/6 --repo . --field previewId   # render ids
 *
 * A sharded run has two sides that MUST agree on the partition: the render step
 * (which previews this job draws) and `design-parity run --shard` (which
 * components this job compares). If they disagree, the shard renders previews it
 * never diffs and diffs components it never rendered — which surfaces only as
 * "no candidate render available" warnings on a green run.
 *
 * So the partition has exactly one implementation ({@link partitionComponents}),
 * and this command is how a workflow's *render* step reads it. No re-derivation
 * in shell, no second sort order to keep in step.
 *
 * Output is one item per line (empty for an empty slice, which is a legitimate
 * no-op when there are more shards than components), so it drops straight into
 * `mapfile` / `xargs` / a `--id` loop.
 */
import { argv, cwd, exit, stderr, stdout } from "node:process";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import { entryPreviewIds, findAllByCode, loadDesignMap } from "@design-parity/core";

import { parseShard, partitionComponents, type ShardSelector } from "../shard.js";

/** What to print for each component in the slice. */
export type ShardField = "code" | "previewId";

interface Args {
  repoRoot: string;
  components: string[];
  field: ShardField;
  shard?: ShardSelector;
  /** Print the components/previews NOT in this shard (render exclusion lists). */
  complement: boolean;
}

export function parseArgs(args: string[]): Args {
  const out: Args = {
    repoRoot: cwd(),
    components: [],
    field: "code",
    complement: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[(i += 1)];
    switch (a) {
      case "shard":
        break;
      case "--repo":
        out.repoRoot = resolvePath(next() ?? ".");
        break;
      case "--components":
        out.components.push(...(next() ?? "").split(",").filter(Boolean));
        break;
      case "--shard":
        out.shard = parseShard(next());
        break;
      case "--field":
        out.field = next() === "previewId" ? "previewId" : "code";
        break;
      case "--complement":
        out.complement = true;
        break;
      default:
        if (a && !a.startsWith("--")) out.components.push(a);
    }
  }
  return out;
}

/**
 * The preview ids a component renders as, from the design map.
 *
 * A component can declare several (one per variant — light/dark, issue #111),
 * and every one of them belongs to whichever shard owns the component: splitting
 * a component's variants across shards would give each shard half a triptych.
 */
export function previewIdsFor(
  map: Parameters<typeof findAllByCode>[0],
  code: string,
): string[] {
  return findAllByCode(map, code).flatMap((entry) =>
    entryPreviewIds(entry).map((v) => v.previewId),
  );
}

export async function main(rawArgs: string[] = argv.slice(2)): Promise<number> {
  const args = parseArgs(rawArgs);
  if (!args.shard) {
    stdout.write(
      "design-parity shard --shard <index>/<total> [--repo .] " +
        "[--components <code,...>] [--field code|previewId] [--complement]\n",
    );
    return 2;
  }

  // The component universe: whatever was passed, else every component in the
  // committed design map — which is what makes an *exhaustive* run the default
  // rather than something a workflow has to enumerate by hand.
  const map =
    args.components.length === 0 || args.field === "previewId"
      ? await loadDesignMap(join(args.repoRoot, "design-map.json"))
      : undefined;
  const components =
    args.components.length > 0 ? args.components : (map?.components ?? []).map((c) => c.code);

  if (components.length === 0) {
    stderr.write(
      "no components: pass --components, or commit a design-map.json with entries\n",
    );
    return 1;
  }

  const mine = partitionComponents(components, args.shard);
  const selected = args.complement
    ? [...new Set(components)].sort().filter((c) => !mine.includes(c))
    : mine;

  const lines =
    args.field === "previewId"
      ? selected.flatMap((code) => previewIdsFor(map!, code))
      : selected;

  if (lines.length > 0) stdout.write(lines.join("\n") + "\n");
  return 0;
}

if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  exit(await main());
}
