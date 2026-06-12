/**
 * `@design-parity/resolver` — the correspondence layer (code ↔ design).
 *
 * Given the changed code components on a PR and the repo's committed inputs
 * (Code Connect index, `design-map.json`, a name catalog), decide which design
 * `(source, ref)` each component maps to, with a `linkMethod` and `confidence`.
 * Depends only on `@design-parity/core`.
 */
export type {
  CodeConnectIndex,
  DesignCatalogEntry,
  ResolverInputs,
  ComponentResolution,
  ResolveResult,
} from "./resolver.js";

export { resolveComponent, resolve } from "./resolver.js";
