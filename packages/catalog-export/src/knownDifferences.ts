/**
 * Carry a source repo's committed **known differences** into the published catalog.
 *
 * `compose-preview-known-differences/v1` is a parity acceptance: a mask, an accepted-candidate crop,
 * three hashes and the locator scope they apply to. A source repo commits them beside its
 * `design-map.json`:
 *
 * ```
 * .design-parity/
 *   known-differences.json
 *   known-differences/<id>/mask.png
 *   known-differences/<id>/accepted-candidate.png
 * ```
 *
 * and this module puts them where a serving host reads them, under the same `parity/` prefix the
 * issue index already uses:
 *
 * ```
 * parity/known-differences.json
 * parity/known-differences/<id>/…
 * ```
 *
 * The contract is `COMPONENT_PARITY_WORKFLOW.md` §4 in `yschimke/compose-ai-tools`. **Nothing here
 * implements it**, and that is deliberate rather than lazy: the document's verdicts belong to the
 * engines — `design-parity`'s own offline run and the preview server's browser scorer — and a
 * publisher that parsed on the way through would be a third opinion about the same rules with no
 * conformance suite behind it. A malformed document, a duplicated id, an unreadable mask: every one
 * of those is an answer a *consumer* must be able to reach, and it can only reach it if the bytes
 * arrive intact. So this copies, and refuses only what a copier can legitimately refuse.
 *
 * ## Three things it does refuse
 *
 * - **A path outside the acceptance's own directory.** The document names its artifacts, the
 *   document is repository content, and a `../` in one of those names would make this function a
 *   file-exfiltration primitive pointed at whatever the export runs against. Refused *lexically*,
 *   before any read, and refused as a **skip with a warning** rather than a thrown error — a
 *   catalog is still publishable with a broken acceptance in it, and the consumer will report that
 *   record as `artifact-unreadable` on its own.
 * - **A symlink, anywhere**: the document, the artifact root, or any file inside it. A link's
 *   *target* is what a consumer reads, so following one either dangles or copies an arbitrary
 *   readable file from the export runner into a published catalog. Every one of the three is
 *   `lstat`ed rather than `stat`ed, because the two that are not walked as directory entries — the
 *   document and the root — are exactly the ones a `Dirent` check never sees.
 * - **An artifact past the schema's 8 MiB ceiling**, from its length, before the bytes are read.
 *   Publishing it would produce a bundle whose consumers refuse a record the publisher accepted.
 *
 * ## And it clears before it writes
 *
 * `outDir` is reused across renders, so every path out of {@link writeKnownDifferences} — including
 * the early ones — has to leave the bundle describing the repository's *current* state. A repo that
 * deleted an acceptance would otherwise keep publishing the last good copy, and the bundle would go
 * on suppressing a difference nobody accepts any more.
 *
 * ## Publishing this way means acceptances land on the next render
 *
 * Stated rather than left to be discovered. The issue index gets a separate one-file committer
 * precisely so relabelling an issue does not wait 8–29 minutes for a render; acceptances go through
 * `catalog-export`, which is on the render path, so an edited acceptance reaches serving hosts when
 * the catalog is next rendered.
 *
 * That is the deliberate choice of the two the design leaves open, for two reasons. The render
 * publisher's tree is authoritative for the whole bundle **except** the issue index, whose publisher
 * owns only that one path — an asymmetry that exists because the two writers race and `push-branch.sh`
 * resolves a race by re-parenting one tree wholesale. Adding a second exception would need a second
 * carry-forward rule, and this one would have to carry *binary* artifacts rather than a single JSON
 * file. And the granularity genuinely differs: relabelling an issue is a click, while authoring an
 * acceptance means producing a mask and a crop and recording three hashes — a deliberate act whose
 * turnaround is already measured in review rounds, not minutes.
 */
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Where a source repo commits them, and where they are published. */
export const SOURCE_DIRECTORY = ".design-parity";
export const DOCUMENT_FILE = "known-differences.json";
export const ARTIFACT_DIRECTORY = "known-differences";
export const PUBLISHED_DIRECTORY = "parity";

/**
 * The two ceilings, versioned with the schema.
 *
 * Restated from the contract because this package cannot import it, and checked here so a bundle is
 * never published whose consumers refuse a record this publisher accepted. Both are inclusive: a
 * document of exactly 1 MiB and an artifact of exactly 8 MiB are legal.
 */
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

/** §4's portable path grammar: one segment, and three shapes a checkout cannot express. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,255}$/;
const RESERVED_SEGMENTS = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

function isPortableSegment(segment: string): boolean {
  if (!SAFE_SEGMENT.test(segment)) return false;
  if (segment === "." || segment === "..") return false;
  if (segment.endsWith(".") || segment.endsWith(" ")) return false;
  return !RESERVED_SEGMENTS.has(segment.split(".")[0]!.toLowerCase());
}

export interface KnownDifferencesResult {
  /** Absolute path to the published document, when the source repo committed one. */
  documentPath?: string;
  /** How many artifact files were carried across. */
  artifactCount: number;
  /**
   * Paths the publisher declined to carry, each with why.
   *
   * Surfaced rather than thrown: a catalog with one broken acceptance is still a catalog worth
   * publishing, and the consumer reports that record's own verdict. A silent skip is the one thing
   * this must not do — a mask that quietly failed to publish is an acceptance that suppresses
   * nothing, with nothing anywhere saying so.
   */
  skipped: Array<{
    path: string;
    reason: "path-not-portable" | "artifact-too-large" | "symlink";
  }>;
}

export interface KnownDifferencesOptions {
  /**
   * Root the source repo's `.design-parity/` sits in. Default: `process.cwd()`.
   *
   * The **repository** root, and emphatically *not* `writeCatalog`'s `sourceRoot`, which is the
   * directory a bundle's relative image URIs resolve against — the render output. An acceptance is
   * committed by the repository whose component the difference is in, which is where its issue and
   * its review live, and renders are routinely unpacked somewhere else entirely (a temp dir, an
   * unzipped artifact). Wiring these two together looks harmless and publishes nothing at all,
   * silently, because `<renders>/.design-parity/` never exists.
   */
  repositoryRoot?: string;
}

/**
 * Copy the committed known differences into `outDir`, verbatim.
 *
 * Returns an empty result when the source repo commits none, which is every repo until it accepts
 * something. Absence is not an error and does not warn: there is nothing to say about a catalog that
 * has no known differences.
 */
export async function writeKnownDifferences(
  outDir: string,
  opts: KnownDifferencesOptions = {},
): Promise<KnownDifferencesResult> {
  const repositoryRoot = opts.repositoryRoot ?? process.cwd();
  const source = resolve(repositoryRoot, SOURCE_DIRECTORY);
  const documentSource = join(source, DOCUMENT_FILE);
  const out = resolve(outDir);
  const documentPath = join(out, PUBLISHED_DIRECTORY, DOCUMENT_FILE);
  const destinationRoot = join(out, PUBLISHED_DIRECTORY, ARTIFACT_DIRECTORY);
  const result: KnownDifferencesResult = { artifactCount: 0, skipped: [] };

  // **Clear before writing**, and before any early return. `outDir` is routinely reused across
  // renders, and every path out of this function has to leave the bundle describing the repository's
  // *current* state: a repo that deleted an acceptance, or one whose document has grown past the
  // ceiling, would otherwise keep publishing the last good copy — a bundle that goes on suppressing
  // a difference nobody accepts any more, which is the same silent-suppression failure the whole
  // contract exists to prevent, arriving through the publisher instead of the record.
  //
  // Scoped to exactly the two paths this module owns. Nothing else under `outDir` is touched.
  await clearPublishedKnownDifferences(out);

  // **The parent first.** Guarding the document and the artifact root is not enough while their
  // common parent can be a link: `lstat` on a path *beneath* a symlinked `.design-parity` resolves
  // the link on the way down and inspects the target's child, so both guards below would pass on a
  // tree that lives entirely outside the checkout. A no-follow check has to start at the first
  // component this module adds to the caller's root — every component above it is the caller's own
  // choice of where to look, and every component below is either checked here or reached through a
  // `Dirent`, which reports link-or-not without following.
  const sourceStat = await lstat(source).catch(() => null);
  if (!sourceStat) return result;
  if (sourceStat.isSymbolicLink()) {
    result.skipped.push({ path: SOURCE_DIRECTORY, reason: "symlink" });
    return result;
  }
  if (!sourceStat.isDirectory()) return result;

  // `lstat`, not `stat`. A committed symlink at `known-differences.json` would otherwise be followed
  // and its *target's* bytes copied into the published catalog — an arbitrary readable file from the
  // export runner, published to the world. The artifact walk refuses symlinks for exactly this
  // reason and the document had been left out of that rule.
  const documentStat = await lstat(documentSource).catch(() => null);
  if (!documentStat) return result;
  if (documentStat.isSymbolicLink()) {
    result.skipped.push({ path: DOCUMENT_FILE, reason: "symlink" });
    return result;
  }
  if (!documentStat.isFile()) return result;
  if (documentStat.size > MAX_DOCUMENT_BYTES) {
    result.skipped.push({ path: DOCUMENT_FILE, reason: "artifact-too-large" });
    return result;
  }

  // Copied as **bytes**, not parsed and re-serialised. A re-serialisation is a rewrite: it would
  // reorder members, normalise numbers and drop a duplicated key — and a duplicated key is one of
  // the document-level refusals the contract spends a paragraph on, precisely because runtimes
  // disagree about which value wins.
  await mkdir(dirname(documentPath), { recursive: true });
  await writeFile(documentPath, await readFile(documentSource));
  result.documentPath = documentPath;

  // The artifact tree, walked from disk rather than read out of the document. Two reasons: the
  // document is not parsed here at all, and a record may legitimately name a file it also ships
  // siblings of — the consumer decides which ones matter, and a publisher that shipped only the
  // named ones would make an unnamed-but-referenced file a publish-time failure instead of a
  // consumer-time verdict.
  //
  // The **root** is `lstat`ed before the walk for the same reason the document is: `readdir` follows
  // a symlinked directory, and the per-entry `Dirent` check below only ever sees what is already
  // inside. A linked root would hand the walk someone else's tree wholesale.
  const artifactRoot = join(source, ARTIFACT_DIRECTORY);
  const rootStat = await lstat(artifactRoot).catch(() => null);
  if (!rootStat) return result;
  if (rootStat.isSymbolicLink()) {
    result.skipped.push({ path: ARTIFACT_DIRECTORY, reason: "symlink" });
    return result;
  }
  if (!rootStat.isDirectory()) return result;
  await copyTree(artifactRoot, destinationRoot, [], result);
  return result;
}

async function copyTree(
  sourceDir: string,
  destinationDir: string,
  prefix: string[],
  result: KnownDifferencesResult,
): Promise<void> {
  const entries = await readdir(sourceDir, { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  // Sorted, so a bundle written twice from one tree is byte-identical in its ordering-sensitive
  // outputs and a reviewer diffing two publishes sees only what changed.
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = [...prefix, entry.name];
    const printable = relative.join("/");
    if (!isPortableSegment(entry.name)) {
      result.skipped.push({ path: printable, reason: "path-not-portable" });
      continue;
    }
    const from = join(sourceDir, entry.name);
    const to = join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to, relative, result);
      continue;
    }
    // Symlinks are neither followed nor copied. A `Dirent` reports link-or-not from `lstat`
    // semantics, so a symlink is neither `isFile()` nor `isDirectory()` and falls through both
    // branches — which is the right answer: a link's *target* is what a consumer would read, and
    // publishing the link would either dangle or smuggle bytes from outside the tree into a record
    // that does not own them. Reported rather than dropped, so a repo that committed one can see
    // why its acceptance publishes nothing.
    if (entry.isSymbolicLink()) {
      result.skipped.push({ path: printable, reason: "symlink" });
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await lstat(from).catch(() => null);
    if (!info) continue;
    if (info.size > MAX_ARTIFACT_BYTES) {
      result.skipped.push({ path: printable, reason: "artifact-too-large" });
      continue;
    }
    await mkdir(dirname(to), { recursive: true });
    await writeFile(to, await readFile(from));
    result.artifactCount += 1;
  }
}

/**
 * Remove the two published paths this module owns, and nothing else under `outDir`.
 *
 * Exported because {@link writeKnownDifferences} is not the only path that must leave the bundle
 * describing the repository's current state: a caller that *disables* the copy on a reused output
 * directory has to clear it too, or the previous publish's acceptances stay in the new bundle and go
 * on suppressing differences the caller just said not to carry. Skipping the copy is not the same as
 * skipping the cleanup, and the difference is only visible on the second render.
 */
export async function clearPublishedKnownDifferences(outDir: string): Promise<void> {
  const out = resolve(outDir);
  await rm(join(out, PUBLISHED_DIRECTORY, DOCUMENT_FILE), { force: true });
  await rm(join(out, PUBLISHED_DIRECTORY, ARTIFACT_DIRECTORY), { recursive: true, force: true });
}

/**
 * The published path an artifact lands at, for a caller that needs to name one.
 *
 * Held to the **same portable grammar the copier is**, not merely to "is it absolute". A caller
 * passing an untrusted `../../catalog.json` would otherwise get back a string that reads as being
 * inside the artifact directory and resolves outside it the moment a URL or a filesystem normalises
 * it — a traversal minted by the helper that exists to name safe paths.
 */
export function publishedArtifactPath(relative: string): string {
  const segments = relative.split("/");
  if (isAbsolute(relative) || segments.length < 1 || !segments.every(isPortableSegment)) {
    throw new Error(`known-difference artifact path is not portable: ${relative}`);
  }
  return `${PUBLISHED_DIRECTORY}/${ARTIFACT_DIRECTORY}/${segments.join("/")}`;
}
