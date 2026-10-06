// @ts-nocheck
import { buildCatalog } from "../ingest.js";
import { duplicateAxesFailure, foldVariants, variantLabel } from "./catalog-variants.js";
import { foldMotion, motionArtifactsFor, motionPreviewFor } from "./catalog-motion.js";
import {
  DEFERRED,
  entryPriority,
  modeOfPreviewId,
  modePriority,
  previewForImage,
  splitDeferredImages,
  splitDeferredVariants,
} from "./catalog-priority.js";
import { manifestCompareWith } from "./cross-system-compare.js";
import { exportsNoSticker } from "./capture-mode.js";
import { selectComponentImages, selectOf } from "./catalog-select.js";


// --- the spec→candidate join ---------------------------------------------------
// Pure join of rendered CandidateRenders to a catalog spec, wrapping `buildCatalog`. The one
// implementation: the export driver imports it directly, and spec.ts's typed
// `catalogFromCandidates` delegates to it.
//
// The bundle reader emits one candidate per multipreview variant — its id
// carries a `_<mode>` suffix (`FilledButton_Light`, `FilledButton_Dark`) that
// the spec's bare `preview` ("FilledButton") doesn't. To match, the caller
// resolves each candidate's componentId to its `functionName` (see the
// `loadPreviewBundle(..., resolver)` call below), so `functionOf` keys on the
// stable function name and a function's theme/size variants fold onto one
// sticker.

/** The function name a spec component matches on. With the resolver below,
 *  `componentId` is the function name; `functionName` is preferred when a
 *  future bundle reader sets it directly on the candidate. */
/** The function name a spec component matches on. The export driver's bundle resolver sets
 *  `componentId` to it; `functionName` is preferred when the candidate carries one.
 *  `catalogFromCandidates` in spec.ts derives `functionName` for callers without that resolver. */
export function functionOf(candidate) {
  return candidate.functionName ?? candidate.componentId;
}

/**
 * Identity of one deferred sticker across every axis a `deferred[]` record can carry, so a
 * recovered-from-the-bundle record (issue #2966) is deduped against the image-derived one for the
 * SAME sticker and not against a sibling variant that merely shares its mode. `props` is
 * key-sorted so two equal prop sets always produce the same key.
 */
function deferralAxisKey(theme, state, props, size) {
  const propsPart = props
    ? Object.entries(props)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(",")
    : "";
  // NUL-joined (like `bridge-live-preview-ids`' `variantKey`) so a state or prop value that
  // contains the separator can never make two different stickers collide on one key.
  const NUL = String.fromCharCode(0);
  return [theme ?? "", state ?? "", propsPart, size ?? ""].join(NUL);
}

/** A semantics tree carries real signal (not the empty `{ root: {} }` fallback). */
function hasSemantics(candidate) {
  const tree = candidate.semantics;
  if (!tree) return false;
  if (tree.themeTokens) return true;
  const r = tree.root;
  return Boolean(
    r &&
    ((r.children && r.children.length > 0) ||
      r.role ||
      r.label ||
      r.bounds ||
      r.tokens),
  );
}

/** Fold a function's theme/size variants into one render: concatenate images and
 *  keep a light-themed semantics tree (the token/greenline reader keys off one). */
function mergeByFunction(a, b) {
  const semantics =
    a.semantics?.theme === "light"
      ? a.semantics
      : b.semantics?.theme === "light"
        ? b.semantics
        : a.semantics;
  const merged = {
    componentId: a.componentId,
    images: [...a.images, ...b.images],
    semantics,
  };
  if (a.previewId ?? b.previewId) merged.previewId = a.previewId ?? b.previewId;
  if (a.functionName ?? b.functionName)
    merged.functionName = a.functionName ?? b.functionName;
  return merged;
}

/**
 * Deep-merge two token sets, layering `extra` over `base` per category (spacing /
 * colors / radius / typography). Folds `@ColorCatalog`/`@TypographyCatalog` tokens
 * on top of the MaterialTheme table lifted from component semantics, so a bundle
 * carrying both keeps every token instead of one replacing the other. Returns the
 * single defined side when only one exists, or `undefined` when neither does.
 */
export function mergeDesignTokens(base, extra) {
  if (!base) return extra;
  if (!extra) return base;
  const out = { ...base };
  for (const cat of ["spacing", "colors", "radius", "typography"]) {
    if (base[cat] || extra[cat]) {
      out[cat] = { ...(base[cat] ?? {}), ...(extra[cat] ?? {}) };
    }
  }
  return out;
}

/**
 * Join rendered candidates to a catalog spec. Each spec component is matched to
 * the candidate whose preview function name equals its `preview`; a function's
 * theme/size variants are folded into one component, missing previews are
 * reported rather than dropped, and rendered-but-semantics-less components are
 * flagged so the completeness gate can refuse to publish. An entry that declares
 * `"capture": "none"` and rendered no static sticker is reported on the separate
 * `noSticker` list instead of `missing` — a declared, non-blocking gap.
 */
export function catalogFromCandidates(candidates, spec, opts = {}) {
  const byFunction = new Map();
  for (const candidate of candidates) {
    const fn = functionOf(candidate);
    const existing = byFunction.get(fn);
    byFunction.set(
      fn,
      existing ? mergeByFunction(existing, candidate) : candidate,
    );
  }

  // Preview id → the theme that id's candidate resolved, read BEFORE the per-function merge
  // flattens the candidates into one image list. This is what pairs a motion capture with the
  // themed card it accompanies: a capture knows its preview id, and its sibling still's theme is
  // the theme of the candidate carrying that id. Taken from the candidate rather than re-derived
  // from the id's `_Dark` / `_Light` suffix, so there stays exactly one implementation of the
  // mode-naming rule (`catalog-themes.mjs` owns it). See foldMotion.
  const themeByPreviewId = new Map();
  for (const candidate of candidates) {
    const id = candidate?.componentId;
    if (!id) continue;
    const theme = (candidate.images ?? []).find((image) => image?.theme)?.theme;
    if (theme !== undefined) themeByPreviewId.set(id, theme);
  }

  const sources = [];
  const missing = [];
  const noSticker = [];
  const withoutSemantics = [];
  // Components whose images collide on effective output axes, accumulated across the whole spec and
  // refused once below (issue #5065). The fold used to throw on the first one, so a spec with two
  // colliding components — the common shape, since one cause (a bare `@Preview` beside a locale
  // multipreview) hits every component that carries it — cost one render cycle per collision to
  // discover. Unlike `missing` / `noSticker` this is never gated by `--allow-incomplete`: see the
  // refusal below.
  const duplicateAxes = [];
  // The motion axis, kept BESIDE the sources as well as on them, so the written manifest can be
  // checked against what the join actually resolved. `buildCatalog` builds its components from an
  // allow-list and drops any field it hasn't been taught — which is precisely how this axis went
  // missing, silently, before the pin carried it. See motion-carried.mjs.
  const motionByComponentId = new Map();
  // Live-only coverage: entries and image axes the spec deferred (issue #2950). Recorded so
  // catalog.json still declares them — they are not lost coverage, just not rasterised here — and
  // deliberately kept OUT of `missing` / `withoutSemantics`, which is the whole point: the gate
  // stays strict over the required inventory instead of being switched off wholesale with
  // `--allow-incomplete`.
  const deferred = [];
  for (const group of spec.groups) {
    for (const specComponent of group.components) {
      // A wholly-deferred entry is never rendered (its `@Preview` may not even have been packed
      // with a PNG), so it short-circuits before the candidate lookup — reporting it missing is
      // exactly the false failure this feature exists to remove.
      if (entryPriority(specComponent) === DEFERRED) {
        // `"capture": "none"` outranks deferral, for both the entry and its variants below. The two
        // axes answer different questions — deferral picks the LANE (bake now vs. render on the serve
        // host), `capture` says the preview yields no sticker on ANY lane — so a declared-uncapturable
        // preview has nothing for the live lane to serve either. Recording it live-only would invent
        // a card for coverage the spec says doesn't render, and the required path already classifies
        // the identical entry as `noSticker` (foldVariants); the two must agree.
        if (exportsNoSticker(specComponent)) {
          noSticker.push(specComponent.componentId);
        } else {
          deferred.push({
            componentId: specComponent.componentId,
            group: group.name,
            ...(group.section !== undefined ? { section: group.section } : {}),
            ...(specComponent.caption !== undefined
              ? { caption: specComponent.caption }
              : {}),
            preview: specComponent.preview,
            reason: "entry",
          });
        }
        // Its variants are deferred with it (`variantPriority` inherits), and each needs its OWN
        // record: a variant's sticker is normally folded onto the component's images, and there is no
        // `components[]` entry left to fold onto. Recording them here is what keeps them reachable on
        // the live lane instead of dropping out of the publish unnoticed — the short-circuit below
        // means nothing else in this loop will see them.
        for (const variant of specComponent.variants ?? []) {
          if (exportsNoSticker(variant)) {
            // Same label shape `foldVariants` uses for the required path, from the same helper, so a
            // reader can't tell from the report which lane the entry took.
            noSticker.push(
              `${specComponent.componentId} [${variantLabel(variant)}]`,
            );
            continue;
          }
          deferred.push({
            componentId: specComponent.componentId,
            group: group.name,
            ...(group.section !== undefined ? { section: group.section } : {}),
            preview: variant.preview,
            reason: "variant",
            ...(variant.state !== undefined ? { state: variant.state } : {}),
            ...(variant.props !== undefined ? { props: variant.props } : {}),
            ...(variant.theme !== undefined ? { theme: variant.theme } : {}),
          });
        }
        continue;
      }
      // Fold only the REQUIRED variants; each deferred one is recorded live-only instead of being
      // looked up (and then reported missing) below.
      const { component, deferredVariants } =
        splitDeferredVariants(specComponent);
      for (const variant of deferredVariants) {
        deferred.push({
          componentId: component.componentId,
          group: group.name,
          preview: variant.preview,
          reason: "variant",
          ...(variant.state !== undefined ? { state: variant.state } : {}),
          ...(variant.props !== undefined ? { props: variant.props } : {}),
          ...(variant.theme !== undefined ? { theme: variant.theme } : {}),
        });
      }
      const candidate = byFunction.get(component.preview);
      if (!candidate || candidate.images.length === 0) {
        // `"capture": "none"` is the spec's way of declaring a preview that has no static sticker to
        // join on (an `AndroidView`-hosted composable, a scrolling GIF, …). The entry is still absent
        // from the sheet, but it is a DECLARED absence — reported separately so the completeness gate
        // doesn't sink the publish over it. See capture-mode.mjs / issue #2946.
        if (exportsNoSticker(component)) noSticker.push(component.componentId);
        else missing.push(component.componentId);
        continue;
      }
      // An entry may `select` ONE value of a multipreview's fan-out, so two entries can share a
      // `@Preview` function and still be separate cards with their own ids and captions — the
      // alternative being to split the function in the module (see catalog-select.mjs).
      const select = selectOf(component);
      const { images: selected, missing: unselected } = selectComponentImages(
        component,
        candidate,
      );
      if (unselected) {
        missing.push(unselected);
        continue;
      }
      if (!hasSemantics(candidate))
        withoutSemantics.push(component.componentId);
      // Fold the component's state `variants` (pressed / focused / disabled / off
      // / …) onto the default render: the default images stay the grid hero, each
      // variant's render is appended re-tagged with its `state` so the single-
      // component view can show them as secondary previews. A variant preview that
      // didn't render is reported as missing so the completeness gate still fires.
      const {
        ideal,
        missing: missingVariants,
        noSticker: noStickerVariants,
        duplicateAxes: collidingAxes,
      } = foldVariants(selected, component, byFunction);
      missing.push(...missingVariants);
      noSticker.push(...noStickerVariants);
      duplicateAxes.push(...collidingAxes);
      // Thin the palette fan-out per `modePriority`: a themed sticker whose mode is deferred is
      // dropped from the baked set (so no PNG is written and the Figma/static kit stays lean) and
      // recorded live-only. Only stickers that NAME a theme are eligible, so every component keeps
      // its untagged primary render.
      const { baked, deferred: deferredImages } = splitDeferredImages(
        ideal,
        spec,
      );
      for (const image of deferredImages) {
        deferred.push({
          componentId: component.componentId,
          group: group.name,
          preview: previewForImage(component, image),
          reason: "mode",
          theme: image.theme,
          ...(image.state !== undefined ? { state: image.state } : {}),
          ...(image.props !== undefined ? { props: image.props } : {}),
          ...(image.size !== undefined ? { size: image.size } : {}),
        });
      }
      // Modes whose render was SKIPPED, not merely un-published (issue #2966). Once the render
      // filter drops a deferred palette, its images never reach the candidate join (the join only
      // sees previews that produced a PNG), so `splitDeferredImages` above has nothing to record and
      // the coverage would vanish from `catalog.json` instead of being declared live-only. Recover it
      // from the bundle's full preview list, which carries every SELECTED preview whether or not CI
      // rasterised it — the same listing the live lane resolves against. Deduped against the modes
      // already accounted for, so an unfiltered render (a local generate, say) records each once.
      //
      // Keyed by the FULL axis tuple, not by mode alone, and walked over the component's own
      // `@Preview` plus each REQUIRED variant's: a required state/props variant whose function also
      // fans out by mode has its deferred-mode ids excluded from the render too, and recording only
      // the base function's would drop that variant's `state`/`props` from the declaration (a record
      // an unfiltered run produced via `splitDeferredImages`). Deferred variants are already recorded
      // above, so they are deliberately not revisited here.
      const seenAxes = new Set(
        [...deferredImages, ...baked]
          .filter((image) => image.theme)
          .map((image) =>
            deferralAxisKey(image.theme, image.state, image.props, image.size),
          ),
      );
      // A `select`ed entry covers ONE breakpoint of its function, so its deferred-mode record has to
      // name that size — otherwise the sibling entry selecting the other breakpoint dedupes against
      // the same axis key and only one of the two is declared live-only.
      const modeSources = [
        { preview: component.preview, size: select?.size },
        ...(component.variants ?? []).map((v) => ({
          preview: v.preview,
          state: v.state,
          props: v.props,
          size: selectOf(v)?.size ?? v.size,
        })),
      ];
      for (const source of modeSources) {
        if (!source.preview) continue;
        for (const previewId of opts.previewIdsByFunction?.get(
          source.preview,
        ) ?? []) {
          const mode = modeOfPreviewId(previewId, spec.modes);
          if (!mode || modePriority(spec, mode) !== DEFERRED) continue;
          const key = deferralAxisKey(
            mode,
            source.state,
            source.props,
            source.size,
          );
          if (seenAxes.has(key)) continue;
          seenAxes.add(key);
          deferred.push({
            componentId: component.componentId,
            group: group.name,
            preview: source.preview,
            reason: "mode",
            theme: mode,
            ...(source.state !== undefined ? { state: source.state } : {}),
            ...(source.props !== undefined ? { props: source.props } : {}),
            ...(source.size !== undefined ? { size: source.size } : {}),
          });
        }
      }
      if (baked.length === 0) {
        // Every one of this component's renders was mode-deferred — it would publish as a
        // component with no pixels at all. That is a misconfiguration (a `modePriority` that
        // defers the mode a component renders in exclusively), not a deferral, so fail it.
        missing.push(component.componentId);
        continue;
      }
      const source = {
        componentId: component.componentId,
        group: group.name,
        ideal: baked,
      };
      // The component's animated captures, alongside (never inside) its stills — see
      // catalog-motion.mjs for why `images[]` is the wrong home for a 114-frame recording. Read off
      // the component's own `@Preview` function by default, or its explicit `motionPreview` when
      // the static sticker and GIF need separate functions. A state variant's motion capture is
      // suppressed at discovery, so there is none to collect, and folding the variants' would
      // publish duplicates of one script anyway.
      const motion = foldMotion(
        baked,
        motionArtifactsFor(opts.motionBundle, motionPreviewFor(component)),
        opts.previewCellsByFunction?.get(component.preview),
        opts.previewCellsByFunction?.get(motionPreviewFor(component)),
        themeByPreviewId,
      );
      if (motion.length > 0) {
        source.motion = motion;
        motionByComponentId.set(component.componentId, motion);
      }
      // A group may declare a top-level `section` (the tab the preview server
      // buckets it under: Themes / Components / Screens / Animations / …). It sits
      // one level above `group`, which becomes the sub-heading inside a tab.
      // Absent ⇒ an untabbed flat catalog, as before.
      if (group.section !== undefined) source.section = group.section;
      if (component.caption !== undefined) source.caption = component.caption;
      if (component.reference !== undefined)
        source.reference = component.reference;
      // The component FAMILY `reference` is one variant of. `reference` stays the single node a
      // parity run diffs this sticker against; `referenceSet` is what a whole-screen import matches
      // an instance through, since a screen rarely uses the exact variant the catalog pictured.
      if (component.referenceSet !== undefined)
        source.referenceSet = component.referenceSet;
      if (component.referenceSet !== undefined)
        source.referenceSet = component.referenceSet;
      // The stated reason there is NO reference — distinct from an absent `reference`, which says
      // only that nobody has looked. Both this and `referenceSet` are preserved by
      // `@design-parity/catalog-export` from the release that added them; on an older pinned
      // package `buildCatalog` drops them and the fields stop here. Harmless (the catalog is
      // shaped exactly as before), but it does mean the annotation only reaches `catalog.json`
      // once package.json + the lockfile move — see the note on the dependency pin.
      if (component.noReference !== undefined)
        source.noReference = component.noReference;
      if (candidate.semantics) source.semantics = candidate.semantics;
      sources.push(source);
    }
  }

  // Refuse the whole build once, naming every collision. Deliberately a `throw` rather than another
  // entry in the returned report: two images sharing an output path mean last-write-wins pixels
  // paired with stale manifest metadata, which is a correctness failure and not the coverage gap
  // `--allow-incomplete` exists to wave through. It fires before `buildCatalog`, so nothing is
  // written either way — the only thing that changed is that one run now names every colliding
  // component instead of the first.
  const duplicateAxesError = duplicateAxesFailure(duplicateAxes);
  if (duplicateAxesError) throw duplicateAxesError;

  const meta = {
    system: spec.system,
    title: spec.title,
    ...(spec.library ? { library: spec.library } : {}),
    ...(opts.renderer ? { renderer: opts.renderer } : {}),
    ...(opts.designParity ? { designParity: opts.designParity } : {}),
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    // The locales the sheet covers, when it declares any (issue #5059). Carried onto the manifest
    // beside `themes` so a consumer can group the arms of a locale fan-out rather than infer the
    // axis from a `props.locale` it happens to see on some stickers.
    ...(Array.isArray(spec.locales) && spec.locales.length > 0
      ? { locales: spec.locales }
      : {}),
    // Presentation hints the system declares (stage surface + hero preview),
    // carried through onto catalog.json so the preview server reads them instead
    // of inferring — see catalog.spec.schema.json `display`.
    ...(spec.display ? { display: spec.display } : {}),
    // The screen graph, when the spec declares one: which components are screens and how they
    // relate, for a consumer that lays the catalog out as flows rather than a component grid.
    ...(spec.screens ? { screens: spec.screens } : {}),
    // The cross-system pairing, for a consumer of the published catalog. Each component already
    // carries `parallel` (its counterpart's componentId) on the wire, but not which SYSTEM that id
    // belongs to — so a preview server serving both catalogs could not resolve the pair. This is
    // the missing half; see `manifestCompareWith` for why it is narrower than the spec field.
    ...(manifestCompareWith(spec.compareWith)
      ? { compareWith: manifestCompareWith(spec.compareWith) }
      : {}),
  };

  // `opts.themes` is forwarded explicitly: `buildCatalog` takes it positionally, so an option this
  // join does not thread through is silently dropped. Missing it published a catalog
  // with no `themes[]` while the run logged that it was publishing them.
  const catalog = buildCatalog(meta, sources, opts.themeTokens, opts.themes);
  return {
    catalog,
    missing,
    noSticker,
    withoutSemantics,
    deferred,
    motionByComponentId,
  };
}
// --- end of the spec→candidate join ---------------------------------------------

