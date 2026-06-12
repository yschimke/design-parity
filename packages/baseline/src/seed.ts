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

import type { DesignMap } from "@design-parity/core";

/** One UI component discovered by name convention. Always low confidence. */
export interface DiscoveredComponent {
  /** Code handle in `design-map` form, e.g. `ui/Button.kt#PrimaryButton`. */
  code: string;
  /** The component symbol, e.g. `PrimaryButton`. */
  symbol: string;
  /** Repo-relative source file. */
  file: string;
  /** Convention matches are always low confidence (Correspondence contract). */
  confidence: "low";
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
    for (const symbol of extractSymbols(text, matcher.symbols)) {
      const code = `${rel}#${symbol}`;
      if (!out.has(code)) {
        out.set(code, { code, symbol, file: rel, confidence: "low" });
      }
    }
  }
}

function extractSymbols(text: string, patterns: RegExp[]): Set<string> {
  const symbols = new Set<string>();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[1]) symbols.add(m[1]);
    }
  }
  return symbols;
}

/**
 * Build the starter design-map. A greenfield repo has no design source, so the
 * committed manifest is an empty scaffold; the discovered components live in the
 * bootstrap report as review items. The `$schema` points at the schema shipped
 * by `@design-parity/core` so editors validate the file in-place.
 */
export function seedDesignMap(): DesignMap {
  return {
    $schema:
      "./node_modules/@design-parity/core/schema/design-map.schema.json",
    components: [],
  };
}
