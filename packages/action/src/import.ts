/**
 * Importing the reference side, on its own schedule.
 *
 * WHY THIS IS NOT PART OF THE RUN. Code changes many times a day; a published
 * design kit changes rarely. Coupling them meant paying the full reference cost
 * on every commit — and paying it against a per-token rate limiter, which is
 * how a 77-component catalog came to report on 18 components, with a different
 * 18 each run (issue #289). Splitting the two lets each run at its own cadence
 * and turns a rate limit from data loss into a delay.
 *
 * THE THREE PROPERTIES THAT MAKE IT CONVERGE.
 *
 * 1. **A metadata short-circuit.** `GET /v1/files/:key?depth=1` carries the
 *    file `version`, which changes on any edit. One request answers "can any
 *    reference in this file have moved?" for the whole file — so an unchanged
 *    kit costs one request, not two per component.
 * 2. **Oldest-first.** What could not be fetched this time is the oldest thing
 *    in the cache next time, so it goes to the front of the queue. An import
 *    that only ever gets through half the catalog still reaches all of it, in
 *    two runs rather than never.
 * 3. **Partial by design.** A node that fails keeps the entry it already had —
 *    blobs and all — and keeps its OLD `fileVersion`, so it stays stale and
 *    stays queued. Nothing is deleted because a request failed; that deletion
 *    is precisely what made a rate-limited run lose its previous results.
 *
 * This module is the policy; the on-disk format is
 * {@link https://github.com/yschimke/design-parity/blob/main/packages/adapters/figma/src/reference-cache.ts | ReferenceCache}.
 */
import {
  FigmaNodeNotFoundError,
  FigmaRateLimitError,
  ReferenceCacheWriter,
  cacheKeyOf,
  parseFigmaRef,
  type CachedNodeDoc,
  type FigmaRestClient,
  type ReferenceCacheEntry,
} from "@design-parity/adapter-figma";
import type { DesignMap } from "@design-parity/core";
import { entryRefs } from "@design-parity/core";

/**
 * Node ids per `GET /v1/files/:key/nodes`. Mirrors the adapter's own batch
 * size: small enough that a chunk which fails is cheap to lose, large enough
 * that a catalog is a handful of requests rather than one per component.
 */
const NODE_BATCH = 50;

/**
 * Node ids per `GET /v1/images/:key`. The endpoint takes a comma-separated
 * `ids` exactly like the nodes endpoint, so a render pass costs one request per
 * 50 nodes rather than one per node.
 */
const IMAGE_BATCH = 50;

/** One node the import is responsible for. */
export interface ImportTarget {
  fileKey: string;
  nodeId: string;
}

export interface ImportOptions {
  /** Cache directory, refreshed IN PLACE (see the module doc). */
  cacheDir: string;
  /** Every reference the catalog needs, as design-map `ref` strings. */
  refs: readonly string[];
  client: FigmaRestClient;
  /** Injectable clock — the import stamps `fetchedAt`, and tests pin it. */
  now?: () => Date;
  /**
   * Refresh at most this many nodes. 0 (the default) means "as many as the API
   * allows". A ceiling is how a very large kit is imported over several runs
   * without any one of them running long enough to be killed.
   */
  limit?: number;
  /** Refresh even where the file version says nothing moved. */
  force?: boolean;
  imageFormat?: "png" | "svg";
  imageScale?: number;
  /**
   * Figma `contents_only` export mode. Defaults to true; false includes
   * overlapping layers such as component-sheet backgrounds.
   */
  imageContentsOnly?: boolean;
  /**
   * Per-node overrides keyed as `fileKey/nodeId`. Values from design-map
   * `referenceContentsOnly` take precedence over [imageContentsOnly].
   */
  imageContentsOnlyByNode?: ReadonlyMap<string, boolean>;
  /**
   * Delete cached nodes `refs` no longer names. Off by default: pruning
   * against a partial ref list throws away references the next full import has
   * to fetch again.
   */
  prune?: boolean;
  log?: (message: string) => void;
}

export interface ImportResult {
  /** Nodes re-read from Figma and rewritten. */
  refreshed: number;
  /**
   * Component sets cached alongside them (issue #296). Not catalog nodes: they
   * are what tells a cache-only run what its references *depict* and what their
   * siblings are, neither of which a variant's own document carries.
   */
  sets: number;
  /** Nodes left exactly as the cache already had them. */
  carried: number;
  /** Nodes that were due a refresh and did not get one. Subset of `carried`. */
  failed: number;
  /** Files whose `version` was unchanged, so no node was read at all. */
  unchanged: string[];
  /** Nodes dropped by `prune`. */
  pruned: string[];
  /** Everything that went wrong, in the order it happened. Never thrown. */
  warnings: string[];
  /**
   * True when every reference in `refs` is now cached at the file's current
   * version — i.e. the cache is a complete, fresh description of the catalog.
   */
  complete: boolean;
}

/** Every `figma:` reference in a design map, deduplicated, in map order. */
export function figmaRefsOf(map: DesignMap | undefined): string[] {
  if (!map) return [];
  const out = new Set<string>();
  for (const entry of map.components) {
    if (entry.source !== "figma") continue;
    for (const variant of entryRefs(entry)) out.add(variant.ref);
    // The component *set* is a reference too (issue #299): a page backdrop
    // matches instances against it, and it is as rate-limited as any other node.
    if (entry.refSet) out.add(entry.refSet);
  }
  return [...out];
}

/** Per-node Figma export modes declared by a design map. */
export function figmaContentsOnlyByNodeOf(
  map: DesignMap | undefined,
  fallback = true,
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  if (!map) return out;

  const add = (ref: string, contentsOnly: boolean) => {
    try {
      const parsed = parseFigmaRef(ref);
      const key = cacheKeyOf(parsed.fileKey, parsed.nodeId);
      const previous = out.get(key);
      // One cache key can hold only one render. If duplicate mappings disagree,
      // preserve the opt-in that needs overlapping content rather than silently
      // dropping its authored backdrop.
      out.set(key, previous === undefined ? contentsOnly : previous && contentsOnly);
    } catch {
      // figmaRefsOf/importTargets report unparseable handles through the normal warning path.
    }
  };

  for (const entry of map.components) {
    if (entry.source !== "figma") continue;
    const contentsOnly = entry.referenceContentsOnly ?? fallback;
    for (const variant of entryRefs(entry)) add(variant.ref, contentsOnly);
    if (entry.refSet) add(entry.refSet, fallback);
  }
  return out;
}

/**
 * Parse `refs` into concrete nodes, grouped by file.
 *
 * A ref that is not a parseable Figma handle is skipped, not fatal: Code
 * Connect resolves those, and it needs the repo checkout the import job does
 * not necessarily have. They fall back to the API at run time, which is the
 * behaviour that existed before the cache.
 */
export function importTargets(
  refs: readonly string[],
): { byFile: Map<string, string[]>; skipped: string[] } {
  const byFile = new Map<string, string[]>();
  const skipped: string[] = [];
  for (const ref of refs) {
    let parsed;
    try {
      parsed = parseFigmaRef(ref);
    } catch {
      skipped.push(ref);
      continue;
    }
    const ids = byFile.get(parsed.fileKey) ?? [];
    if (!ids.includes(parsed.nodeId)) ids.push(parsed.nodeId);
    byFile.set(parsed.fileKey, ids);
  }
  return { byFile, skipped };
}

/**
 * Order the nodes due a refresh, oldest first.
 *
 * A node with no entry has never been fetched, which is older than anything,
 * so it sorts ahead of everything else. Ties break on node id purely so the
 * order is deterministic — two imports of the same cache queue the same work.
 */
export function refreshOrder(
  nodeIds: readonly string[],
  entryOf: (nodeId: string) => ReferenceCacheEntry | undefined,
  fileVersion: string,
  force: boolean,
  imageContentsOnly: boolean | ((nodeId: string) => boolean) = true,
): string[] {
  const due = nodeIds.filter((id) => {
    const entry = entryOf(id);
    if (!entry || !entry.image) return true;
    const desired =
      typeof imageContentsOnly === "function" ? imageContentsOnly(id) : imageContentsOnly;
    if ((entry.imageContentsOnly ?? true) !== desired) return true;
    return force || entry.fileVersion !== fileVersion;
  });
  return due.sort((a, b) => {
    const ta = entryOf(a)?.fetchedAt ?? "";
    const tb = entryOf(b)?.fetchedAt ?? "";
    return ta.localeCompare(tb) || a.localeCompare(b);
  });
}

/**
 * Refresh `cacheDir` towards `refs`. Never throws for a source-side failure —
 * a partial import is the designed outcome, not an error state.
 */
export async function importReferences(opts: ImportOptions): Promise<ImportResult> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});
  const imageContentsOnly = opts.imageContentsOnly ?? true;
  const contentsOnlyFor = (fileKey: string, nodeId: string) =>
    opts.imageContentsOnlyByNode?.get(cacheKeyOf(fileKey, nodeId)) ?? imageContentsOnly;
  const format = opts.imageFormat ?? "svg";
  const limit = opts.limit && opts.limit > 0 ? opts.limit : Infinity;

  const result: ImportResult = {
    refreshed: 0,
    sets: 0,
    carried: 0,
    failed: 0,
    unchanged: [],
    pruned: [],
    warnings: [],
    complete: true,
  };

  const { byFile, skipped } = importTargets(opts.refs);
  for (const ref of skipped) {
    result.warnings.push(
      `not a figma handle, left for Code Connect to resolve at run time: ${ref}`,
    );
  }

  const writer = await ReferenceCacheWriter.open(opts.cacheDir);
  const wanted = new Set<string>();
  let budget = limit;

  for (const [fileKey, nodeIds] of byFile) {
    for (const id of nodeIds) wanted.add(cacheKeyOf(fileKey, id));

    // One request to decide whether the other 2N are needed at all.
    let version: string;
    let lastModified: string | undefined;
    try {
      const meta = await opts.client.getFileMeta(fileKey);
      version = meta.version;
      lastModified = meta.lastModified;
    } catch (err) {
      // Without the version there is no way to tell fresh from stale, and
      // guessing "stale" would re-read the whole file every time the metadata
      // call happens to fail. Carry the file forward untouched instead.
      result.warnings.push(`${fileKey}: cannot read file metadata (${message(err)})`);
      result.carried += nodeIds.length;
      result.failed += nodeIds.length;
      result.complete = false;
      continue;
    }

    writer.setFile(fileKey, { version, fetchedAt: now().toISOString(), ...(lastModified ? { lastModified } : {}) });

    const due = refreshOrder(
      nodeIds,
      (id) => writer.entry(fileKey, id),
      version,
      opts.force === true,
      (id) => contentsOnlyFor(fileKey, id),
    );
    if (due.length === 0) {
      result.unchanged.push(fileKey);
      result.carried += nodeIds.length;
      log(`${fileKey}: version ${version} unchanged — ${nodeIds.length} node(s) already cached.`);
      continue;
    }
    result.carried += nodeIds.length - due.length;

    const take = due.slice(0, Math.max(0, budget));
    if (take.length < due.length) {
      result.complete = false;
      result.carried += due.length - take.length;
      log(
        `${fileKey}: refreshing ${take.length} of ${due.length} stale node(s) — the rest are next run's oldest.`,
      );
    } else {
      log(`${fileKey}: version ${version}, refreshing ${take.length} stale node(s).`);
    }
    budget -= take.length;

    // Variables are per file, and a file whose version moved may have moved
    // them too. Best effort: the adapter already treats their absence as
    // structure-only tokens.
    try {
      await writer.putVariables(fileKey, await opts.client.getLocalVariables(fileKey));
    } catch (err) {
      result.warnings.push(`${fileKey}: variables not refreshed (${message(err)})`);
    }

    const fetched = await fetchStructures(opts.client, fileKey, take, result);

    // Resolve every render URL first, batched, then download them.
    //
    // Splitting the two halves is what makes the batching possible: `ids=` takes
    // 50 nodes per request, but each node's bytes come from its own signed CDN
    // URL. The resolve half spends the per-token rate limit; the download half
    // does not, so a limiter that stops the first can still be drained of the
    // second.
    //
    // Grouped by `contentsOnly` because it varies per node and goes in the
    // query, so it applies to a whole batch. `format` and `scale` are
    // import-wide, so they do not split the groups.
    const renderUrls = new Map<string, string>();
    const renderErrors = new Map<string, unknown>();
    let rateLimited = false;
    const byContentsOnly = new Map<boolean, string[]>();
    for (const nodeId of take) {
      if (!fetched.has(nodeId)) continue;
      const nodeContentsOnly = contentsOnlyFor(fileKey, nodeId);
      const group = byContentsOnly.get(nodeContentsOnly) ?? [];
      group.push(nodeId);
      byContentsOnly.set(nodeContentsOnly, group);
    }
    resolve: for (const [nodeContentsOnly, ids] of byContentsOnly) {
      for (let i = 0; i < ids.length; i += IMAGE_BATCH) {
        const chunk = ids.slice(i, i + IMAGE_BATCH);
        try {
          const urls = await opts.client.renderImageUrls(fileKey, chunk, {
            format,
            ...(opts.imageScale !== undefined ? { scale: opts.imageScale } : {}),
            contentsOnly: nodeContentsOnly,
          });
          for (const id of chunk) {
            const url = urls[id];
            if (url) renderUrls.set(id, url);
            else renderErrors.set(id, new FigmaNodeNotFoundError(fileKey, id));
          }
        } catch (err) {
          // A batch fails as a unit, so the error is every node's in it. That is
          // the cost of batching — a 429 now strands up to IMAGE_BATCH nodes
          // rather than one — paid for by hitting the limiter ~50x less often.
          for (const id of chunk) renderErrors.set(id, err);
          if (err instanceof FigmaRateLimitError) {
            rateLimited = true;
            break resolve;
          }
        }
      }
    }

    for (const nodeId of take) {
      const node = fetched.get(nodeId);
      if (!node) {
        // Structure missing: leave the previous entry alone so this node is
        // still stale, still oldest, and still first in line next run.
        result.carried += 1;
        result.failed += 1;
        result.complete = false;
        continue;
      }
      const url = renderUrls.get(nodeId);
      if (url === undefined) {
        const err = renderErrors.get(nodeId);
        if (err === undefined) {
          // Never asked for: the limiter stopped the resolve pass before this
          // node's batch. Untouched, so it stays stale and is next run's oldest
          // — the same outcome the old per-node loop's `break` produced, and
          // counted the same way (silently, not as a failure of its own).
          result.complete = false;
          continue;
        }
        result.warnings.push(`${fileKey}/${nodeId}: image not refreshed (${message(err)})`);
        result.carried += 1;
        result.failed += 1;
        result.complete = false;
        continue;
      }
      try {
        const nodeContentsOnly = contentsOnlyFor(fileKey, nodeId);
        const bytes = await opts.client.downloadImage(url, nodeId);
        await writer.put({
          fileKey,
          nodeId,
          fileVersion: version,
          fetchedAt: now().toISOString(),
          node,
          image: { bytes, format, contentsOnly: nodeContentsOnly },
        });
        result.refreshed += 1;
      } catch (err) {
        // Same reasoning as a missing structure: a node is refreshed only when
        // BOTH halves arrived, so a half-updated entry never reaches the branch.
        result.warnings.push(`${fileKey}/${nodeId}: image not refreshed (${message(err)})`);
        result.carried += 1;
        result.failed += 1;
        result.complete = false;
      }
    }
    if (rateLimited) {
      result.warnings.push(
        `${fileKey}: rate limited — stopping this import; the rest carry forward and refresh next run`,
      );
    }

    await importComponentSets(opts, writer, fileKey, version, fetched, wanted, result, now, log);
  }

  if (opts.prune) {
    result.pruned = await writer.prune(wanted);
    for (const key of result.pruned) log(`pruned ${key} — no longer in the design map.`);
  }

  await writer.write();
  return result;
}

/**
 * Cache the component **sets** the refreshed nodes belong to.
 *
 * A variant carries neither its properties nor its siblings — both live on the
 * set — and Figma returns `componentPropertyDefinitions` only for nodes asked
 * for directly. So without this pass a cache-only run cannot say what its
 * references depict, which is the silent failure issue #296 is about: a
 * reference rendered at `Show icon = true` diffed against label-only code.
 *
 * Structure-only by design: a render of a set is a grid of every variant at
 * once, which nothing compares against. One batched request per file, and a
 * failure is a warning — properties are additive, so their absence degrades the
 * report rather than failing the import.
 */
async function importComponentSets(
  opts: ImportOptions,
  writer: ReferenceCacheWriter,
  fileKey: string,
  version: string,
  fetched: ReadonlyMap<string, CachedNodeDoc>,
  wanted: Set<string>,
  result: ImportResult,
  now: () => Date,
  log: (message: string) => void,
): Promise<void> {
  const setIds = new Set<string>();
  for (const [nodeId, node] of fetched) {
    const setId = node.components?.[nodeId]?.componentSetId;
    if (setId) setIds.add(setId);
  }
  for (const id of [...setIds]) {
    // A set that is itself a catalog reference is already being imported as
    // one — with a render, since something asked for it by name.
    if (fetched.has(id)) {
      setIds.delete(id);
      continue;
    }
    wanted.add(cacheKeyOf(fileKey, id));
    // Already current: the set only moves when the file does, and this pass is
    // reached only for a file whose version moved.
    const have = writer.entry(fileKey, id);
    if (have?.structureOnly && have.fileVersion === version) setIds.delete(id);
  }
  if (setIds.size === 0) return;

  const sets = await fetchStructures(opts.client, fileKey, [...setIds], result);
  for (const [setId, node] of sets) {
    await writer.put({
      fileKey,
      nodeId: setId,
      fileVersion: version,
      fetchedAt: now().toISOString(),
      node,
      structureOnly: true,
    });
    result.sets += 1;
  }
  log(`${fileKey}: cached ${sets.size} component set(s) for their properties and variants.`);
}

/**
 * Read structures for `nodeIds` in as few requests as the API allows.
 *
 * A chunk that fails is simply absent from the returned map, and its nodes
 * carry forward — including on a 429, where the remaining chunks would fail the
 * same way, so it stops rather than spending the retry budget proving it.
 */
async function fetchStructures(
  client: FigmaRestClient,
  fileKey: string,
  nodeIds: readonly string[],
  result: ImportResult,
): Promise<Map<string, CachedNodeDoc>> {
  const out = new Map<string, CachedNodeDoc>();
  for (let i = 0; i < nodeIds.length; i += NODE_BATCH) {
    const chunk = nodeIds.slice(i, i + NODE_BATCH);
    try {
      const res = await client.getFileNodes(fileKey, [...chunk]);
      for (const id of chunk) {
        const entry = res.nodes[id];
        if (entry?.document) {
          out.set(id, {
            document: entry.document,
            ...(entry.styles ? { styles: entry.styles } : {}),
            // The pointer from a variant to the set that owns its properties.
            ...(entry.components ? { components: entry.components } : {}),
          });
        } else {
          result.warnings.push(`${fileKey}/${id}: not present in the file`);
        }
      }
    } catch (err) {
      result.warnings.push(
        `${fileKey}: structure for ${chunk.length} node(s) not refreshed (${message(err)})`,
      );
      if (err instanceof FigmaRateLimitError) break;
    }
  }
  return out;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
