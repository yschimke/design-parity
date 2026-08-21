/**
 * `design-map.json` types, loader, and validator.
 *
 * The design-map is the manifest correspondence layer: it links a code
 * component to a design reference for sources that have no machine link
 * (Stitch, Claude Design), and can override Code Connect for Figma.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AjvModule, { type ValidateFunction } from "ajv";

import type { DesignSource, PreviewIdVariant, RefVariant } from "./types.js";
import schema from "../schema/design-map.schema.json" with { type: "json" };

// ajv ships CJS; under NodeNext the constructable class can land on `.default`.
type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: <T>(schema: unknown) => ValidateFunction<T>;
};
const Ajv = ((AjvModule as unknown as { default?: AjvCtor }).default ??
  (AjvModule as unknown as AjvCtor)) as AjvCtor;

/** One manifest entry: code handle → design reference. */
export interface DesignMapEntry {
  /** Code handle, e.g. `"ui/Button.kt#PrimaryButton"`. */
  code: string;
  source: DesignSource;
  /**
   * Source-specific reference handle(s). A string binds a single node; a list of
   * variant-tagged handles binds several nodes — a screen's states/themes/sizes
   * living in separate frames — each re-tagged onto its variant slot.
   */
  ref: string | RefVariant[];
  /**
   * Optional handle for the **component family** {@link ref} is one variant of —
   * a Figma component *set*, or whatever the source calls the node that owns a
   * component's variants. Sources with no such concept (Stitch, Claude Design,
   * bundle) simply omit it.
   *
   * Why it exists, and why it is not just another {@link ref}: the two are read
   * by different consumers wanting incompatible things.
   *
   * - **Parity** diffs a render against `ref`, so `ref` must be one concrete,
   *   renderable variant. Point it at a set and the comparison is against a
   *   grid of every variant at once — meaningless.
   * - **Whole-screen matching** ({@link https://github.com/yschimke/design-parity/blob/main/docs/page-backdrop-contract.md | page backdrops})
   *   sees a component *instance* on a screen, which reports its own variant and
   *   its set. A screen almost never uses the exact variant a catalog chose to
   *   picture, so matching on `ref` alone misses — while the set matches every
   *   variant of the component at once.
   *
   * Measured on the Material 3 kit: mapping only per-variant refs linked 3 of 11
   * instances on a real screen; the misses were a list item and a carousel whose
   * screens used *sibling variants* of the very components the catalog maps.
   *
   * So this is the family key, kept separate from the parity key rather than
   * overloading one field to mean both.
   */
  refSet?: string;
  /**
   * Whether Figma exports only the mapped node's own content. Defaults to true.
   * Set false only for a reference that intentionally relies on overlapping
   * sheet layers, such as an authored backdrop.
   */
  referenceContentsOnly?: boolean;
  /**
   * Optional compose-ai-tools preview id this code handle renders as — the
   * authoritative link between a preview-bundle / daemon candidate (keyed by
   * preview id) and this reference (keyed by code handle), see issue #44.
   *
   * A string binds a single candidate preview (`"a.b.C.fn"`). A list of
   * variant-tagged handles binds several — a screen's themes/states/sizes
   * authored as separate `@Preview`s (`FooPreview` + `FooDarkPreview`) — each
   * re-tagged onto its variant slot, mirroring how {@link ref} carries themed
   * reference frames (issue #111). The candidate side resolves every tagged id
   * to this one code handle and merges their renders, so the report's theme
   * matrix fills both columns for one component.
   *
   * When omitted, the resolver falls back to a low-confidence convention
   * (`sourceFile#functionName`).
   */
  previewId?: string | PreviewIdVariant[];
  /**
   * Optional repo-relative path to a committed W3C DTCG token file whose tokens
   * are this component's spec tokens (issue #89). For sources that don't expose
   * tokens (bundle, claude-design) — or to override what an adapter resolved —
   * the author commits a DTCG file and links it here; the loaded tokens populate
   * {@link DesignReference.tokens} and are matched against the candidate via the
   * Material-role heuristic (issue #87) and the alias map (issue #78).
   */
  tokensFile?: string;
  /**
   * Optional scale of the reference artwork: **source pixels per dp**. A board
   * drawn at 3× is `3`.
   *
   * Only the author knows it. A design tool reports its own pixels and nothing
   * in the file says what they are pixels *of*, so a consumer quoting them
   * against a render either names the unit and leaves the reader to work out
   * whether `text 31.5px` and `bodyMedium 14sp` agree, or — worse — calls them
   * `sp` and invents a threefold discrepancy (issue #277). With this the
   * captured specs are converted into the code's own units and the two columns
   * of a compare page are finally numerically comparable (issue #279).
   *
   * Omit when unknown. A wrong factor silently rescales every spec on the
   * reference side, which is worse than an honestly stated `px`.
   *
   * Reaches the adapter as {@link Correspondence.density} →
   * {@link AdapterContext.density}. The Figma normalizer divides every length it
   * captures off the artwork — padding, corner radius, type size, line height,
   * letter spacing — into the code's units, and stamps the factor onto the
   * layout's {@link SemanticTree.density} / `boundsDensity` so a consumer
   * measuring those boxes knows what they are. The design-system table read from
   * Figma **Variables** is deliberately left alone: a Variable is a number the
   * designer declared, not a length measured off the board.
   */
  density?: number;
}

export interface DesignMap {
  $schema?: string;
  components: DesignMapEntry[];
  /** Optional design-name ↔ code-name token aliases (see {@link TokenAliasMap}). */
  tokens?: TokenAliasMap;
}

/**
 * Repo-global aliases binding a **code** token name to the **design** token name
 * it implements, per kind. Keyed by the code name (`onSurface`), valued by the
 * design name as the source exposes it (`color/on-surface`, `text.primary`).
 *
 * Token-compliance matches design tokens to code by name; when the two
 * vocabularies differ, this map lets the diff canonicalise the design side to
 * code names before comparing — and inverts to answer the design→code direction
 * a source with no machine link needs (issue #78).
 */
export interface TokenAliasMap {
  colors?: Record<string, string>;
  typography?: Record<string, string>;
  spacing?: Record<string, string>;
  radius?: Record<string, string>;
}

/** The JSON Schema (draft-07) for `design-map.json`, as a plain object. */
export const designMapSchema = schema;

/** Absolute path to the bundled schema file (useful for `$schema` refs). */
export const designMapSchemaPath = fileURLToPath(
  new URL("../schema/design-map.schema.json", import.meta.url),
);

const ajv = new Ajv({ allErrors: true });
const validateFn: ValidateFunction<DesignMap> =
  ajv.compile<DesignMap>(schema);

export interface ValidationResult {
  valid: boolean;
  /** Human-readable errors, empty when valid. */
  errors: string[];
}

/** Validate an already-parsed value against the design-map schema. */
export function validateDesignMap(value: unknown): ValidationResult {
  const valid = validateFn(value);
  if (valid) return { valid: true, errors: [] };
  const errors = (validateFn.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
  );
  return { valid: false, errors };
}

/**
 * Read, parse, and validate a `design-map.json` from disk.
 *
 * @throws Error with a readable message if the file is missing, not JSON, or
 *   fails schema validation.
 */
export async function loadDesignMap(path: string): Promise<DesignMap> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`design-map: cannot read '${path}'`, { cause });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`design-map: '${path}' is not valid JSON`, { cause });
  }

  const result = validateDesignMap(parsed);
  if (!result.valid) {
    throw new Error(
      `design-map: '${path}' failed schema validation:\n  ${result.errors.join("\n  ")}`,
    );
  }
  return parsed as DesignMap;
}

/** Look up the manifest entry for a code handle, or `undefined`. */
export function findByCode(
  map: DesignMap,
  code: string,
): DesignMapEntry | undefined {
  return map.components.find((c) => c.code === code);
}

/**
 * Look up **every** manifest entry for a code handle, in file order.
 *
 * A code can bind more than one design source — the same screen diffed against
 * Claude Design *and* Stitch in a single run (issue #106) — by declaring one
 * entry per source with the same {@link DesignMapEntry.code}. {@link findByCode}
 * returns only the first such entry; this returns all of them, so the resolver
 * can fan a code out to one correspondence per source. Returns `[]` when nothing
 * matches.
 */
export function findAllByCode(map: DesignMap, code: string): DesignMapEntry[] {
  return map.components.filter((c) => c.code === code);
}

/**
 * Normalize an entry's `ref` (string shorthand or variant list) to a
 * {@link RefVariant} list. A bare string becomes a single untagged variant.
 */
export function entryRefs(entry: DesignMapEntry): RefVariant[] {
  return typeof entry.ref === "string" ? [{ ref: entry.ref }] : entry.ref;
}

/**
 * Normalize an entry's `previewId` (absent, string shorthand, or variant list)
 * to a {@link PreviewIdVariant} list — the candidate-side mirror of
 * {@link entryRefs}. No `previewId` yields `[]`; a bare string yields a single
 * untagged variant (issue #111).
 */
export function entryPreviewIds(entry: DesignMapEntry): PreviewIdVariant[] {
  if (entry.previewId === undefined) return [];
  return typeof entry.previewId === "string"
    ? [{ previewId: entry.previewId }]
    : entry.previewId;
}
