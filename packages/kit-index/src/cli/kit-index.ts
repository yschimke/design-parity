#!/usr/bin/env node
/**
 * `design-parity-kit-index` — refresh the committed kit vocabulary.
 *
 *   design-parity-kit-index dump  --file <key> [--depth 8] [--map design-map.json]
 *                                 [--out figma-inventory.json]
 *   design-parity-kit-index build --file <key> [--map design-map.json]
 *                                 [--inventory figma-inventory.json]
 *                                 [--out figma-kit-index.json]
 *   design-parity-kit-index validate [--index figma-kit-index.json]
 *
 * Two steps rather than one, because they fail differently. `dump` is the
 * expensive walk of a whole design file — one request per page, retried — and
 * its output is disposable. `build` is the cheap projection of that walk into
 * the small file that gets committed, and it is the step worth re-running while
 * a design map is still changing.
 *
 * Both need `FIGMA_TOKEN` (personal access token) or `FIGMA_OAUTH_TOKEN`;
 * `build` degrades without one, writing an index with no property vocabulary
 * and saying so. `validate` never touches the network.
 *
 * This is deliberately a human-invoked step, not something a parity run does:
 * it reads a live design tool and rewrites a committed file, which belongs in a
 * "refresh the kit vocabulary" commit a reviewer can see.
 */
import { readFile, writeFile } from "node:fs/promises";
import { argv, env, exit, stderr, stdout } from "node:process";

import { FigmaRestClient } from "@design-parity/adapter-figma";
import type { DesignMap } from "@design-parity/core";

import { buildKitIndex, referencedNodeIds } from "../build.js";
import { dumpInventory, DEFAULT_WALK_DEPTH } from "../inventory.js";
import { KIT_INDEX_FILENAME, parseKitIndex, validateKitIndex } from "../load.js";
import type { KitIndex, KitInventory } from "../types.js";

const USAGE = `design-parity-kit-index — refresh a design kit's committed vocabulary

  design-parity-kit-index dump  --file <fileKey> [--depth ${DEFAULT_WALK_DEPTH}]
                                [--map design-map.json] [--out figma-inventory.json]
  design-parity-kit-index build --file <fileKey> [--map design-map.json]
                                [--inventory figma-inventory.json]
                                [--out ${KIT_INDEX_FILENAME}]
  design-parity-kit-index validate [--index ${KIT_INDEX_FILENAME}]

Environment: FIGMA_TOKEN (personal access token) or FIGMA_OAUTH_TOKEN.
`;

function arg(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  const value = i >= 0 ? argv[i + 1] : undefined;
  return value && !value.startsWith("--") ? value : fallback;
}

const log = (message: string): void => {
  stdout.write(`${message}\n`);
};

function client(): FigmaRestClient {
  const token = env.FIGMA_TOKEN;
  const oauthToken = env.FIGMA_OAUTH_TOKEN;
  if (!token && !oauthToken) {
    stderr.write("FIGMA_TOKEN or FIGMA_OAUTH_TOKEN is required.\n");
    exit(2);
  }
  return new FigmaRestClient({
    ...(token ? { token } : {}),
    ...(oauthToken ? { oauthToken } : {}),
  });
}

/** Read a design map if one exists; an absent map is normal on a first run. */
async function readMap(path: string): Promise<Pick<DesignMap, "components">> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as DesignMap;
  } catch (e) {
    log(`No design map at ${path}: ${e instanceof Error ? e.message : e}`);
    return { components: [] };
  }
}

/** Read a previously generated index, for the offline-rebuild carry-forward. */
async function readPrevious(path: string): Promise<KitIndex | undefined> {
  try {
    return parseKitIndex(await readFile(path, "utf8"), path);
  } catch {
    // A first authenticated build has no previous output to preserve.
    return undefined;
  }
}

function requireFileKey(): string {
  const fileKey = arg("file");
  if (!fileKey) {
    stderr.write("--file <fileKey> is required.\n");
    exit(2);
  }
  return fileKey;
}

async function dump(): Promise<void> {
  const fileKey = requireFileKey();
  const mapPath = arg("map", "design-map.json") as string;
  const outPath = arg("out", "figma-inventory.json") as string;
  const depth = Number(arg("depth", String(DEFAULT_WALK_DEPTH)));

  const map = await readMap(mapPath);
  const refs = map.components.flatMap((entry) => {
    const variants =
      typeof entry.ref === "string" ? [{ ref: entry.ref }] : entry.ref;
    const prefix = `figma:${fileKey}/`;
    return variants
      .filter((v) => v.ref.startsWith(prefix))
      .map((v) => ({ code: entry.code, nodeId: v.ref.slice(prefix.length) }));
  });

  const inventory = await dumpInventory({
    client: client(),
    fileKey,
    depth,
    referencedNodeIds: referencedNodeIds(map, fileKey),
    mappedRefs: refs,
    log,
  });

  await writeFile(outPath, `${JSON.stringify(inventory, null, 2)}\n`);
  log(`\nWrote ${outPath}`);

  if (inventory.mapped.length) {
    log("\n--- Refs in use ---");
    for (const m of inventory.mapped) {
      const flags = [m.found ? null : "MISSING", m.hidden ? "HIDDEN" : null]
        .filter(Boolean)
        .join(" ");
      log(
        `${(m.type ?? "?").padEnd(13)} ${String(m.radius ?? "-").padEnd(8)} ` +
          `${String(m.w).padStart(5)}x${String(m.h).padEnd(6)} ` +
          `${String(m.children).padStart(3)} kids  ${m.name ?? "?"}  ${flags}  ` +
          `${m.code.split("#")[1] ?? m.code}`,
      );
    }
  }

  const failed = inventory.pages.filter((p) => p.error);
  if (failed.length) {
    log(`\n${failed.length} page(s) could not be read:`);
    for (const page of failed) log(`  - ${page.page} (${page.pageId}): ${page.error}`);
  }
}

async function build(): Promise<void> {
  const fileKey = requireFileKey();
  const mapPath = arg("map", "design-map.json") as string;
  const inventoryPath = arg("inventory", "figma-inventory.json") as string;
  const outPath = arg("out", KIT_INDEX_FILENAME) as string;

  const map = await readMap(mapPath);
  let inventory: KitInventory;
  try {
    inventory = JSON.parse(await readFile(inventoryPath, "utf8")) as KitInventory;
  } catch (e) {
    stderr.write(
      `Cannot read the inventory at ${inventoryPath}: ` +
        `${e instanceof Error ? e.message : e}\nRun \`dump\` first.\n`,
    );
    exit(2);
  }

  const hasToken = Boolean(env.FIGMA_TOKEN || env.FIGMA_OAUTH_TOKEN);
  const previous = await readPrevious(outPath);
  const { index, stats } = await buildKitIndex({
    map,
    inventory,
    fileKey,
    ...(hasToken ? { client: client() } : {}),
    ...(previous ? { previous } : {}),
    generatedBy: "design-parity-kit-index",
    log,
  });

  await writeFile(outPath, `${JSON.stringify(index, null, 2)}\n`);
  log(
    `Wrote ${outPath}: ${stats.sets} set(s), ${stats.variants} variant(s), ` +
      `${stats.renderAliases} hidden variant render alias(es), ` +
      `${stats.standalone} standalone component(s), ` +
      `${stats.specimens} specimen node(s), ` +
      `${stats.propertied} set(s) carrying component properties, ` +
      `${stats.configuredInstances} configured instance render handle(s).`,
  );
}

async function validate(): Promise<void> {
  const indexPath = arg("index", KIT_INDEX_FILENAME) as string;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(indexPath, "utf8"));
  } catch (e) {
    stderr.write(`Cannot read ${indexPath}: ${e instanceof Error ? e.message : e}\n`);
    exit(1);
  }
  const result = validateKitIndex(parsed);
  if (result.valid) {
    log(`${indexPath} is a valid kit index.`);
    return;
  }
  stderr.write(`${indexPath} failed schema validation:\n`);
  for (const error of result.errors) stderr.write(`  ${error}\n`);
  exit(1);
}

const command = argv[2];
const commands: Record<string, () => Promise<void>> = { dump, build, validate };
const run = command ? commands[command] : undefined;
if (!run) {
  stderr.write(USAGE);
  exit(command ? 2 : 0);
}

await run().catch((e: unknown) => {
  stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  exit(1);
});
