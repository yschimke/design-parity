/** Subset of the Figma REST shapes the adapter actually reads. */

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaPaint {
  type: string; // "SOLID", "GRADIENT_LINEAR", ...
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
}

export interface FigmaNodeDoc {
  id: string;
  name: string;
  type: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  cornerRadius?: number;
  /** Auto-layout child spacing — the `gap` a redline reads. */
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  fills?: FigmaPaint[];
  style?: FigmaTypeStyle;
  /** Per-node references to shared styles, keyed by style type (`text`, …). */
  styles?: Record<string, string>;
  characters?: string;
  children?: FigmaNodeDoc[];
}

/** A published style's metadata (the file-level `styles` map). */
export interface FigmaStyleMeta {
  key: string;
  name: string;
  styleType: "FILL" | "TEXT" | "EFFECT" | "GRID";
}

/**
 * `GET /v1/files/:key` — the file's own metadata. `version` is the edit
 * counter: it changes whenever anyone touches the file, so it answers "can any
 * cached reference from this file have moved?" in one request.
 */
export interface FileMetaResponse {
  name: string;
  /** ISO-8601, when the file was last edited. */
  lastModified: string;
  /** Opaque, monotonic per file. Compare for equality, don't order. */
  version: string;
  thumbnailUrl?: string;
}

export interface FileNodesResponse {
  nodes: Record<
    string,
    { document: FigmaNodeDoc; styles?: Record<string, FigmaStyleMeta> } | null
  >;
}

export interface ImagesResponse {
  err: string | null;
  images: Record<string, string | null>;
}

export type VariableValue =
  | FigmaColor
  | number
  | string
  | boolean
  | { type: "VARIABLE_ALIAS"; id: string };

export interface FigmaVariable {
  id: string;
  name: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  valuesByMode: Record<string, VariableValue>;
}

export interface FigmaVariableMode {
  modeId: string;
  name: string;
}

export interface FigmaVariableCollection {
  id: string;
  name: string;
  defaultModeId: string;
  modes: FigmaVariableMode[];
  variableIds: string[];
}

export interface VariablesResponse {
  meta?: {
    variables: Record<string, FigmaVariable>;
    variableCollections: Record<string, FigmaVariableCollection>;
  };
}
