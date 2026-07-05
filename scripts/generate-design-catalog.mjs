#!/usr/bin/env node
/**
 * Generate an importable design-artifact catalog from a rendered catalog module.
 *
 * Pipeline:  compose-preview render  →  this script  →  design-artifacts/<system>
 *
 *   node scripts/generate-design-catalog.mjs \
 *     --spec   <path to catalog.spec.json> \
 *     --renders <compose-preview output dir or .zip (has previews.json + PNGs)> \
 *     --out    <output bundle dir> \
 *     [--renderer "compose-preview 0.16.2"]
 *
 * It reads the static preview bundle with `@design-parity/candidate`
 * (`loadPreviewBundle` → `CandidateRender[]`), joins it to the committed spec
 * with `@design-parity/catalog-export` (`catalogFromCandidates`), and writes the
 * importable bundle (`catalog.json` + `tokens.dtcg.json` + `figma-variables.json`
 * + `images/`). The caller (the weekly workflow) commits the result to the
 * system's `design-artifacts/<system>` branch.
 *
 * Run after `npm run build` so the workspace `dist/` is present.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadPreviewBundle } from "@design-parity/candidate";
import { catalogFromCandidates, screenGraphIssues, writeCatalog } from "@design-parity/catalog-export";
import { PARITY_CONFIG_FILENAME, loadParityConfigOrDefault } from "@design-parity/policy";

const { values } = parseArgs({
  options: {
    spec: { type: "string" },
    renders: { type: "string" },
    out: { type: "string" },
    renderer: { type: "string" },
    // Path to the consumer repo's .design-parity.json — its parity direction is
    // stamped into catalog.json so the Figma importer knows who owns the source
    // of truth. Defaults to the file in the current directory (a missing file
    // resolves to the `auto` default, which the importer treats as design-led).
    config: { type: "string" },
    // Publish even when the render is incomplete (missing previews or absent
    // semantics). Off by default so a degraded render fails the job rather than
    // force-pushing a tokens/greenline-less bundle over a good delivery branch.
    "allow-incomplete": { type: "boolean", default: false },
  },
});

if (!values.spec || !values.renders || !values.out) {
  console.error(
    "usage: generate-design-catalog --spec <catalog.spec.json> --renders <dir|zip> --out <dir> [--renderer <s>]",
  );
  process.exit(2);
}

const specPath = resolve(values.spec);
const rendersPath = resolve(values.renders);
const outPath = resolve(values.out);

const spec = JSON.parse(await readFile(specPath, "utf8"));
const candidates = await loadPreviewBundle(rendersPath);

// Screen graph (optional): warn on references to components the spec never
// declares, so a typo/stale id in the hand-authored graph is visible.
for (const issue of screenGraphIssues(spec)) {
  console.warn(`[${spec.system}] screen graph: ${issue}`);
}

// The repo's parity direction (from .design-parity.json) — stamped into the
// manifest so the importer knows the mode without reaching the repo. A set-up
// repo has already materialized this to a concrete code-led/design-led; an
// un-configured repo resolves to `auto`, which the importer treats as design-led.
const configPath = resolve(values.config ?? PARITY_CONFIG_FILENAME);
const { direction } = await loadParityConfigOrDefault(configPath);

const { catalog, missing, withoutSemantics } = catalogFromCandidates(candidates, spec, {
  ...(values.renderer ? { renderer: values.renderer } : {}),
});

// Completeness gate: `bundle pack --with-semantics` is best-effort and exits 0
// even when the daemon never started or captured zero semantics. For a scheduled
// job that force-pushes a delivery branch, refuse to publish an incomplete render
// (missing previews, or pixels with no semantics → no tokens/contrast/greenlines)
// so a transient failure can't clobber a good branch. `--allow-incomplete` opts out.
if (missing.length > 0) {
  console.warn(`[${spec.system}] missing renders for: ${missing.join(", ")}`);
}
if (withoutSemantics.length > 0) {
  console.warn(`[${spec.system}] no semantics for: ${withoutSemantics.join(", ")}`);
}
if (!values["allow-incomplete"] && (missing.length > 0 || withoutSemantics.length > 0)) {
  console.error(
    `[${spec.system}] incomplete render — refusing to publish. ` +
      `Re-run the render, or pass --allow-incomplete to override.`,
  );
  process.exit(1);
}

// Images in the bundle are relative to the render dir; resolve them from there.
const sourceRoot = rendersPath.endsWith(".zip") ? dirname(rendersPath) : rendersPath;
const result = await writeCatalog(catalog, outPath, { sourceRoot, direction });

console.log(
  `[${spec.system}] ${catalog.components.length} component(s), ${result.imageCount} image(s), direction=${direction} → ${result.manifestPath}`,
);
