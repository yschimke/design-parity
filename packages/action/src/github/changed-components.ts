/**
 * Decide which components a PR touched: the `design-map.json` entries whose code
 * file is among the PR's changed files. Deterministic — the Action never guesses
 * components from a model (Principle 1). A PR that changes no mapped component is
 * "non-UI" and gets skipped.
 */
import type { DesignMap } from "@design-parity/core";

/** The file part of a code handle: `"ui/Button.kt#PrimaryButton"` → `"ui/Button.kt"`. */
export function filePathOf(code: string): string {
  const hash = code.indexOf("#");
  return hash === -1 ? code : code.slice(0, hash);
}

/**
 * Code handles from `design-map.json` whose file was changed in this PR. Paths
 * are compared after stripping a leading `./`, so either form matches.
 */
export function componentsForChangedFiles(
  designMap: DesignMap | undefined,
  changedFiles: string[],
): string[] {
  if (!designMap) return [];
  const changed = new Set(changedFiles.map((f) => f.replace(/^\.\//, "")));
  return designMap.components
    .filter((c) => changed.has(filePathOf(c.code).replace(/^\.\//, "")))
    .map((c) => c.code);
}
