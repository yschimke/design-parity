/**
 * `design-parity reverse` core — the design→code lookup (issue #78 Phase 4).
 *
 * Inverts the committed `design-map.json` (every node of a multi-node binding
 * included) so a design ref can answer "what code implements me?" — the direction
 * a source without Code Connect (Stitch, Claude Design, bundle) otherwise lacks.
 * Pure and offline apart from reading the manifest; the CLI entry
 * (`cli/reverse.ts`) wires this to `process` so the logic stays testable.
 */
import { join, resolve as resolvePath } from "node:path";

import { loadDesignMap } from "@design-parity/core";
import { buildReverseIndex, codeForRef } from "@design-parity/resolver";

/** Output sink, injected so the CLI entry owns `process.stdout`/`stderr`. */
export interface ReverseIO {
  out: (line: string) => void;
  err: (line: string) => void;
}

interface Args {
  repoRoot: string;
  ref?: string;
}

function parseArgs(args: string[], cwd: string): Args {
  const out: Args = { repoRoot: cwd };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[(i += 1)];
    switch (a) {
      case "reverse":
        break;
      case "--repo":
        out.repoRoot = resolvePath(next() ?? ".");
        break;
      default:
        if (a && !a.startsWith("--") && out.ref === undefined) out.ref = a;
    }
  }
  return out;
}

/**
 * Run the reverse lookup. With a `ref` arg it prints the code handle(s) that
 * implement it; with none it dumps the whole `ref → code` map, sorted.
 *
 * Returns the process exit code: 0 found (or full dump), 1 the ref maps to
 * nothing, 2 no readable `design-map.json`.
 */
export async function runReverse(
  args: string[],
  io: ReverseIO,
  cwd: string,
): Promise<number> {
  const { repoRoot, ref } = parseArgs(args, cwd);

  let designMap;
  try {
    designMap = await loadDesignMap(join(repoRoot, "design-map.json"));
  } catch {
    io.err(`design-parity reverse: no readable design-map.json in ${repoRoot}`);
    return 2;
  }

  const index = buildReverseIndex(designMap);

  if (ref) {
    const codes = codeForRef(index, ref);
    if (codes.length === 0) {
      io.err(`no code maps to '${ref}'`);
      return 1;
    }
    io.out(codes.join("\n"));
    return 0;
  }

  // No ref → dump the whole map, sorted by ref for a stable, greppable listing.
  const refs = [...index.keys()].sort();
  if (refs.length === 0) {
    io.out("(no refs in design-map.json)");
    return 0;
  }
  for (const r of refs) io.out(`${r}\t${codeForRef(index, r).join(", ")}`);
  return 0;
}
