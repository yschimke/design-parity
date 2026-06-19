/**
 * `@design-parity/report-html` — the per-run, self-contained HTML comparison
 * page.
 *
 * Consume the same `(DesignReference, CandidateRender, Verdict)` the markdown
 * summary uses, plus optional diff panels, and emit ONE offline `.html` string:
 * reference | candidate | diff side by side per variant, the verdict findings
 * in value order, every image inlined as a `data:` URI. Deterministic, no
 * external assets. A leaf consumer — depends only on `@design-parity/core`.
 */
export { renderHtmlReport, toDisplayFrame } from "./render.js";
export type { DiffImage, ReportInput } from "./types.js";
export { pairVariants } from "./variants.js";
export type { Variant } from "./variants.js";
export { groupFindings, tokenDelta, SECTIONS } from "./findings.js";
export type { FindingSection, GroupedSection, TokenDelta } from "./findings.js";
export { renderIndex, renderReadme, renderIndexHtml, shortCode } from "./index-page.js";
export type { IndexEntry, IndexInput, IndexStatus } from "./index-page.js";
