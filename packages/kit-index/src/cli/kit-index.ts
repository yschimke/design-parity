#!/usr/bin/env node
/**
 * `design-parity-kit-index` — refresh the committed kit vocabulary.
 *
 *   design-parity-kit-index dump  --file <key> [--depth 8] [--map design-map.json]
 *                                 [--out figma-inventory.json]
 *   design-parity-kit-index build --file <key> [--map design-map.json]
 *                                 [--inventory figma-inventory.json]
 *                                 [--out figma-kit-index.json]
 *   design-parity-kit-index resolve  [--map design-map.json]
 *                                 [--variants design-map-variants.json]
 *                                 [--index figma-kit-index.json] [--check]
 *   design-parity-kit-index validate [--index figma-kit-index.json]
 *
 * Two groups of subcommand, with different costs and different cadences.
 *
 * `dump` and `build` **refresh the vocabulary**. `dump` is the expensive walk of
 * a whole design file — one request per page, retried — and its output is
 * disposable; `build` is the cheap projection of that walk into the small file
 * that gets committed. Both read a live design tool and rewrite committed
 * files, so they are human-invoked, belonging in a deliberate "refresh the kit
 * vocabulary" commit a reviewer can see. Both want `FIGMA_TOKEN` (personal
 * access token) or `FIGMA_OAUTH_TOKEN`; `build` degrades without one, writing
 * an index with no property vocabulary and saying so.
 *
 * `resolve` **uses** it, and is the opposite: it reads only committed files, so
 * it needs no credential, produces the same map for everyone, and is safe to
 * run on every build. It folds the variant sidecar
 * (`compose-preview-design-map-variants/v1`, written by compose-ai-tools'
 * `emit-design-map.mjs`) into the design map as tagged `ref`/`previewId` pairs.
 * `--check` makes it a drift gate instead of a writer.
 *
 * `validate` never touches the network either.
 */
import { readFile, writeFile } from "node:fs/promises";
import { argv, env, exit, stderr, stdout } from "node:process";

import { FigmaRestClient } from "@design-parity/adapter-figma";
import type { DesignMap } from "@design-parity/core";

import { buildKitIndex, referencedNodeIds } from "../build.js";
import {
  resolveDesignMapVariants,
  type DesignMapVariants,
} from "../design-map.js";
import { dumpInventory, DEFAULT_WALK_DEPTH } from "../inventory.js";
import { KIT_INDEX_FILENAME, loadKitIndex, parseKitIndex, validateKitIndex } from "../load.js";
import { KitIndexResolver, type UnresolvedReason } from "../resolve.js";
import type { Vocabulary } from "../vocabulary.js";
import type { KitIndex, KitInventory } from "../types.js";

/** Where a repo's own axis/value spellings live, when it has any. */
const DEFAULT_VOCABULARY_FILE = "kit-vocabulary.json";

const USAGE = `design-parity-kit-index — refresh a design kit's committed vocabulary

  design-parity-kit-index dump  --file <fileKey> [--depth ${DEFAULT_WALK_DEPTH}]
                                [--map design-map.json] [--out figma-inventory.json]
  design-parity-kit-index build --file <fileKey> [--map design-map.json]
                                [--inventory figma-inventory.json]
                                [--out ${KIT_INDEX_FILENAME}]
  design-parity-kit-index resolve  [--map design-map.json]
                                [--variants design-map-variants.json]
                                [--index ${KIT_INDEX_FILENAME}] [--out <map>]
                                [--vocabulary kit-vocabulary.json]
                                [--check] [--strict]
  design-parity-kit-index validate [--index ${KIT_INDEX_FILENAME}]

Environment: FIGMA_TOKEN (personal access token) or FIGMA_OAUTH_TOKEN.
\`resolve\` and \`validate\` never touch the network.
`;

function arg(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  const value = i >= 0 ? argv[i + 1] : undefined;
  return value && !value.startsWith("--") ? value : fallback;
}

/** Presence flags, read at call time so each subcommand states what it honours. */
const flag = (name: string): boolean => argv.includes(`--${name}`);

const log = (message: string): void => {
  stdout.write(`${message}\n`);
};

/**
 * One line of prose per kind of miss.
 *
 * The wording is chosen so the three are skimmable apart in a list of a
 * hundred: only `no counterpart` names something to go and fix, `the reference
 * already draws this` is not a gap at all, and the middle one says the kit's
 * matrix has a hole rather than its vocabulary.
 */
function explain(reason: UnresolvedReason): string {
  switch (reason.kind) {
    case "base":
      return `the reference already draws this (\`${reason.variant}\`)`;
    case "combination":
      return (
        `each of ${reason.seeds.map((s) => `\`${s}\``).join(", ")} exists in the kit, ` +
        `but no node carries them together`
      );
    case "seeds":
      return `no counterpart for ${reason.missing.map((s) => `\`${s}\``).join(", ")}`;
  }
}

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

/**
 * Fold the variant sidecar into the design map.
 *
 * The one subcommand a downstream repo runs on every parity build: it reads
 * only committed files, so it needs no credential and produces the same map for
 * everyone. `--check` regenerates in memory and fails if the committed map has
 * drifted — the CI posture, since the map is an output.
 */
async function resolve(): Promise<void> {
  const mapPath = arg("map", "design-map.json") as string;
  const variantsPath = arg("variants", "design-map-variants.json") as string;
  const indexPath = arg("index", KIT_INDEX_FILENAME) as string;
  const outPath = arg("out", mapPath) as string;

  const index = await loadKitIndex(indexPath);
  const map = JSON.parse(await readFile(mapPath, "utf8")) as DesignMap;

  // Per-kit vocabulary, merged over the built-in tables key by key. A kit files
  // its variants how it likes, and the alternative to this file is a release of
  // this package every time a downstream catalog learns one more of its
  // spellings — which is a slow way to say something that is just data.
  const vocabularyPath = arg("vocabulary");
  let vocabulary: Partial<Vocabulary> | undefined;
  if (vocabularyPath) {
    vocabulary = JSON.parse(await readFile(vocabularyPath, "utf8")) as Partial<Vocabulary>;
  } else {
    // Honour the conventional filename without being asked, so a repo that has
    // one cannot forget the flag in one of its several workflows and silently
    // resolve fewer variants than the last run did.
    vocabulary = await readFile(DEFAULT_VOCABULARY_FILE, "utf8")
      .then((raw) => JSON.parse(raw) as Partial<Vocabulary>)
      .catch(() => undefined);
    if (vocabulary) log(`Using the kit vocabulary at ${DEFAULT_VOCABULARY_FILE}.`);
  }

  let variants: DesignMapVariants;
  try {
    variants = JSON.parse(await readFile(variantsPath, "utf8")) as DesignMapVariants;
  } catch {
    // No sidecar is the normal state for a catalog whose components declare no
    // variant axes. Nothing to fold in, and the map is already correct.
    log(`No variant sidecar at ${variantsPath} — the map already stands alone.`);
    return;
  }

  const { map: resolved, diagnostics } = resolveDesignMapVariants({
    map,
    variants,
    resolver: new KitIndexResolver(index, vocabulary ? { vocabulary } : {}),
  });
  const text = `${JSON.stringify(resolved, null, 2)}\n`;

  // A contradiction must never reach the committed file: the same node cannot
  // be two previews' counterpart, and a map that said so would have the diff
  // report one of the two renders as wrong.
  if (diagnostics.collisions.length) {
    stderr.write(
      `::error::${diagnostics.collisions.length} variant(s) resolved to a node ` +
        `another variant already owns; refusing to write ${outPath}.\n`,
    );
    for (const c of diagnostics.collisions) {
      stderr.write(
        `  ${c.componentId}: '${c.duplicate}' and '${c.owner}' both resolve to ${c.ref}\n`,
      );
    }
    exit(2);
  }

  if (flag("check")) {
    const current = await readFile(outPath, "utf8").catch(() => null);
    if (current !== text) {
      stderr.write(
        `::error::${outPath} is out of date — regenerate with ` +
          `\`design-parity-kit-index resolve\`.\n`,
      );
      exit(1);
    }
    log(`${outPath} is up to date.`);
  } else {
    await writeFile(outPath, text);
    log(
      `Wrote ${outPath}: ${diagnostics.resolved} variant reference(s) across ` +
        `${diagnostics.components} component(s).`,
    );
  }

  if (diagnostics.propertyVariants.length) {
    log(
      `\n${diagnostics.propertyVariants.length} variant(s) are a component ` +
        `PROPERTY in the kit, not a variant beside it. A definition node renders ` +
        `at the defaults, and no exact configured instance was indexed for these ` +
        `values, so they remain unpaired:`,
    );
    for (const v of diagnostics.propertyVariants) {
      const named = v.properties
        .map((p) => `\`${p.name}\` (${p.type}, default ${JSON.stringify(p.default)})`)
        .join(", ");
      log(
        `  - ${v.componentId} / ${v.variant} (${v.vector}) — ${v.setName}: ${named}` +
          (v.coversVariant ? " — the reference already draws THIS variant" : ""),
      );
    }
  }

  if (diagnostics.unresolved.length) {
    log(
      `\n${diagnostics.unresolved.length} variant(s) are left uncompared. Each ` +
        `line says which kind of miss it is — only \`no counterpart\` is a value ` +
        `nobody has mapped:`,
    );
    for (const v of diagnostics.unresolved) {
      log(`  - ${v.componentId} / ${v.variant} (${v.vector}) — ${explain(v.reason)}`);
    }
  }

  if (diagnostics.defaulted.length) {
    log(
      `\n${diagnostics.defaulted.length} reference(s) draw optional content by ` +
        `default. Every render made from them includes it, so a sticker that ` +
        `leaves it out is compared against something it never claimed:`,
    );
    for (const d of diagnostics.defaulted) {
      log(
        `  - ${d.componentId} — ${d.setName}: ` +
          d.properties.map((p) => `\`${p}\``).join(", "),
      );
    }
  }

  if (diagnostics.orphaned.length) {
    log(
      `\n${diagnostics.orphaned.length} declaration(s) name a code handle the ` +
        `map has no entry for — the two files were generated from different runs:`,
    );
    for (const code of diagnostics.orphaned) log(`  - ${code}`);
  }

  if (flag("strict") && (diagnostics.unresolved.length || diagnostics.orphaned.length)) {
    stderr.write(
      `::error::--strict: ${diagnostics.unresolved.length} unresolved variant(s), ` +
        `${diagnostics.orphaned.length} orphaned declaration(s).\n`,
    );
    exit(1);
  }
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
const commands: Record<string, () => Promise<void>> = {
  dump,
  build,
  resolve,
  validate,
};
const run = command ? commands[command] : undefined;
if (!run) {
  stderr.write(USAGE);
  exit(command ? 2 : 0);
}

await run().catch((e: unknown) => {
  stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  exit(1);
});
