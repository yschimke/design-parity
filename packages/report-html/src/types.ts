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
  /**
   * The diff heatmap PNG bytes. Optional because the engine produces none when
   * a pair has no aligned region to diff — an entry can still be worth carrying
   * for {@link DiffImage.candidatePng} alone.
   */
  png?: Uint8Array;
  /**
   * The candidate as actually compared, when that is not the file on disk —
   * today, a capture whose declared `Image.gutter` the engine cropped off.
   *
   * The report has to prefer this over reading `Image.uri`, or it shows a panel
   * that contradicts the score beside it: the guttered capture sits at its full
   * size next to a reference and heatmap at the component's, and the overlay
   * slider stretches it to the reference's box. Absent (the common case) means
   * the file on disk is what was compared, so read that.
   */
  candidatePng?: Uint8Array;
}

/** Dependency-free view of `@design-parity/diff`'s scoped acceptance result. */
export interface AcceptanceReportView {
  documentRejected: boolean;
  statuses: Record<
    string,
    { status: string; causes?: string[]; reasons?: string[] }
  >;
  validationFailures: Array<{ id?: string; index?: number; reason: string }>;
  /**
   * Mirrors `AcceptanceReport['scores']` — see its doc in `@design-parity/diff`.
   *
   * `version` is **optional here and required there**, and the asymmetry is the point. The engine
   * always stamps what it produces, so a fresh report has it. This package renders *persisted*
   * reports too, and every one written before the field existed lacks it; a required property
   * cannot repair an object that was already serialized. Absent means "unknown", which the renderer
   * says by omitting the chip rather than by claiming a version.
   */
  scores: { raw: number; accepted: number; unaccepted: number; version?: number };
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
