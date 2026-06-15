/**
 * Convention seeding for the starter `design-map.json`.
 *
 * A greenfield repo has no design source to link against, so the committed
 * `design-map.json` is emitted as a valid, empty scaffold. The value here is the
 * *review list*: a best-effort, name-convention scan of the repo's UI
 * components, every entry flagged low-confidence, that a human wires to a design
 * reference once they adopt a design tool. This is the same convention matching
 * the resolver (#7) does; baseline runs a lightweight in-package version until
 * that package is available.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import type { DesignMap, DesignMapEntry, DesignSource } from "@design-parity/core";

/** One UI component discovered in the repo, by name convention or annotation. */
export interface DiscoveredComponent {
  /** Code handle in `design-map` form, e.g. `ui/Button.kt#PrimaryButton`. */
  code: string;
  /** The component symbol, e.g. `PrimaryButton`. */
  symbol: string;
  /** Repo-relative source file. */
  file: string;
  /**
   * The design ref the code authored next to the component — a `@DesignRef("…")`
   * annotation or a `design-ref:` comment. When present the binding is explicit,
   * so {@link seedDesignMap} emits a real manifest entry instead of a review item.
   */
  ref?: string;
  /** `high` when the code authored a ref; `low` for a name-convention match. */
  confidence: "low" | "high";
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".gradle",
  ".idea",
  "vendor",
  "coverage",
  "test",
  "tests",
  "__tests__",
]);

const MAX_DEPTH = 8;
const MAX_FILES = 2000;

/** Per-extension convention matchers producing capitalized component symbols. */
const MATCHERS: Array<{ ext: RegExp; symbols: RegExp[] }> = [
  {
    // Jetpack Compose / Compose Multiplatform.
    ext: /\.kt$/,
    symbols: [/@Composable[\s\S]{0,200}?\bfun\s+([A-Z]\w*)\s*\(/g],
  },
  {
    // React / Compose-for-Web style function & const components.
    ext: /\.[jt]sx$/,
    symbols: [
      /export\s+(?:default\s+)?function\s+([A-Z]\w*)\s*\(/g,
      /export\s+const\s+([A-Z]\w*)\s*[:=]\s*(?:\([^)]*\)|[A-Za-z]\w*)\s*=>/g,
    ],
  },
  {
    // SwiftUI views.
    ext: /\.swift$/,
    symbols: [/\bstruct\s+([A-Z]\w*)\s*:\s*[^{]*\bView\b/g],
  },
];

/**
 * Scan `repoRoot` for UI components by name convention. Deterministic: results
 * are sorted by code handle and de-duplicated.
 */
export async function discoverCodeComponents(
  repoRoot: string,
): Promise<DiscoveredComponent[]> {
  const found = new Map<string, DiscoveredComponent>();
  const budget = { files: 0 };
  await walk(repoRoot, repoRoot, 0, budget, found);
  return [...found.values()].sort((a, b) => a.code.localeCompare(b.code));
}

async function walk(
  repoRoot: string,
  dir: string,
  depth: number,
  budget: { files: number },
  out: Map<string, DiscoveredComponent>,
): Promise<void> {
  if (depth > MAX_DEPTH || budget.files >= MAX_FILES) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (budget.files >= MAX_FILES) return;
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      await walk(repoRoot, full, depth + 1, budget, out);
      continue;
    }
    if (!entry.isFile()) continue;

    const matcher = MATCHERS.find((m) => m.ext.test(entry.name));
    if (!matcher) continue;

    budget.files += 1;
    let text: string;
    try {
      text = await readFile(full, "utf8");
    } catch {
      continue;
    }

    const rel = relative(repoRoot, full);
    const markers = extractRefMarkers(text);
    const hits = extractSymbolHits(text, matcher.symbols);
    const symbolIndexes = hits.map((h) => h.index);
    for (const hit of hits) {
      const code = `${rel}#${hit.symbol}`;
      if (out.has(code)) continue;
      const ref = nearestPrecedingRef(hit.index, markers, symbolIndexes);
      out.set(
        code,
        ref
          ? { code, symbol: hit.symbol, file: rel, ref, confidence: "high" }
          : { code, symbol: hit.symbol, file: rel, confidence: "low" },
      );
    }
  }
}

interface SymbolHit {
  symbol: string;
  index: number;
}

function extractSymbolHits(text: string, patterns: RegExp[]): SymbolHit[] {
  const hits: SymbolHit[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[1]) hits.push({ symbol: m[1], index: m.index });
    }
  }
  return hits;
}

/** How far before a component a `design-ref` marker may sit (annotations, KDoc). */
const REF_WINDOW = 300;

/** A `@DesignRef("…")` annotation or a `design-ref:` comment, any language. */
const REF_MARKERS: RegExp[] = [
  /@DesignRef\s*\(\s*"([^"]+)"\s*\)/g,
  /(?:\/\/|\*|#)\s*@?design-ref[:=\s]\s*(\S+)/gi,
];

interface RefMarker {
  ref: string;
  index: number;
}

function extractRefMarkers(text: string): RefMarker[] {
  const markers: RefMarker[] = [];
  for (const pattern of REF_MARKERS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[1]) markers.push({ ref: m[1], index: m.index });
    }
  }
  return markers;
}

/**
 * The `design-ref` marker bound to the component at `symbolIndex`: the closest
 * marker just before it within the window, but only when no *other* component
 * sits between them (a marker binds to the component it immediately precedes).
 */
function nearestPrecedingRef(
  symbolIndex: number,
  markers: RefMarker[],
  symbolIndexes: number[],
): string | undefined {
  let best: RefMarker | undefined;
  for (const marker of markers) {
    if (marker.index >= symbolIndex) continue;
    if (symbolIndex - marker.index > REF_WINDOW) continue;
    if (!best || marker.index > best.index) best = marker;
  }
  if (!best) return undefined;
  // Reject if another component declaration sits between the marker and this one.
  if (symbolIndexes.some((idx) => idx > best!.index && idx < symbolIndex)) {
    return undefined;
  }
  return best.ref;
}

/**
 * Build the starter design-map. Components that authored a `@DesignRef` become
 * real, schema-valid entries (the code references its design element); the rest
 * stay review items in the bootstrap report. With no authored refs the manifest
 * is an empty scaffold, as before. The `$schema` points at the schema shipped by
 * `@design-parity/core` so editors validate the file in-place.
 */
export function seedDesignMap(
  discovered: DiscoveredComponent[] = [],
): DesignMap {
  const components: DesignMapEntry[] = discovered
    .filter((c): c is DiscoveredComponent & { ref: string } => c.ref !== undefined)
    .map((c) => ({ code: c.code, source: inferSource(c.ref), ref: c.ref }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return {
    $schema:
      "./node_modules/@design-parity/core/schema/design-map.schema.json",
    components,
  };
}

/** Infer the design source from an authored ref's shape. */
function inferSource(ref: string): DesignSource {
  if (ref.startsWith("figma:") || /figma\.com/.test(ref)) return "figma";
  if (ref.startsWith("stitch:")) return "stitch";
  if (/\.html?(?:$|[?#])/i.test(ref)) return "claude-design";
  return "bundle";
}
