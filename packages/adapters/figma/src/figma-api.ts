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

/**
 * One entry of a node's `componentPropertyDefinitions`.
 *
 * `VARIANT` properties are the axes the variant name spells out
 * (`Size=Small`); the other three are the silent ones — they have a
 * `defaultValue` the renderer applies and nothing in the name records it.
 */
export interface FigmaComponentPropertyDefinition {
  type: "BOOLEAN" | "TEXT" | "INSTANCE_SWAP" | "VARIANT";
  defaultValue: boolean | string;
  /** Allowed values, present for `VARIANT` (and sometimes `INSTANCE_SWAP`). */
  variantOptions?: string[];
}

/**
 * One entry of an instance's `componentProperties` — a property definition with
 * the value this instance chose, rather than the one the component defaults to.
 */
export interface FigmaComponentProperty {
  type: "BOOLEAN" | "TEXT" | "INSTANCE_SWAP" | "VARIANT";
  value: boolean | string;
}

export interface FigmaNodeDoc {
  id: string;
  name: string;
  type: string;
  /**
   * The component properties this node defines. Figma returns it on a
   * `COMPONENT_SET` (owning its variants' shared axes) and on a standalone
   * `COMPONENT` — and **only for nodes asked for directly**, never for one
   * reached by descending a page, which is why walking a file records
   * properties for nothing. Keys carry an id suffix (`"Show icon#5590:0"`).
   */
  componentPropertyDefinitions?: Record<string, FigmaComponentPropertyDefinition>;
  /**
   * The values an `INSTANCE` was actually configured with — the other half of
   * {@link componentPropertyDefinitions}. A definition says what the knob is
   * and what it defaults to; this says what someone chose. Only instances carry
   * it, and it is the only way to find a node that renders a component at a
   * property vector other than its defaults.
   */
  componentProperties?: Record<string, FigmaComponentProperty>;
  /** For an `INSTANCE`, the id of the `COMPONENT` it instantiates. */
  componentId?: string;
  /** Figma omits this for visible layers; only a hidden one says `false`. */
  visible?: boolean;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  cornerRadius?: number;
  /** Per-corner radii, when the corners differ (`cornerRadius` is then absent). */
  rectangleCornerRadii?: number[];
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

/**
 * A component's file-level metadata. The load-bearing field here is
 * {@link componentSetId}: a variant node carries no pointer to the set that
 * owns it in its own document, so this map is the only way to get from
 * "the node I was given" to "the family whose properties it renders with".
 */
export interface FigmaComponentMeta {
  key: string;
  name: string;
  description?: string;
  /** Present when the component is a variant of a set; the set's node id. */
  componentSetId?: string;
}

export interface FileNodesResponse {
  nodes: Record<
    string,
    | {
        document: FigmaNodeDoc;
        styles?: Record<string, FigmaStyleMeta>;
        /** Component metadata for this node and its descendants' instances. */
        components?: Record<string, FigmaComponentMeta>;
      }
    | null
  >;
}

/**
 * `GET /v1/files/:key?depth=1` read for its *structure* rather than its
 * metadata: the document's children are the file's pages, truncated to one
 * level, so this is the cheapest enumeration of "what pages exist".
 */
export interface FilePagesResponse {
  name: string;
  lastModified: string;
  version: string;
  document: { id: string; name: string; children?: FigmaNodeDoc[] };
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
