/**
 * Correspondence resolver — decide which design reference matches a changed
 * code component.
 *
 * Pure, deterministic logic over committed inputs (Principle 1: no per-run model
 * calls). For each code handle the resolver picks `(source, ref)` in a fixed
 * precedence order:
 *
 *   1. **Code Connect** — Figma's machine link (highest confidence).
 *   2. **`design-map.json`** — the repo's committed manifest.
 *   3. **convention** — best-effort name match against a known catalog, always
 *      flagged low-confidence.
 *
 * The first source that resolves wins; nothing falls through once matched. An
 * ambiguous convention match (a name that hits more than one catalog entry)
 * surfaces a {@link ResolveResult.warnings | warning} and leaves the component
 * unresolved rather than guessing — never a crash.
 */
import type { Correspondence, DesignMap, DesignSource } from "@design-parity/core";
import { entryRefs, findByCode } from "@design-parity/core";

/**
 * Figma Code Connect links, indexed by code handle.
 *
 * In CI this is materialized by the Code Connect CLI (`figma connect`) into a
 * committed artifact; the resolver only reads it, so it stays deterministic and
 * free of any live Figma call. Keys are code handles
 * (`"ui/Button.kt#PrimaryButton"`); values are Figma refs
 * (`"figma:<fileKey>/<nodeId>"`).
 */
export type CodeConnectIndex = Record<string, string>;

/**
 * One entry in the design catalog used for last-resort name convention
 * matching: a component the design source exposes, keyed by its source-side
 * `name`.
 */
export interface DesignCatalogEntry {
  source: DesignSource;
  /** Source-specific reference handle passed to the adapter. */
  ref: string;
  /** Component name as the source names it, e.g. `"PrimaryButton"`. */
  name: string;
}

/** The committed inputs a resolution runs against. All optional. */
export interface ResolverInputs {
  /** Figma Code Connect links (highest precedence). */
  codeConnect?: CodeConnectIndex;
  /** The repo's `design-map.json`, already loaded and validated. */
  designMap?: DesignMap;
  /** Known design components for last-resort name convention matching. */
  catalog?: DesignCatalogEntry[];
}

/** Outcome of resolving one code component. */
export interface ComponentResolution {
  /** The resolved link, or `undefined` when nothing matched. */
  correspondence?: Correspondence;
  /** Non-fatal diagnostics (e.g. an ambiguous convention match). */
  warnings: string[];
}

/** Outcome of resolving a batch of code components. */
export interface ResolveResult {
  /** One resolved link per component that matched a reference. */
  correspondences: Correspondence[];
  /** Code handles that no source could resolve. */
  unresolved: string[];
  /** Non-fatal diagnostics aggregated across the batch. */
  warnings: string[];
}

/**
 * The member name from a code handle (`"ui/Button.kt#PrimaryButton"` →
 * `"PrimaryButton"`). Handles lack a `#` are used whole.
 */
function memberName(code: string): string {
  const hash = code.lastIndexOf("#");
  return hash === -1 ? code : code.slice(hash + 1);
}

/**
 * Fold a component name to a comparison key: lowercase, separators stripped, so
 * `"PrimaryButton"`, `"primary_button"`, and `"Primary Button"` all collide.
 */
function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve a single code component to its design reference.
 *
 * Precedence is Code Connect → manifest → convention; the first hit wins. A
 * convention name that matches more than one catalog entry is reported as a
 * warning and left unresolved (we don't guess between equally good matches).
 */
export function resolveComponent(
  code: string,
  inputs: ResolverInputs,
): ComponentResolution {
  // 1. Code Connect — Figma's machine link, highest confidence.
  const ccRef = inputs.codeConnect?.[code];
  if (ccRef !== undefined) {
    return {
      correspondence: {
        code,
        source: "figma",
        ref: ccRef,
        linkMethod: "code-connect",
        confidence: "high",
      },
      warnings: [],
    };
  }

  // 2. design-map.json — the committed manifest. A list `ref` binds several
  // variant-tagged nodes; the primary (first) is the structure node and the
  // full list is carried for the orchestrator to resolve and merge.
  const entry = inputs.designMap ? findByCode(inputs.designMap, code) : undefined;
  if (entry) {
    const variants = entryRefs(entry);
    const multi = Array.isArray(entry.ref);
    return {
      correspondence: {
        code,
        source: entry.source,
        ref: variants[0]!.ref,
        ...(multi ? { refs: variants } : {}),
        linkMethod: "manifest",
        confidence: "high",
      },
      warnings: [],
    };
  }

  // 3. convention — best-effort name match, always low confidence.
  const catalog = inputs.catalog ?? [];
  if (catalog.length > 0) {
    const key = nameKey(memberName(code));
    const matches = catalog.filter((c) => nameKey(c.name) === key);

    if (matches.length === 1) {
      const match = matches[0]!;
      return {
        correspondence: {
          code,
          source: match.source,
          ref: match.ref,
          linkMethod: "convention",
          confidence: "low",
        },
        warnings: [],
      };
    }

    if (matches.length > 1) {
      const refs = matches.map((m) => `${m.source}:${m.ref}`).join(", ");
      return {
        correspondence: undefined,
        warnings: [
          `convention: '${code}' matches ${matches.length} catalog entries (${refs}); ` +
            `add a design-map.json entry to disambiguate`,
        ],
      };
    }
  }

  // Nothing matched.
  return { correspondence: undefined, warnings: [] };
}

/**
 * Resolve a batch of changed code components, preserving input order.
 *
 * Matched components land in {@link ResolveResult.correspondences}; everything
 * else (no match, or an ambiguous convention match) lands in
 * {@link ResolveResult.unresolved} with any warnings aggregated.
 */
export function resolve(codes: string[], inputs: ResolverInputs): ResolveResult {
  const correspondences: Correspondence[] = [];
  const unresolved: string[] = [];
  const warnings: string[] = [];

  for (const code of codes) {
    const { correspondence, warnings: w } = resolveComponent(code, inputs);
    warnings.push(...w);
    if (correspondence) {
      correspondences.push(correspondence);
    } else {
      unresolved.push(code);
    }
  }

  return { correspondences, unresolved, warnings };
}
