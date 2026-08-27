/**
 * Local contracts for the HTML report.
 *
 * This package is a leaf consumer: it depends only on `@design-parity/core`.
 * It deliberately does *not* import `@design-parity/diff` — instead the
 * triptych/diff panels arrive as a generic {@link DiffImage}, so the diff
 * engine (or any producer) can hand us heatmaps without this package taking a
 * dependency on it.
 */
import type {
  CandidateRender,
  DesignReference,
  Verdict,
} from "@design-parity/core";

/**
 * A diff panel to inline, keyed by the same `state/theme/size` key the diff
 * engine uses for its triptychs/visual scores. `png` is the raw PNG bytes.
 */
export interface DiffImage {
  key: string;
  png: Uint8Array;
}

/** Dependency-free view of `@design-parity/diff`'s scoped acceptance result. */
export interface AcceptanceReportView {
  documentRejected: boolean;
  statuses: Record<
    string,
    { status: string; causes?: string[]; reasons?: string[] }
  >;
  validationFailures: Array<{ id?: string; index?: number; reason: string }>;
  /** Mirrors `AcceptanceReport['scores']`, `version` included — see its doc in `@design-parity/diff`. */
  scores: { raw: number; accepted: number; unaccepted: number; version: number };
  suppressing: string[];
}

/** Everything {@link renderHtmlReport} needs to emit one offline page. */
export interface ReportInput {
  reference: DesignReference;
  candidate: CandidateRender;
  verdict: Verdict;
  /** Per-variant diff panels (e.g. the pixelmatch heatmaps). Optional. */
  diffImages?: DiffImage[];
  /** Per-variant raw/accepted/unaccepted scores and per-acceptance statuses. */
  acceptances?: Record<string, AcceptanceReportView>;
  /**
   * Root the reference/candidate `Image.uri`s resolve against (mirrors the
   * diff engine). Defaults to `process.cwd()`.
   */
  repoRoot?: string;
}
