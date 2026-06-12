#!/usr/bin/env node
/**
 * `design-parity-report` — write a self-contained HTML comparison page.
 *
 *   design-parity-report \
 *     --reference figma/button.reference.json \
 *     --candidate candidate/button.candidate.json \
 *     --verdict   out/verdict.json \
 *     --diff default/dark/compact=out/diff-dark.png \
 *     --repo . \
 *     --out report.html
 *
 * Reads a `DesignReference`, a `CandidateRender`, and a `Verdict` (the diff
 * engine's JSON), optionally one or more `key=path.png` diff panels, and writes
 * the rendered HTML to `--out` (or stdout). Handy for demos; the Action wires
 * the same `renderHtmlReport` call in steady state.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { argv, cwd, exit, stderr, stdout } from "node:process";

import type {
  CandidateRender,
  DesignReference,
  Verdict,
} from "@design-parity/core";

import { renderHtmlReport } from "../render.js";
import type { DiffImage } from "../types.js";

interface Args {
  reference?: string;
  candidate?: string;
  verdict?: string;
  repoRoot: string;
  out?: string;
  diffs: Array<{ key: string; path: string }>;
}

function parseArgs(args: string[]): Args {
  const out: Args = { repoRoot: cwd(), diffs: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = (): string => {
      const v = args[(i += 1)];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--reference":
        out.reference = next();
        break;
      case "--candidate":
        out.candidate = next();
        break;
      case "--verdict":
        out.verdict = next();
        break;
      case "--repo":
        out.repoRoot = resolve(next());
        break;
      case "--out":
        out.out = next();
        break;
      case "--diff": {
        const spec = next();
        const eq = spec.indexOf("=");
        if (eq === -1) throw new Error(`--diff expects key=path, got ${spec}`);
        out.diffs.push({ key: spec.slice(0, eq), path: spec.slice(eq + 1) });
        break;
      }
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  return out;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function main(): void {
  const args = parseArgs(argv.slice(2));
  if (!args.reference || !args.candidate || !args.verdict) {
    stderr.write(
      "usage: design-parity-report --reference <json> --candidate <json> --verdict <json> [--diff key=png]... [--repo dir] [--out file]\n",
    );
    exit(2);
  }

  const diffImages: DiffImage[] = args.diffs.map((d) => ({
    key: d.key,
    png: readFileSync(d.path),
  }));

  const html = renderHtmlReport({
    reference: readJson<DesignReference>(args.reference),
    candidate: readJson<CandidateRender>(args.candidate),
    verdict: readJson<Verdict>(args.verdict),
    diffImages,
    repoRoot: args.repoRoot,
  });

  if (args.out) {
    writeFileSync(args.out, html);
    stderr.write(`wrote ${args.out}\n`);
  } else {
    stdout.write(html);
  }
}

main();
