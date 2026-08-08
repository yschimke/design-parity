#!/usr/bin/env node
/**
 * `design-parity shard` — print one shard's slice of the run.
 *
 *   design-parity shard --shard 2/6 --repo .                # component handles
 *   design-parity shard --shard 2/6 --repo . --field previewId   # render ids
 *   design-parity shard --shard 2/6 --repo . --field previewId --complement \
 *     --preview-universe catalog/build/compose-previews/previews.json
 *                                                           # render exclusions
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
 *
 * `--complement` prints what this shard does NOT own, which is what a render
 * step passes to `--exclude-preview-id`. Pair it with `--preview-universe` — the
 * complement is only as complete as the set it is taken against, and the design
 * map is not that set whenever the module holds previews no component maps to.
 */
import { argv, cwd, exit, stderr, stdout } from "node:process";
import { readFile } from "node:fs/promises";
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
  /**
   * Preview ids the module can draw, for `--complement --field previewId`.
   *
   * Without it the complement is taken within the *design map*, which is the
   * wrong universe for a render exclusion list whenever the module holds
   * previews no component maps to. m3-catalog is the worked example: 1,095
   * previews, 77 of them carrying `@CatalogComponent(reference = …)` and so 77
   * entries in `design-map.json`. A map-relative complement names the ~64
   * previews the *other shards* own and says nothing about the 1,018 unmapped
   * ones — so every shard still renders the whole module, which is the cost
   * sharding exists to divide.
   */
  previewUniverse?: string;
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
      case "--preview-universe":
        out.previewUniverse = resolvePath(next() ?? ".");
        break;
      default:
        // An unknown `--flag` is rejected rather than ignored, because ignoring
        // it does not skip its VALUE: `--preview-universe path/previews.json` on
        // a CLI predating that flag would fall through here and push the PATH
        // into `components`, so the run would compare a component named after a
        // file and scope the render off a list of one nonexistent handle. A CLI
        // too old for the caller's workflow has to fail loudly.
        if (a?.startsWith("--")) {
          throw new Error(`unknown option: ${a}`);
        }
        if (a) out.components.push(a);
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

/**
 * Every preview id the module can draw, read from `--preview-universe`.
 *
 * Accepts either a `compose-preview` discovery manifest (`{"previews":[{"id":…}]}`)
 * or a plain newline-delimited list of ids, so a consumer can point straight at
 * the manifest its discovery pass already wrote instead of reshaping it in shell.
 *
 * Order is the file's, de-duplicated. Callers that need determinism sort the
 * result themselves — the render does not care, and preserving manifest order
 * keeps a hand-written list readable in the log.
 */
export function parsePreviewUniverse(raw: string): string[] {
  const trimmed = raw.trim();
  let ids: string[];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    const previews = Array.isArray(parsed)
      ? parsed
      : ((parsed as { previews?: unknown })?.previews ?? []);
    if (!Array.isArray(previews)) {
      throw new Error("preview universe: expected a `previews` array");
    }
    ids = previews.map((p) =>
      typeof p === "string" ? p : String((p as { id?: unknown })?.id ?? ""),
    );
  } else {
    ids = trimmed.length === 0 ? [] : trimmed.split("\n");
  }
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export async function main(rawArgs: string[] = argv.slice(2)): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(rawArgs);
  } catch (e) {
    stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  if (!args.shard) {
    stdout.write(
      "design-parity shard --shard <index>/<total> [--repo .] " +
        "[--components <code,...>] [--field code|previewId] [--complement] " +
        "[--preview-universe <previews.json|ids.txt>]\n",
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

  // The exclusion list a render step wants: every preview the module can draw
  // MINUS the ones this shard compares. Taken against the module's own preview
  // set, not the design map's — see `Args.previewUniverse` for why the
  // difference is the whole point of the flag.
  if (args.complement && args.field === "previewId" && args.previewUniverse) {
    const universe = parsePreviewUniverse(
      await readFile(args.previewUniverse, "utf8"),
    );
    const keep = new Set(mine.flatMap((code) => previewIdsFor(map!, code)));
    const missing = [...keep].filter((id) => !universe.includes(id));
    if (missing.length > 0) {
      // The map names a preview the module does not draw — the shard would
      // compare a component with no candidate render. Warn rather than fail:
      // the run is still meaningful for the rest of the slice, and a hard exit
      // here would take down a fan-out over one stale annotation.
      stderr.write(
        `warning: ${missing.length} mapped preview id(s) absent from the ` +
          `preview universe (${missing.slice(0, 5).join(", ")}` +
          `${missing.length > 5 ? ", …" : ""})\n`,
      );
    }
    const excluded = universe.filter((id) => !keep.has(id));
    if (excluded.length > 0) stdout.write(excluded.join("\n") + "\n");
    return 0;
  }

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
