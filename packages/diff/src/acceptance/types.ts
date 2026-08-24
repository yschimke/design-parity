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
  scores: { raw: number; accepted: number; unaccepted: number };
  suppressing: string[];
}

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
