/**
 * The committed reference cache: what a Figma node looked like, on disk.
 *
 * WHY THIS EXISTS. The reference side and the code side change on completely
 * different cadences — code many times a day, a published design kit rarely —
 * yet a parity run re-fetched every reference on every commit. Against a
 * per-token rate limiter that is not merely wasteful: a run that cannot fetch
 * everything reports on the fraction it managed, and the fraction moves run to
 * run (issue #289).
 *
 * So the reference is *imported* on its own schedule and *read* by the run.
 * Everything the diff needs about a node — its structure, its rendered image,
 * the file's variables — is a file in a directory, which means it can be
 * committed to a branch exactly like the artifacts are. No hosted dependency
 * (Principle 1), no live source at run time, and a diff that is reproducible
 * because the reference is pinned rather than re-fetched.
 *
 * The layout is deliberately plain, because a human reads it in a PR diff:
 *
 * ```
 *   index.json                       — the manifest below
 *   <fileKey>/variables.json         — one per file, not one per node
 *   <fileKey>/<nodeId>/node.json     — the structure the tokens come from
 *   <fileKey>/<nodeId>/image.svg     — the rendered reference
 * ```
 *
 * Node ids contain a colon (`1:42`), which is legal on POSIX but not on
 * Windows and awkward everywhere, so directories use the dashed spelling
 * (`1-42`) — the same one Figma's own URLs use. {@link cacheEntryDir}.
 */
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import type {
  FigmaComponentMeta,
  FigmaNodeDoc,
  FigmaStyleMeta,
  VariablesResponse,
} from "./figma-api.js";

/**
 * Bumped when a reader can no longer make sense of an older cache. A cache
 * written by a newer format is ignored rather than misread — the import then
 * refetches into the current one, which costs a run's worth of API calls and
 * loses nothing.
 */
export const REFERENCE_CACHE_FORMAT_VERSION = 1;

/** The manifest's name inside a cache directory. */
export const REFERENCE_CACHE_INDEX = "index.json";

/** What one cached node carries. Paths are cache-relative and POSIX-separated. */
export interface ReferenceCacheEntry {
  fileKey: string;
  /** Canonical, colon-separated (`1:42`) — the form the REST API takes. */
  nodeId: string;
  /**
   * The file `version` in effect when this entry was fetched. An import
   * compares it against the file's current version to decide whether this node
   * can have moved; unequal means stale, never "wrong".
   */
  fileVersion: string;
  /** ISO-8601. What "refresh oldest-first" orders on, and what dates a stale row. */
  fetchedAt: string;
  /** Structure JSON, relative to the cache root. */
  node: string;
  /** Rendered reference image, relative to the cache root. Absent ⇒ structure only. */
  image?: string;
  imageFormat?: "png" | "svg";
  /**
   * Figma `contents_only` mode used for this render. Older cache entries omit
   * it and therefore mean Figma's default, `true`.
   */
  imageContentsOnly?: boolean;
  /**
   * Figma render scale used for this image. **PNG only** — the client sends
   * scale as `format=png&scale=…` and omits it for SVG — so an SVG entry has
   * none. Absent on a PNG entry means 2, which is what the client renders at
   * when no scale is given, not the API's bare 1.
   *
   * Recorded so a scale change is a reason to refresh. It is passed to Figma at
   * render time but was never persisted, so nothing could compare it — the same
   * shape as [imageFormat], which was persisted and compared nowhere.
   */
  imageScale?: number;
  /**
   * What this entry records about the import's `--placeholder-fill`, in three
   * states:
   *
   * - **a mode** (`flat`, `checkerboard`, `#rrggbb`) — this entry carries an
   *   empty image fill, painted that way.
   * - **`no-placeholder`** — a scan looked and found none, so no mode can change
   *   a pixel of this entry.
   * - **absent** — written before the mode was recorded at all. Presence is
   *   unknown, so it is due a re-read once and then settles.
   *
   * Recorded so a mode change is a reason to refresh, exactly as
   * [imageContentsOnly] is: the paint is applied at download, so without it the
   * mode reaches only nodes re-read for some other reason and a cache ends up
   * half normalised with nothing on it saying which half is which.
   *
   * The third state is what keeps that cheap. Recording a mode on every entry
   * made a switch look like a reason to re-read the whole kit — the first one on
   * `wear-m3-catalog` refreshed all 581 nodes to rewrite 549 of them
   * byte-identically, on the one lane allowed to spend the Figma token.
   */
  imagePlaceholderFill?: string;
  /**
   * This entry is a **component set**, cached for its properties and its
   * variant names rather than for a picture of it (issue #296). Rendering a set
   * would produce a grid of every variant at once, which nothing compares
   * against, so `image` is absent here **by design** rather than because an
   * import half-finished — which is what a reader would otherwise conclude.
   */
  structureOnly?: boolean;
}

/** Per-file state: the last metadata seen, and where the variables landed. */
export interface ReferenceCacheFile {
  version: string;
  lastModified?: string;
  fetchedAt: string;
  /** Variables JSON, relative to the cache root. Absent ⇒ never fetched. */
  variables?: string;
}

/** `index.json` — the whole cache, minus the blobs. */
export interface ReferenceCacheDoc {
  formatVersion: number;
  /** Keyed by file key. */
  files: Record<string, ReferenceCacheFile>;
  /** Sorted by `fileKey` then `nodeId`, so the committed diff is stable. */
  entries: ReferenceCacheEntry[];
}

/** The structure half of an entry: the document, and the styles it references. */
export interface CachedNodeDoc {
  document: FigmaNodeDoc;
  styles?: Record<string, FigmaStyleMeta>;
  /**
   * The file-level component metadata the nodes response carried. The
   * load-bearing field is `componentSetId`: a variant's document holds no
   * pointer to the set that owns its properties, so a cache without this
   * cannot tell that the node it holds *has* a family (issue #296).
   */
  components?: Record<string, FigmaComponentMeta>;
}

/** `1:42` ⇒ `1-42`: a directory name that is legal on every filesystem. */
export function nodeDirName(nodeId: string): string {
  return nodeId.replace(/:/g, "-");
}

/** Cache-relative directory for one node's blobs. */
export function cacheEntryDir(fileKey: string, nodeId: string): string {
  return `${fileKey}/${nodeDirName(nodeId)}`;
}

/** The key an entry is looked up by. */
export function cacheKeyOf(fileKey: string, nodeId: string): string {
  return `${fileKey}/${nodeId}`;
}

/** An empty cache document — what a first import starts from. */
export function emptyReferenceCache(): ReferenceCacheDoc {
  return { formatVersion: REFERENCE_CACHE_FORMAT_VERSION, files: {}, entries: [] };
}

function isDoc(value: unknown): value is ReferenceCacheDoc {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as Partial<ReferenceCacheDoc>;
  return (
    typeof doc.formatVersion === "number" &&
    Array.isArray(doc.entries) &&
    typeof doc.files === "object" &&
    doc.files !== null
  );
}

/**
 * Read a cache directory's manifest.
 *
 * Returns `undefined` for every "there is nothing usable here" case — absent,
 * unreadable, not JSON, a format from the future — because all of them mean the
 * same thing to both callers: the import writes a fresh cache, and a run
 * configured to read one says so plainly instead of half-using a broken one.
 */
export async function readReferenceCacheDoc(
  dir: string,
): Promise<ReferenceCacheDoc | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(dir, REFERENCE_CACHE_INDEX), "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isDoc(parsed)) return undefined;
  if (parsed.formatVersion > REFERENCE_CACHE_FORMAT_VERSION) return undefined;
  return parsed;
}

/**
 * A cache directory, opened for reading.
 *
 * Blobs are read lazily and memoised: a run touches a handful of the entries a
 * catalog-sized cache holds, and reading 77 node documents to resolve six of
 * them would trade an API cost for a disk one.
 */
export class ReferenceCache {
  readonly dir: string;
  readonly doc: ReferenceCacheDoc;
  readonly #byKey: Map<string, ReferenceCacheEntry>;
  readonly #nodes = new Map<string, Promise<CachedNodeDoc | undefined>>();
  readonly #variables = new Map<string, Promise<VariablesResponse>>();

  constructor(dir: string, doc: ReferenceCacheDoc) {
    this.dir = dir;
    this.doc = doc;
    this.#byKey = new Map(
      doc.entries.map((e) => [cacheKeyOf(e.fileKey, e.nodeId), e]),
    );
  }

  /** Open `dir`, or `undefined` when it holds no usable cache. */
  static async open(dir: string): Promise<ReferenceCache | undefined> {
    const doc = await readReferenceCacheDoc(dir);
    return doc ? new ReferenceCache(dir, doc) : undefined;
  }

  get entries(): readonly ReferenceCacheEntry[] {
    return this.doc.entries;
  }

  entry(fileKey: string, nodeId: string): ReferenceCacheEntry | undefined {
    return this.#byKey.get(cacheKeyOf(fileKey, nodeId));
  }

  file(fileKey: string): ReferenceCacheFile | undefined {
    return this.doc.files[fileKey];
  }

  /** Absolute path of a cache-relative path. */
  path(relative: string): string {
    return join(this.dir, relative);
  }

  /** The cached structure, or `undefined` when the entry or its blob is gone. */
  async node(fileKey: string, nodeId: string): Promise<CachedNodeDoc | undefined> {
    const key = cacheKeyOf(fileKey, nodeId);
    let pending = this.#nodes.get(key);
    if (!pending) {
      const entry = this.#byKey.get(key);
      pending = entry
        ? readFile(this.path(entry.node), "utf8")
            .then((raw) => JSON.parse(raw) as CachedNodeDoc)
            .catch(() => undefined)
        : Promise.resolve(undefined);
      this.#nodes.set(key, pending);
    }
    return pending;
  }

  /**
   * The file's variables. `{}` when absent — the same degradation the REST
   * client applies for a non-Enterprise file, so a cache built without them
   * behaves like a file that never had them.
   */
  async variables(fileKey: string): Promise<VariablesResponse> {
    let pending = this.#variables.get(fileKey);
    if (!pending) {
      const rel = this.doc.files[fileKey]?.variables;
      pending = rel
        ? readFile(this.path(rel), "utf8")
            .then((raw) => JSON.parse(raw) as VariablesResponse)
            .catch(() => ({}))
        : Promise.resolve({});
      this.#variables.set(fileKey, pending);
    }
    return pending;
  }
}

/**
 * A cache directory, opened for writing — the import's half of the contract.
 *
 * Refresh is IN PLACE by design. An entry this run could not re-read keeps the
 * blobs and the manifest row it already had, so "partial" costs nothing but
 * freshness: the branch always describes the whole catalog, and each row says
 * how old it is. That is the entire reason a rate-limited import converges
 * instead of thrashing.
 */
export class ReferenceCacheWriter {
  readonly dir: string;
  readonly #doc: ReferenceCacheDoc;

  /**
   * Renders this run replaced at a DIFFERENT path, to be removed once the index
   * that no longer names them is on disk.
   *
   * `put` writes `image.<format>`, so re-importing a node under a different
   * `--format` leaves the superseded file beside the live one. These directories
   * are committed, so that orphan is permanent: it inflates the repository, and
   * a reader opening the directory finds two renders with nothing saying which
   * one the index means (issue #441).
   *
   * Collected rather than deleted on the spot, because `put` only mutates the
   * in-memory manifest — `write` is what persists it. A run that dies between
   * the two leaves `index.json` still naming the OLD render, so deleting eagerly
   * would point the committed cache at a file that is gone. Deferring keeps the
   * failure mode "an orphan survives one more run", which is the one this is
   * about rather than a broken cache.
   */
  readonly #superseded = new Set<string>();

  constructor(dir: string, base?: ReferenceCacheDoc) {
    this.dir = dir;
    this.#doc = base
      ? {
          formatVersion: REFERENCE_CACHE_FORMAT_VERSION,
          files: { ...base.files },
          entries: [...base.entries],
        }
      : emptyReferenceCache();
  }

  /** Open `dir` for an in-place refresh of whatever it already holds. */
  static async open(dir: string): Promise<ReferenceCacheWriter> {
    return new ReferenceCacheWriter(dir, await readReferenceCacheDoc(dir));
  }

  get doc(): ReferenceCacheDoc {
    return this.#doc;
  }

  entry(fileKey: string, nodeId: string): ReferenceCacheEntry | undefined {
    return this.#doc.entries.find(
      (e) => e.fileKey === fileKey && e.nodeId === nodeId,
    );
  }

  file(fileKey: string): ReferenceCacheFile | undefined {
    return this.#doc.files[fileKey];
  }

  /** Record the file metadata an import observed. */
  setFile(fileKey: string, meta: Omit<ReferenceCacheFile, "variables">): void {
    const existing = this.#doc.files[fileKey];
    this.#doc.files[fileKey] = {
      ...meta,
      ...(existing?.variables ? { variables: existing.variables } : {}),
    };
  }

  async putVariables(fileKey: string, variables: VariablesResponse): Promise<void> {
    const rel = `${fileKey}/variables.json`;
    await this.#writeText(rel, JSON.stringify(variables, null, 2) + "\n");
    const file = this.#doc.files[fileKey];
    if (file) file.variables = rel;
  }

  /**
   * Write (or overwrite) one node. The image is optional so a structure fetch
   * that succeeded is not thrown away because the render did not — but note
   * that the *caller* decides whether a half-refreshed node is worth recording;
   * see the import, which keeps the old entry so the node retries next run.
   */
  async put(input: {
    fileKey: string;
    nodeId: string;
    fileVersion: string;
    fetchedAt: string;
    node: CachedNodeDoc;
    image?: {
      bytes: Uint8Array;
      format: "png" | "svg";
      contentsOnly?: boolean;
      placeholderFill?: string;
      scale?: number;
    };
    /** Mark a component set, which is cached without a render. */
    structureOnly?: boolean;
  }): Promise<ReferenceCacheEntry> {
    const dir = cacheEntryDir(input.fileKey, input.nodeId);
    const nodeRel = `${dir}/node.json`;
    await this.#writeText(nodeRel, JSON.stringify(input.node, null, 2) + "\n");

    const previous = this.entry(input.fileKey, input.nodeId);

    let imageRel: string | undefined;
    if (input.image) {
      imageRel = `${dir}/image.${input.image.format}`;
      await this.#writeBytes(imageRel, input.image.bytes);
      // Only when a render was actually written, and only at a different path.
      // A structure-only re-put keeps the entry's old render rather than
      // deleting one nothing has replaced, and a node put back to the format it
      // already had is not a supersession at all.
      if (previous?.image && previous.image !== imageRel) {
        this.#superseded.add(previous.image);
      }
      // Whatever this path used to be, it is live again.
      this.#superseded.delete(imageRel);
    }

    const entry: ReferenceCacheEntry = {
      fileKey: input.fileKey,
      nodeId: input.nodeId,
      fileVersion: input.fileVersion,
      fetchedAt: input.fetchedAt,
      node: nodeRel,
      ...(imageRel && input.image
        ? {
            image: imageRel,
            imageFormat: input.image.format,
            imageContentsOnly: input.image.contentsOnly ?? true,
            imagePlaceholderFill: input.image.placeholderFill ?? "checkerboard",
            ...(input.image.scale !== undefined ? { imageScale: input.image.scale } : {}),
          }
        : {}),
      ...(input.structureOnly ? { structureOnly: true } : {}),
    };
    const at = this.#doc.entries.findIndex(
      (e) => e.fileKey === input.fileKey && e.nodeId === input.nodeId,
    );
    if (at < 0) this.#doc.entries.push(entry);
    else this.#doc.entries[at] = entry;
    return entry;
  }

  /**
   * Drop entries the caller no longer wants cached, blobs included.
   *
   * Opt-in, and the caller must be sure `keep` is the WHOLE set it cares about:
   * pruning against a partial list deletes references the next full run then
   * has to re-import. Returns the keys removed.
   */
  async prune(keep: ReadonlySet<string>): Promise<string[]> {
    const dropped = this.#doc.entries.filter(
      (e) => !keep.has(cacheKeyOf(e.fileKey, e.nodeId)),
    );
    if (dropped.length === 0) return [];
    this.#doc.entries = this.#doc.entries.filter((e) =>
      keep.has(cacheKeyOf(e.fileKey, e.nodeId)),
    );
    for (const entry of dropped) {
      await rm(join(this.dir, cacheEntryDir(entry.fileKey, entry.nodeId)), {
        recursive: true,
        force: true,
      });
    }
    // A file with no entries left keeps nothing worth remembering.
    for (const fileKey of Object.keys(this.#doc.files)) {
      if (this.#doc.entries.some((e) => e.fileKey === fileKey)) continue;
      delete this.#doc.files[fileKey];
      await rm(join(this.dir, fileKey), { recursive: true, force: true });
    }
    return dropped.map((e) => cacheKeyOf(e.fileKey, e.nodeId));
  }

  /** Write `index.json`. Entries are sorted so the committed diff is stable. */
  async write(): Promise<ReferenceCacheDoc> {
    this.#doc.entries.sort(
      (a, b) =>
        a.fileKey.localeCompare(b.fileKey) || a.nodeId.localeCompare(b.nodeId),
    );
    const files: Record<string, ReferenceCacheFile> = {};
    for (const key of Object.keys(this.#doc.files).sort()) {
      files[key] = this.#doc.files[key] as ReferenceCacheFile;
    }
    this.#doc.files = files;
    await this.#writeText(
      REFERENCE_CACHE_INDEX,
      JSON.stringify(this.#doc, null, 2) + "\n",
    );
    await this.#removeSuperseded();
    return this.#doc;
  }

  /**
   * Delete the renders [#superseded] holds, now that the manifest naming their
   * replacements is on disk.
   *
   * This is the writer's only delete outside {@link prune}, and the paths come
   * from a previously-read `index.json` rather than from this process — a cache
   * directory is committed and therefore editable by anyone. So each one is
   * checked to be inside {@link dir} before it is removed, and skipped rather
   * than followed if it is not: `../../etc/something` in a manifest is a
   * corrupt cache, not an instruction. Anything an entry still names is left
   * alone as well, so a path reused by another node cannot be deleted out from
   * under it.
   *
   * Containment is checked against the REAL filesystem, not the path string.
   * `resolve` is purely lexical, so a cache containing a symlink `link` that
   * points anywhere would let a manifest naming `link/image.svg` pass a
   * `relative()` test and then have `rm` follow the link and delete outside the
   * cache. The same editability that makes a corrupt path plausible makes a
   * planted symlink plausible, and a committed directory is exactly where one
   * survives review as "a file". So the parent is resolved through its links
   * first, and a path whose final component is itself a link is skipped rather
   * than followed — the render this wants to delete is a file it wrote.
   */
  async #removeSuperseded(): Promise<void> {
    if (this.#superseded.size === 0) return;
    const live = new Set(
      this.#doc.entries.map((e) => e.image).filter((p): p is string => !!p),
    );
    const root = resolve(this.dir);
    // The cache dir itself may sit under a link (a macOS temp dir is the usual
    // way to meet this), so the boundary has to be the real one too or every
    // comparison below is against the wrong root.
    let realRoot: string;
    try {
      realRoot = await realpath(root);
    } catch {
      this.#superseded.clear();
      return;
    }
    for (const rel of this.#superseded) {
      if (live.has(rel)) continue;
      const abs = resolve(root, rel);
      const within = relative(root, abs);
      if (within === "" || within.startsWith("..") || isAbsolute(within)) {
        continue;
      }
      let target: string;
      try {
        // Resolve the parent rather than the path: the file is meant to exist,
        // but realpath on the path itself would also silently follow a final
        // symlink to its target and delete that instead of the link.
        const parent = await realpath(dirname(abs));
        const rp = relative(realRoot, parent);
        if (rp.startsWith("..") || isAbsolute(rp)) continue;
        target = join(parent, basename(abs));
        if ((await lstat(target)).isSymbolicLink()) continue;
      } catch {
        // Already gone, or a parent that does not resolve — either way there is
        // nothing here to delete, which is the state this wanted.
        continue;
      }
      // `force`, because the file may already be gone — a half-finished earlier
      // run, or a hand-tidied cache — and that is the state this wanted anyway.
      await rm(target, { force: true });
    }
    this.#superseded.clear();
  }

  async #writeText(relative: string, contents: string): Promise<void> {
    const abs = join(this.dir, relative);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, contents);
  }

  async #writeBytes(relative: string, bytes: Uint8Array): Promise<void> {
    const abs = join(this.dir, relative);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  }
}
