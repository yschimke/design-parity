/**
 * The four candidate-source backends behind the {@link CandidateSource} seam.
 *
 * 1. {@link bundleCandidateSource} — static, pure-JS reader of compose-ai-tools
 *    preview bundles (Phase 1 of #38; fully implemented).
 * 2. {@link cliRenderSource} — wraps the existing {@link renderCandidate} (the
 *    `compose-preview` CLI).
 * 3. {@link localComposeWebSource} — in-process Compose-for-Web / wasm render
 *    (stub).
 * 4. {@link daemonSource} — the compose-preview daemon/session API (stub).
 *
 * See `docs/candidate-sources.md` for when each applies.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type { AdapterContext, CandidateRender } from "@design-parity/core";

import {
  renderCandidate,
  type RenderCandidateOptions,
} from "./candidate.js";
import {
  bundleToCandidates,
  parsePreviewBundle,
  type ComponentIdResolver,
  type PreviewBundle,
} from "./bundle.js";
import {
  applyRenderPath,
  chooseRenderPath,
  type RenderPathCapability,
} from "./render-path.js";
import { InvalidBundleError, NotImplementedError } from "./errors.js";
import type { CandidateSource } from "./source.js";

// ---------------------------------------------------------------------------
// 1. Static preview-bundle source (Phase 1) — fully implemented.
// ---------------------------------------------------------------------------

/** How to find preview-bundle polyglots and read their bytes. */
export interface BundleSourceOptions {
  /**
   * Bundle polyglot paths (each a PNG+zip). Relative paths resolve against the
   * {@link AdapterContext.repoRoot} at lookup time. Either this or
   * {@link BundleSourceOptions.bundles} must be provided.
   */
  paths?: string[];
  /** Pre-loaded bundles (e.g. already in memory); merged with `paths`. */
  bundles?: PreviewBundle[];
  /** Byte reader; defaults to `node:fs`. Injectable for tests. */
  readFile?: (path: string) => Promise<Uint8Array>;
  /**
   * Reconcile each preview to its code handle so bundle candidates key on the
   * same id the orchestrator pairs references by (issue #44). When omitted,
   * candidates stay keyed by their raw preview id.
   */
  resolveComponentId?: ComponentIdResolver;
}

/**
 * A {@link CandidateSource} over one or more compose-ai-tools preview bundles.
 *
 * Reads each bundle once (lazily, on first lookup), indexes every preview by
 * its `componentId`, and serves the matching {@link CandidateRender}. Returns
 * `undefined` when no bundle carries the requested component — letting
 * {@link firstAvailable} fall through to a live renderer.
 *
 * @throws InvalidBundleError if a configured path is not a readable bundle.
 */
export function bundleCandidateSource(
  options: BundleSourceOptions,
): CandidateSource {
  const read = options.readFile ?? ((p: string) => readFile(p).then((b) => new Uint8Array(b)));
  const paths = options.paths ?? [];
  const preloaded = options.bundles ?? [];
  if (paths.length === 0 && preloaded.length === 0) {
    throw new InvalidBundleError(
      "no bundle paths or pre-loaded bundles were provided",
    );
  }

  // Lazy, memoized index: componentId → CandidateRender (last bundle wins).
  let index: Map<string, CandidateRender> | undefined;

  async function build(ctx: AdapterContext): Promise<Map<string, CandidateRender>> {
    if (index) return index;
    const map = new Map<string, CandidateRender>();
    const ingest = (candidates: CandidateRender[]) => {
      for (const c of candidates) map.set(c.componentId, c);
    };
    const toCandidates = (bundle: PreviewBundle) =>
      bundleToCandidates(bundle, options.resolveComponentId);
    for (const bundle of preloaded) ingest(toCandidates(bundle));
    for (const p of paths) {
      const abs = isAbsolute(p) ? p : resolve(ctx.repoRoot, p);
      const bytes = await read(abs);
      ingest(toCandidates(parsePreviewBundle(bytes)));
    }
    index = map;
    return map;
  }

  return {
    kind: "bundle",
    async getCandidate(componentId, ctx) {
      const map = await build(ctx);
      return map.get(componentId);
    },
  };
}

// ---------------------------------------------------------------------------
// 2. CLI render source — wraps the existing renderer.
// ---------------------------------------------------------------------------

/**
 * Per-component render options, minus `componentId` (the source supplies it
 * from the lookup) and `repoRoot` (taken from the {@link AdapterContext}).
 */
export type CliRenderOptions = Omit<
  RenderCandidateOptions,
  "componentId" | "repoRoot"
>;

/** Tuning for {@link cliRenderSource} beyond the per-component request. */
export interface CliRenderSourceOptions {
  /**
   * The committed CMP-capability verdict (Principle 6). When provided, the
   * source **prefers the Desktop/JVM render path** for a CMP-capable module —
   * faster, emulator-free — and renders on Android **unchanged** otherwise (see
   * {@link chooseRenderPath}). Read this from `.design-parity.json`'s committed
   * `cmpCapable` flag at run time (no re-scan, Principle 1). When omitted, the
   * source behaves exactly as before (the Android path, requests untouched).
   */
  capability?: RenderPathCapability;
}

/**
 * Adapt the existing {@link renderCandidate} (the `compose-preview` CLI) to the
 * {@link CandidateSource} seam without changing its API. `optionsFor` maps a
 * `componentId` to the render request (which module/filter/id to render);
 * return `undefined` to decline a component (e.g. it is not a Compose preview).
 *
 * When a {@link CliRenderSourceOptions.capability} is supplied, the source
 * **prefers the cheaper Compose Multiplatform Desktop/JVM render** for a
 * CMP-capable module (no Android emulator; Principle 6) and falls back to the
 * Android path unchanged otherwise. The choice is reflected in the source
 * {@link CandidateSource.kind} (`"cli-desktop"` / `"cli-android"`) for an
 * auditable "which renderer ran" trail; with no capability the `kind` stays
 * `"cli"` and requests are untouched.
 */
export function cliRenderSource(
  optionsFor: (
    componentId: string,
    ctx: AdapterContext,
  ) => CliRenderOptions | undefined,
  options: CliRenderSourceOptions = {},
): CandidateSource {
  const choice = options.capability
    ? chooseRenderPath(options.capability)
    : undefined;
  const kind = choice ? `cli-${choice.path}` : "cli";
  return {
    kind,
    async getCandidate(componentId, ctx) {
      const opts = optionsFor(componentId, ctx);
      if (!opts) return undefined;
      // Prefer the chosen render path (Desktop/JVM when CMP-capable), shaping the
      // request for it; an Android-only module renders unchanged.
      const shaped = choice ? applyRenderPath(choice.path, opts) : opts;
      return renderCandidate({
        ...shaped,
        componentId,
        repoRoot: ctx.repoRoot,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Local Compose-for-Web / wasm source — STUB (not implemented).
// ---------------------------------------------------------------------------

/** Options for the (future) in-process Compose-for-Web renderer. */
export interface LocalComposeWebOptions {
  /** Path/URL to the compiled wasm module that renders previews. */
  wasmModule?: string;
  /** Component → preview-id mapping for the in-process render. */
  previewIdFor?: (componentId: string) => string | undefined;
}

/**
 * **STUB.** A {@link CandidateSource} that would render a CMP component via
 * Compose for Web / wasm (the Skia-on-Canvas path), screenshotting it in a
 * headless browser — no Android emulator (docs/PRINCIPLES.md Principle 6).
 *
 * Deliberately **not implemented**: the feasibility verdict (issue #30, stretch)
 * is **defer** — it needs a headless browser (not pure Node), an upstream
 * compose-ai-tools wasm render entrypoint, and a web a11y/semantics export
 * design-parity's Principle-2 checks depend on. The Desktop/JVM path is the
 * recommended emulator-free renderer today. See
 * `docs/cmp-web-wasm-feasibility.md`; the {@link CandidateSource} contract is
 * kept ready so this drops in unchanged if those blockers clear.
 *
 * @throws NotImplementedError on every lookup.
 */
export function localComposeWebSource(
  _options: LocalComposeWebOptions = {},
): CandidateSource {
  return {
    kind: "local-compose-web",
    async getCandidate(): Promise<CandidateRender | undefined> {
      throw new NotImplementedError(
        "the local Compose-for-Web (wasm) candidate source",
        "It will render CMP previews in-process in a headless JS runtime once the wasm render entrypoint lands.",
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 4. compose-preview daemon/session source — implemented in ./daemon.ts.
// ---------------------------------------------------------------------------
//
// The live compose-ai-tools daemon source (issue #43) ingests the renderer's
// native a11y/i18n findings rather than re-deriving them, so it carries more
// than the {@link CandidateSource} seam (it also exposes `nativeFindingsFor`).
// It lives in its own module; see `daemonSource` / `DaemonCandidateSource` in
// ./daemon.ts.
