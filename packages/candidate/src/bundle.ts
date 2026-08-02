/**
 * Static reader for compose-ai-tools **portable preview bundles** (Phase 1 of
 * issue #38). Pure JS — no JVM, no live render.
 *
 * ## Bundle format (a PNG+zip polyglot)
 *
 * A bundle is a single file whose **leading bytes are a cover PNG** with the
 * **bundle zip appended** after it. A standard zip reader recovers the zip by
 * scanning the whole file for the End-Of-Central-Directory record, so
 * {@link unzipSync} over the entire byte range reads the entries directly — no
 * custom PNG-chunk parsing.
 *
 * Zip layout this reader consumes:
 * - `bundle.json` — `{ schemaVersion, previewIds, rawPreviewIds,
 *   coverPreviewId, classpath[] }`. `previewIds` are filename-safe bundle ids;
 *   when present, the parallel `rawPreviewIds` array carries the canonical ids
 *   emitted by discovery and used by `design-map.json`.
 * - `previews.json` — `{ schema, module, variant, previews: [{ id, functionName,
 *   className, sourceFile, params, captures[] }] }`. `id` = `<fqClass>.<function>
 *   [_<variant>]` and maps to `componentId`; `params` carries the `@Preview`
 *   annotation params (uiMode → theme, widthDp → size via {@link normalizeSize}).
 * - `previews/<id>.png` — the rendered image for a preview.
 * - `previews/<id>.semantics.json` — **the a11y/semantics blob** added per the
 *   #38 contract (a {@link SemanticTree}-shaped payload, theme-tagged). This is
 *   the location this reader chose and documents; see `docs/candidate-sources.md`.
 * - `previews/<id>.catalog.json` — **the resolved `@ColorCatalog` /
 *   `@TypographyCatalog` token values** for a `CATALOG` sheet (compose-ai-tools#2167):
 *   `{ tokens: [{ label, kind: "COLOR"|"TEXT_STYLE", color?, textStyle? }] }`.
 *   Read across the whole bundle by {@link catalogTokensFromBundle} into a system
 *   {@link DesignTokens} — an annotation-declared palette / type scale — for the
 *   catalog export's `themeTokens`, alongside the theme-derived tokens.
 *
 * Each preview becomes one {@link CandidateRender}: image as a
 * `data:image/png;base64,…` URI (bundle PNGs are not on disk, dims read from the
 * IHDR), `theme` from `params.uiMode`, `size` from `params.widthDp`, and
 * `semantics` mapped from the bundle's blob into the core {@link SemanticTree}.
 */
import { readFile } from "node:fs/promises";

import { unzipSync, type Unzipped } from "fflate";

import {
  normalizeSize,
  type CandidateRender,
  type DesignTokens,
  type Image,
  type SemanticTree,
  type Theme,
  type TypographyToken,
} from "@design-parity/core";

import {
  normalizeSemantics,
  themeForPreview,
  type PreviewParams,
  type RawSemantics,
} from "./cli.js";
import { argbToCssHex, normalizeFontFamily } from "./daemon.js";
import { InvalidBundleError } from "./errors.js";
import { readPngSize } from "./png.js";

// ---------------------------------------------------------------------------
// Zip entry shapes (the subset this reader depends on; parsed defensively).
// ---------------------------------------------------------------------------

/** `bundle.json` manifest. */
export interface BundleManifest {
  schemaVersion?: number;
  previewIds?: string[];
  /** Canonical discovery ids, positionally aligned with `previewIds`. */
  rawPreviewIds?: string[];
  coverPreviewId?: string;
  classpath?: string[];
}

/** One preview entry in `previews.json`. */
export interface PreviewEntry {
  id: string;
  functionName?: string;
  className?: string;
  sourceFile?: string;
  params?: PreviewParams;
  captures?: PreviewCapture[];
}

/**
 * A rendered capture of a preview (a preview × its render params). The static
 * bundle keys image + semantics by preview `id`; a capture may name its own
 * `image`/`semantics` paths to override the conventional `previews/<id>.*`.
 */
export interface PreviewCapture {
  /** Capture id, when a preview has more than one. */
  id?: string;
  /** Zip path of the rendered PNG; defaults to `previews/<id>.png`. */
  image?: string;
  /** Zip path of the semantics blob; defaults to `previews/<id>.semantics.json`. */
  semantics?: string;
  /** Per-capture params override (e.g. a second theme). */
  params?: PreviewParams;
}

/** `previews.json` envelope. */
export interface PreviewsFile {
  schema?: number;
  module?: string;
  variant?: string;
  previews?: PreviewEntry[];
}

/** A fully parsed bundle: the manifest, the preview list, and the raw zip. */
export interface PreviewBundle {
  manifest: BundleManifest;
  previews: PreviewEntry[];
  /** Module name from `previews.json`, when present. */
  module?: string;
  /** Build variant from `previews.json`, when present. */
  variant?: string;
  /** The unzipped entries, kept so callers can resolve image/semantics bytes. */
  entries: Unzipped;
}

// ---------------------------------------------------------------------------
// Reading.
// ---------------------------------------------------------------------------

const td = new TextDecoder();

function parseJson<T>(entries: Unzipped, name: string, required: boolean): T | undefined {
  const bytes = entries[name];
  if (!bytes) {
    if (required) throw new InvalidBundleError(`missing ${name} in the zip`);
    return undefined;
  }
  try {
    return JSON.parse(td.decode(bytes)) as T;
  } catch (cause) {
    throw new InvalidBundleError(`${name} is not valid JSON`, cause);
  }
}

// End-Of-Central-Directory record signature (`PK\x05\x06`).
const EOCD_SIG = 0x06054b50;
// Minimum EOCD size (no comment): 22 bytes.
const EOCD_MIN = 22;

/**
 * Locate the appended zip inside a PNG+zip polyglot and return just its bytes.
 *
 * The cover PNG up front shifts every zip offset by a constant prefix, which a
 * plain `unzipSync` over the whole file mis-reads (it would parse PNG bytes as a
 * local header). We scan backwards for the EOCD record, read the central-
 * directory size + offset it carries (both relative to the *zip* start), and
 * back-compute where the zip actually begins — then slice from there so the
 * remaining bytes are a self-consistent archive.
 *
 * If the bytes already start at the zip (no prefix), the computed start is 0 and
 * this is a no-op.
 */
function sliceAppendedZip(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.byteLength - EOCD_MIN; i >= 0; i--) {
    if (view.getUint32(i, true) !== EOCD_SIG) continue;
    const cdSize = view.getUint32(i + 12, true);
    const cdOffset = view.getUint32(i + 16, true);
    // `i` is the EOCD position; the central directory ends where it begins, so
    // the zip starts `cdSize + cdOffset` bytes before the EOCD.
    const start = i - cdSize - cdOffset;
    if (start >= 0 && start <= bytes.byteLength) {
      return start === 0 ? bytes : bytes.subarray(start);
    }
  }
  throw new InvalidBundleError(
    "the file has no readable zip appended (no End-Of-Central-Directory record)",
  );
}

/**
 * Parse a preview-bundle polyglot's bytes into a {@link PreviewBundle}.
 *
 * @throws InvalidBundleError if the bytes are not a readable zip or are missing
 *   `previews.json`.
 */
export function parsePreviewBundle(bytes: Uint8Array): PreviewBundle {
  const zipBytes = sliceAppendedZip(bytes);
  let entries: Unzipped;
  try {
    entries = unzipSync(zipBytes);
  } catch (cause) {
    throw new InvalidBundleError(
      "the appended zip could not be read",
      cause,
    );
  }

  const previewsFile = parseJson<PreviewsFile>(entries, "previews.json", true)!;
  if (!Array.isArray(previewsFile.previews)) {
    throw new InvalidBundleError("previews.json has no `previews` array");
  }
  const manifest = parseJson<BundleManifest>(entries, "bundle.json", false) ?? {};

  const bundle: PreviewBundle = {
    manifest,
    previews: previewsFile.previews,
    entries,
  };
  if (previewsFile.module !== undefined) bundle.module = previewsFile.module;
  if (previewsFile.variant !== undefined) bundle.variant = previewsFile.variant;
  return bundle;
}

/**
 * Read a preview bundle from raw bytes or a filesystem path.
 *
 * @throws InvalidBundleError on a non-bundle input.
 */
export async function readPreviewBundle(
  input: Uint8Array | string,
): Promise<PreviewBundle> {
  const bytes =
    typeof input === "string" ? new Uint8Array(await readFile(input)) : input;
  return parsePreviewBundle(bytes);
}

// ---------------------------------------------------------------------------
// Preview → CandidateRender.
// ---------------------------------------------------------------------------

function toDataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function imagePathFor(id: string, capture: PreviewCapture): string {
  return capture.image ?? `previews/${id}.png`;
}

function semanticsPathFor(id: string, capture: PreviewCapture): string {
  return capture.semantics ?? `previews/${id}.semantics.json`;
}

/**
 * Merge an entry's params with a capture's override (capture wins). Both are
 * optional in the format.
 */
function paramsFor(
  entry: PreviewEntry,
  capture: PreviewCapture,
): PreviewParams {
  return { ...(entry.params ?? {}), ...(capture.params ?? {}) };
}

function toImage(
  bytes: Uint8Array,
  params: PreviewParams,
  state: string,
  id?: string,
): Image {
  const { width, height } = readPngSize(bytes);
  const image: Image = { state, uri: toDataUri(bytes), width, height };
  const theme = themeForPreview(params, id);
  if (theme) image.theme = theme;
  const size = normalizeSize(params.widthDp);
  if (size) image.size = size;
  return image;
}

/**
 * A bundle preview reconciled to its code handle, optionally carrying the
 * variant slot a `design-map` `previewId` list tagged it with (issue #111).
 * When `variant` is present, {@link previewToCandidate} re-tags the preview's
 * image(s) onto that slot — the candidate-side mirror of how the reference
 * resolver re-tags themed frames — so a per-theme `@Preview` keys against its
 * matching reference variant.
 */
export interface ResolvedComponentId {
  /** The code handle, e.g. `"ui/Foo.kt#Bar"`. */
  code: string;
  /** Variant slot to re-tag the preview's images onto, when tagged. */
  variant?: { state?: string; theme?: Theme; size?: string };
}

/**
 * Reconcile a bundle preview to the code handle the orchestrator pairs on
 * (issue #44). Given the preview's identifying bits, return its code handle
 * (`path#Member`) — as a bare string, or a {@link ResolvedComponentId} when the
 * link also tags a variant slot (issue #111) — or `undefined` to leave the
 * candidate keyed by its raw preview id. Kept structural so this package depends
 * only on `@design-parity/core` — the action wires `@design-parity/resolver` in.
 */
export type ComponentIdResolver = (preview: {
  id: string;
  sourceFile?: string;
  functionName?: string;
  className?: string;
}) => string | ResolvedComponentId | undefined;

/**
 * Return the canonical discovery id for a sanitized bundle preview entry.
 *
 * compose-preview stores images and `previews.json` entries under filename-safe
 * ids, while schema 8+ manifests retain the original ids in a parallel array.
 * External correspondence (notably `design-map.json`) is authored against the
 * original id, so only ZIP lookup should use {@link PreviewEntry.id}.
 *
 * Older bundles and malformed/misaligned arrays degrade to the entry id.
 */
export function rawPreviewIdForEntry(
  bundle: PreviewBundle,
  entry: PreviewEntry,
): string {
  const previewIds = bundle.manifest.previewIds;
  const rawPreviewIds = bundle.manifest.rawPreviewIds;
  if (!previewIds || !rawPreviewIds) return entry.id;
  const index = previewIds.indexOf(entry.id);
  if (index < 0) return entry.id;
  const raw = rawPreviewIds[index];
  return typeof raw === "string" && raw.length > 0 ? raw : entry.id;
}

/**
 * Build the {@link CandidateRender} for one preview. A preview with no explicit
 * `captures[]` is treated as a single default capture keyed on its `id`.
 *
 * When `resolveComponentId` maps the preview to a code handle, that becomes the
 * render's `componentId` (so it pairs with a {@link DesignReference}) and the
 * raw preview id is preserved on `previewId`; otherwise the preview id stays the
 * `componentId` (today's behaviour, and the pair simply won't match a
 * code-handle reference).
 */
export function previewToCandidate(
  bundle: PreviewBundle,
  entry: PreviewEntry,
  resolveComponentId?: ComponentIdResolver,
): CandidateRender {
  if (!entry.id) {
    throw new InvalidBundleError("a previews.json entry is missing its `id`");
  }
  const captures =
    entry.captures && entry.captures.length > 0
      ? entry.captures
      : [{} as PreviewCapture];

  const images: Image[] = [];
  let semantics: SemanticTree | undefined;
  let lightSemantics: SemanticTree | undefined;

  for (const capture of captures) {
    const params = paramsFor(entry, capture);
    const state = params.state ?? "default";

    const imgPath = imagePathFor(entry.id, capture);
    const imgBytes = bundle.entries[imgPath];
    if (!imgBytes) {
      throw new InvalidBundleError(
        `preview '${entry.id}' references image '${imgPath}' which is not in the zip`,
      );
    }
    images.push(toImage(imgBytes, params, state, entry.id));

    // Semantics blob (the #38 contract). Optional per capture; a bundle that
    // omits it degrades to visual/structural-only, matching graceful checks.
    const semPath = semanticsPathFor(entry.id, capture);
    const semBytes = bundle.entries[semPath];
    if (semBytes) {
      let raw: RawSemantics;
      try {
        raw = JSON.parse(td.decode(semBytes)) as RawSemantics;
      } catch (cause) {
        throw new InvalidBundleError(`${semPath} is not valid JSON`, cause);
      }
      const tree = normalizeSemantics(raw, themeForPreview(params, entry.id));
      if (tree) {
        semantics ??= tree;
        if (tree.theme === "light") lightSemantics ??= tree;
      }
    }
  }

  const rawPreviewId = rawPreviewIdForEntry(bundle, entry);
  const resolved = resolveComponentId?.({
    id: rawPreviewId,
    ...(entry.sourceFile !== undefined ? { sourceFile: entry.sourceFile } : {}),
    ...(entry.functionName !== undefined
      ? { functionName: entry.functionName }
      : {}),
    ...(entry.className !== undefined ? { className: entry.className } : {}),
  });
  const code = typeof resolved === "string" ? resolved : resolved?.code;
  const variant = typeof resolved === "string" ? undefined : resolved?.variant;

  // A `design-map` previewId variant re-tags this preview's image(s) onto its
  // declared slot (issue #111) — the candidate mirror of the reference
  // resolver's `applyVariant`. The single-preview-per-theme case carries the
  // theme tag here even when the preview params couldn't imply it.
  const tagged = variant ? images.map((img) => applyVariantTag(img, variant)) : images;

  const candidate: CandidateRender = {
    componentId: code ?? entry.id,
    images: tagged,
    // Prefer the light capture's tree (the diff engine keys tokens off one),
    // else the first available, else an empty tree.
    semantics: lightSemantics ?? semantics ?? { root: {} },
  };
  // When a resolver ran, keep the raw preview id reconcilable alongside the
  // code-handle componentId (issue #44).
  if (resolveComponentId) candidate.previewId = rawPreviewId;
  // Carry the function name so catalog assembly can fold a function's
  // theme/size multipreview variants (whose ids differ only by an appended
  // `_<mode>`) into one component, independent of any resolver.
  if (entry.functionName !== undefined) candidate.functionName = entry.functionName;
  return candidate;
}

/** Re-tag an image with the variant slot a previewId link assigned, if any. */
function applyVariantTag(
  image: Image,
  variant: { state?: string; theme?: Theme; size?: string },
): Image {
  const out: Image = { ...image };
  if (variant.state !== undefined) out.state = variant.state;
  if (variant.theme !== undefined) out.theme = variant.theme;
  if (variant.size !== undefined) out.size = variant.size;
  return out;
}

/**
 * Merge two candidate renders that resolved to the **same** code handle — a
 * component whose themes/states are authored as separate `@Preview`s and bound
 * by a `design-map` previewId variant list (issue #111). Their images are
 * concatenated (each already re-tagged onto its variant slot), so the report's
 * theme matrix fills every column for one component. The merged semantics prefer
 * a light-themed tree (the diff keys tokens off one), then `a`'s; `previewId`
 * keeps `a`'s, which still pairs the merged render back to a source preview.
 */
export function mergeCandidateRenders(
  a: CandidateRender,
  b: CandidateRender,
): CandidateRender {
  const semantics =
    a.semantics.theme === "light"
      ? a.semantics
      : b.semantics.theme === "light"
        ? b.semantics
        : a.semantics;
  const merged: CandidateRender = {
    componentId: a.componentId,
    images: [...a.images, ...b.images],
    semantics,
  };
  const previewId = a.previewId ?? b.previewId;
  if (previewId !== undefined) merged.previewId = previewId;
  const functionName = a.functionName ?? b.functionName;
  if (functionName !== undefined) merged.functionName = functionName;
  return merged;
}

/** Map every preview in a bundle to a {@link CandidateRender}. */
export function bundleToCandidates(
  bundle: PreviewBundle,
  resolveComponentId?: ComponentIdResolver,
): CandidateRender[] {
  return bundle.previews.map((entry) =>
    previewToCandidate(bundle, entry, resolveComponentId),
  );
}

/**
 * Convenience: read a bundle (bytes or path) and return one
 * {@link CandidateRender} per preview.
 */
export async function loadPreviewBundle(
  input: Uint8Array | string,
  resolveComponentId?: ComponentIdResolver,
): Promise<CandidateRender[]> {
  return bundleToCandidates(await readPreviewBundle(input), resolveComponentId);
}

// ---------------------------------------------------------------------------
// Catalog-token sidecars → system DesignTokens (compose-ai-tools#2167).
// ---------------------------------------------------------------------------

/** One resolved token in a `previews/<id>.catalog.json` sidecar. */
interface CatalogTokenEntry {
  /** The design-token name (`"BrandCoral"`, `"DisplayLarge"`, `"Body Large"`). */
  label?: string;
  kind?: "COLOR" | "TEXT_STYLE";
  /** For `COLOR`: the reflected value. `hex` is `#AARRGGBB`. */
  color?: { hex?: string; argb?: number };
  /** For `TEXT_STYLE`: the reflected `TextStyle` metrics (sp magnitudes). */
  textStyle?: {
    fontSizeSp?: number;
    fontWeight?: number;
    fontStyle?: string;
    letterSpacingSp?: number;
    lineHeightSp?: number;
    fontFamily?: string;
  };
}

/** The `compose-preview-catalog-tokens` sidecar payload. */
interface CatalogTokenSidecar {
  schema?: string;
  previewId?: string;
  tokens?: CatalogTokenEntry[];
}

function toTypographyToken(
  ts: NonNullable<CatalogTokenEntry["textStyle"]>,
): TypographyToken {
  const out: TypographyToken = {};
  if (ts.fontFamily) out.fontFamily = normalizeFontFamily(ts.fontFamily);
  if (ts.fontSizeSp !== undefined) out.fontSize = ts.fontSizeSp;
  if (ts.fontWeight !== undefined) out.fontWeight = ts.fontWeight;
  if (ts.fontStyle) out.fontStyle = ts.fontStyle;
  if (ts.letterSpacingSp !== undefined) out.letterSpacing = ts.letterSpacingSp;
  if (ts.lineHeightSp !== undefined) out.lineHeight = ts.lineHeightSp;
  return out;
}

/**
 * Aggregate every `previews/<id>.catalog.json` sidecar in [bundle] into a system
 * {@link DesignTokens} — the resolved `@ColorCatalog` colours (as CSS hex, keyed
 * by token name) and `@TypographyCatalog` type styles (compose-ai-tools#2167).
 * This is how an annotation-declared palette or type scale — which carries no
 * `MaterialTheme` and so never shows up in the `compose/theme` `themeTokens` a
 * screen render exposes — becomes importable data: pass the result as (or merge
 * it into) `catalogFromCandidates`' `opts.themeTokens` so it lands in the
 * catalog's exported token set.
 *
 * Colours reuse {@link argbToCssHex} so they match the daemon/theme colour format
 * exactly. Best-effort and pure: a malformed sidecar is skipped, not fatal.
 * Returns `undefined` when the bundle carries no catalog tokens (the common case
 * for a bundle of ordinary component previews).
 */
export function catalogTokensFromBundle(
  bundle: PreviewBundle,
): DesignTokens | undefined {
  const colors: Record<string, string> = {};
  const typography: Record<string, TypographyToken> = {};

  for (const [path, bytes] of Object.entries(bundle.entries)) {
    if (!path.startsWith("previews/") || !path.endsWith(".catalog.json")) {
      continue;
    }
    let payload: CatalogTokenSidecar;
    try {
      payload = JSON.parse(td.decode(bytes)) as CatalogTokenSidecar;
    } catch {
      continue; // best-effort: a malformed sidecar doesn't sink the read
    }
    for (const token of payload.tokens ?? []) {
      if (!token.label) continue;
      if (token.kind === "COLOR") {
        const css = argbToCssHex(token.color?.hex);
        if (css) colors[token.label] = css;
      } else if (token.kind === "TEXT_STYLE" && token.textStyle) {
        typography[token.label] = toTypographyToken(token.textStyle);
      }
    }
  }

  const out: DesignTokens = {};
  if (Object.keys(colors).length > 0) out.colors = colors;
  if (Object.keys(typography).length > 0) out.typography = typography;
  return out.colors || out.typography ? out : undefined;
}
