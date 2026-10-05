#!/usr/bin/env node
/**
 * Run the driver's `node --test` suites as this package, minus the checks that are about
 * compose-ai-tools rather than the driver.
 *
 * The driver's files are copied from compose-ai-tools' `scripts/design-artifacts/` unchanged (see
 * README.md), tests included. A few tests there assert the driver agrees with *that repository*:
 * its workflow file, its Kotlin sources, its sample specs and fonts, its lockfile. They resolve
 * those paths against the repository root, which here is design-parity, so they cannot pass here
 * and are not this package's to check. compose-ai-tools keeps running them. Everything else runs.
 *
 * Each exclusion is listed with its reason, so the list cannot quietly grow.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Whole files that read compose-ai-tools' own files when they load. */
const EXCLUDED_FILES = {
  "package-version.test.mjs": "reads the folder's package-lock.json; a workspace package has none",
};

/** Individual tests, by exact name, that read compose-ai-tools' own files. */
const EXCLUDED_TESTS = {
  "every declared face has a vendored file": "compose-ai-tools' samples/cmp-wasm-catalog fonts",
  "fontFaceCss inlines one @font-face per file and needs no network":
    "compose-ai-tools' samples/cmp-wasm-catalog fonts",
  "the reusable workflow passes shard exclusions by file, not through argv":
    "compose-ai-tools' .github/workflows/design-artifacts-reusable.yml",
  "the role vocabulary matches the Kotlin the generator actually reads":
    "compose-ai-tools' screen/generator Kotlin source",
  "a templates path outside ui-builder is an error, not a shrug":
    "compose-ai-tools' gradle-plugin Kotlin source",
  "sample spec samples/design-catalog-m3/catalog.spec.json resolves all previews against its module":
    "compose-ai-tools' samples/design-catalog-m3",
  "sample spec samples/design-catalog-wear-m3/catalog.spec.json resolves all previews against its module":
    "compose-ai-tools' samples/design-catalog-wear-m3",
};

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const files = readdirSync(ROOT)
  .filter((name) => name.endsWith(".test.mjs") && !(name in EXCLUDED_FILES))
  .sort();
const args = [
  "--test",
  ...Object.keys(EXCLUDED_TESTS).map((name) => `--test-skip-pattern=^${escape(name)}$`),
  ...files,
];
const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
process.exit(result.status ?? 1);
