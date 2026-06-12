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
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  fills?: FigmaPaint[];
  style?: FigmaTypeStyle;
  characters?: string;
  children?: FigmaNodeDoc[];
}

export interface FileNodesResponse {
  nodes: Record<string, { document: FigmaNodeDoc } | null>;
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
