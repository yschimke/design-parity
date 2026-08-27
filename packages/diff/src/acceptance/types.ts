export interface Raster {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Plane {
  plane: "content-box" | "full-canvas";
  box: Box;
}

export interface AcceptanceScope {
  system: string;
  component: string;
  previewId: string;
  referenceId: string;
  variant: string;
  overrides: Record<string, string>;
  referenceSha256?: string | null;
}

export interface AcceptanceStatus {
  status: "valid" | "resolved" | "invalidated" | "refused" | "out-of-scope";
  causes?: string[];
  reasons?: string[];
}

export type TagIndex = Record<
  string,
  { count: number; bounds?: { x: number; y: number; width: number; height: number } }
>;

export interface AcceptanceReport {
  documentRejected: boolean;
  statuses: Record<string, AcceptanceStatus>;
  validationFailures: Array<{ id?: string; index?: number; reason: string }>;
  /**
   * The three numbers, and **which pixel path minted them**.
   *
   * `version` mirrors `SCORE_VERSION` in the vendored tuning, and travels with the scores rather
   * than beside them because it is a fact *about* these numbers: the kernel changes deliberately
   * (1 was the browser's `drawImage`, 2 the portable area average on straight alpha, 3 that kernel
   * premultiplied), and each change moves every published score without changing any verdict. A
   * consumer holding a stored report from another release can then tell a genuine regression from a
   * rebaseline, instead of reporting a difference that is entirely in the arithmetic.
   *
   * Stamped by the engine that produced the scores and never restated by a caller — a caller
   * carrying its own copy of the constant can label a number with a version it did not implement,
   * which is worse than no version at all, because the wrong one gets trusted.
   */
  scores: { raw: number; accepted: number; unaccepted: number; version: number };
  suppressing: string[];
}

/**
 * An {@link AcceptanceReport} as it may come back *off disk*.
 *
 * `scores.version` is required on a freshly produced report — the engine always stamps it — but
 * every report serialized before the field existed lacks it, and no TypeScript property can repair
 * an object that is already written. Renderers read both, so they read this: absent means the
 * kernel is unknown, which is said by omitting the version rather than by printing one.
 */
export type PersistedAcceptanceReport = Omit<AcceptanceReport, "scores"> & {
  scores: Omit<AcceptanceReport["scores"], "version"> & { version?: number };
};

export interface KnownDifferencesComparison {
  /** Repository root containing `.design-parity/known-differences.json`. */
  repoRoot: string;
  scope: AcceptanceScope;
  /** Reference/candidate source rasters before canonicalisation or score-plane resampling. */
  reference: Raster;
  candidate: Raster;
  /** Current candidate semantics projected from render pixels by this engine. */
  tagIndex?: TagIndex;
  /** Override only for tests or a non-standard committed layout. */
  documentPath?: string;
  /** Override only for tests or a non-standard committed layout. */
  artifactRoot?: string;
}
