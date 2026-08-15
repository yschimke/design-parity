#!/usr/bin/env node
/**
 * CLI: propose a design reference per code component — interactively.
 *
 *   design-parity-propose-refs --file <fileKey> [subject source] [options]
 *
 * It prints proposals and **writes nothing**. The reference belongs next to the
 * component, in whatever the repo's own correspondence artifact is — an
 * annotation, a `design-map.json` entry — and a human puts it there after
 * reading the table. A kit names components by its own taxonomy (`Button -
 * tonal`, `Connected button group`), which does not always agree with the
 * documented component names, so a high score is a proposal and not a fact.
 *
 * Interactive setup only, like the rest of `baseline`: it needs a Figma token
 * and network, and it produces something a human reviews. Nothing on the
 * unattended Action path calls it.
 */
import { readFile } from "node:fs/promises";
import { argv, env, exit, stdout } from "node:process";

import { FigmaRestClient } from "@design-parity/adapter-figma";

import {
  candidatesFromTree,
  confidenceOf,
  rankCandidates,
  subjectFor,
  subjectsFromPreviewManifest,
  type KitCandidate,
  type PreviewManifestLike,
  type ProposalSubject,
} from "../ref-proposals.js";
import { discoverCodeComponents } from "../seed.js";

interface Args {
  fileKey?: string;
  previews?: string;
  dir?: string;
  subjects: string[];
  limit: number;
  json: boolean;
  help: boolean;
}

const HELP = `design-parity-propose-refs — propose a design reference per code component

Usage:
  design-parity-propose-refs --file <fileKey> [subject source] [options]

Subject sources (pick one; defaults to --dir .):
  --previews <path>   compose-preview manifest (previews.json) — proposes for
                      every catalogued COMPONENT in it
  --dir <path>        scan a repo for UI components by name convention
  --subject <name>    propose for one name; repeatable

Options:
  --file <fileKey>    Design file to search (the segment after /design/ in the URL)
  --limit <n>         Proposals per component (default 3)
  --json              Emit JSON instead of the table
  --help, -h          Show this help

Needs FIGMA_TOKEN (a read-only PAT with file_content:read) or FIGMA_OAUTH_TOKEN.
Prints proposals; writes nothing. Review before pasting a reference anywhere.`;

function parseArgs(args: string[]): Args {
  const out: Args = { subjects: [], limit: 3, json: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = (): string => {
      const v = args[(i += 1)];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--file":
        out.fileKey = next();
        break;
      case "--previews":
        out.previews = next();
        break;
      case "--dir":
        out.dir = next();
        break;
      case "--subject":
        out.subjects.push(next());
        break;
      case "--limit": {
        const n = Number(next());
        if (!Number.isInteger(n) || n < 1) throw new Error("--limit must be a positive integer");
        out.limit = n;
        break;
      }
      case "--json":
        out.json = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        throw new Error(`unknown argument '${a}'`);
    }
  }
  return out;
}

/** Subjects from a convention scan — the greenfield path, same as bootstrap's review list. */
async function subjectsFromRepo(dir: string): Promise<ProposalSubject[]> {
  const discovered = await discoverCodeComponents(dir);
  return discovered.map((c) => ({ label: c.code, text: c.symbol }));
}

async function subjectsFor(args: Args): Promise<ProposalSubject[]> {
  if (args.subjects.length > 0) {
    return args.subjects.map((s) => ({ label: s, text: subjectFor(s) }));
  }
  if (args.previews) {
    const manifest = JSON.parse(await readFile(args.previews, "utf8")) as PreviewManifestLike;
    return subjectsFromPreviewManifest(manifest);
  }
  return subjectsFromRepo(args.dir ?? ".");
}

function figmaClient(): FigmaRestClient {
  const oauthToken = env.FIGMA_OAUTH_TOKEN;
  const token = env.FIGMA_TOKEN;
  if (!oauthToken && !token) {
    throw new Error(
      "no Figma credentials — set FIGMA_TOKEN (a read-only PAT with file_content:read) or FIGMA_OAUTH_TOKEN",
    );
  }
  return new FigmaRestClient(oauthToken ? { oauthToken } : { token });
}

/**
 * Every component in the file, by whichever of two routes works.
 *
 * `/components` is exact and one request, but only returns what the file itself
 * PUBLISHES — a community duplicate subscribes to the original library instead
 * of republishing it, and then returns nothing. The tree walk always works and
 * costs a request per page, so it is the fallback rather than the default.
 *
 * The walk is exactly the shape that trips Figma's per-token limiter: one large
 * request per page, back to back. It is not paced here because the REST client
 * already retries a 429 honouring `Retry-After` — a walk that is most of the
 * way done should wait, not be thrown away.
 */
async function kitCandidates(
  client: FigmaRestClient,
  fileKey: string,
  log: (line: string) => void,
): Promise<KitCandidate[]> {
  const published = await client.getFileComponents(fileKey);
  const components = published.meta?.components ?? [];
  if (components.length > 0) {
    log(`Resolved ${components.length} published component(s) from ${fileKey}.`);
    return components.map((c) => ({
      name: c.name,
      nodeId: c.node_id,
      containing: c.containing_frame?.name ?? "",
    }));
  }

  log(`${fileKey} publishes no components; walking the file tree.`);
  const file = await client.getFilePages(fileKey);
  const pages = file.document.children ?? [];
  log(`Walking ${pages.length} page(s).`);

  const found: KitCandidate[] = [];
  const failed: string[] = [];
  for (const [i, page] of pages.entries()) {
    let root;
    try {
      // depth=3 reaches the component sets sitting inside a page's sections and
      // frames — where a kit puts them — without dragging every variant's inner
      // layers down the wire.
      const nodes = await client.getFileNodes(fileKey, [page.id], { depth: 3 });
      root = nodes.nodes[page.id]?.document;
    } catch (err) {
      // One unreachable page shouldn't discard the pages that did resolve: a
      // partial proposal list is useful, and the summary names what is missing.
      log(`  page "${page.name}" failed: ${(err as Error).message.slice(0, 120)}`);
      failed.push(page.name);
      continue;
    }
    log(`  [${i + 1}/${pages.length}] ${page.name}`);
    if (root) found.push(...candidatesFromTree(root));
  }
  if (failed.length > 0) {
    log(`\nWARNING: ${failed.length} page(s) did not resolve: ${failed.join(", ")}`);
    log("Components living only on those pages will show as LOW / no candidate.");
  }
  log(`Found ${found.length} component(s) by tree walk.`);
  return found;
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    console.error("\n" + HELP);
    return 2;
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (!args.fileKey) {
    console.error("--file <fileKey> is required.\n\n" + HELP);
    return 2;
  }

  // In `--json` mode the progress commentary would corrupt the document, so it
  // goes to stderr and stdout carries the result alone.
  const log = (line: string): void => {
    if (args.json) console.error(line);
    else console.log(line);
  };

  const subjects = await subjectsFor(args);
  if (subjects.length === 0) {
    console.error("No components to propose for. Pass --previews, --dir or --subject.");
    return 1;
  }

  const candidates = await kitCandidates(figmaClient(), args.fileKey, log);

  const results = subjects.map((subject) => {
    const ranked = rankCandidates(subject.text, candidates, { limit: args.limit });
    return {
      component: subject.label,
      confidence: confidenceOf(ranked[0]),
      reference: ranked[0] ? `figma:${args.fileKey}/${ranked[0].nodeId}` : null,
      proposals: ranked.map((r) => ({
        name: r.name,
        score: Number(r.score.toFixed(2)),
        reference: `figma:${args.fileKey}/${r.nodeId}`,
      })),
    };
  });

  if (args.json) {
    stdout.write(`${JSON.stringify({ file: args.fileKey, components: results }, null, 2)}\n`);
    return 0;
  }

  console.log("");
  for (const result of results) {
    console.log(`${result.confidence.padEnd(5)} ${result.component}`);
    for (const p of result.proposals) {
      console.log(`        ${p.score.toFixed(2)}  ${p.name}  ->  ${p.reference}`);
    }
    console.log(
      result.reference
        ? `        reference = "${result.reference}"`
        : "        (no candidate — nothing in this file plausibly depicts it)",
    );
    console.log("");
  }
  return 0;
}

exit(await main());
