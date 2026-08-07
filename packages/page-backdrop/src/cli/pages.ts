#!/usr/bin/env node
/**
 * `design-parity-pages` — the only way page backdrops ever run.
 *
 *   design-parity-pages status
 *   design-parity-pages import [--repo .] [--config design-pages.json]
 *                              [--code-connect figma.connect.json]
 *                              [--design-map design-map.json]
 *   design-parity-pages view   [--repo .] [--render CODE=render.png]…
 *                              [--source-url CODE=https://…] [--out pages.html]
 *
 * Every subcommand first asks {@link loadPageBackdropConfig} whether the repo
 * opted in, and exits 0 with an explanation when it hasn't — an un-adopted repo
 * running this by accident should be told what the feature is, not handed an
 * error.
 *
 * `import` is the only subcommand that touches the network, and it needs
 * `FIGMA_TOKEN` (personal access token) or `FIGMA_OAUTH_TOKEN`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";

import { loadDesignMap, type DesignMap } from "@design-parity/core";
import { FigmaRestClient, loadCodeConnect } from "@design-parity/adapter-figma";

import {
  CONFIG_FILENAME,
  explainDisabled,
  loadPageBackdropConfig,
  type PageBackdropConfig,
} from "../config.js";
import { figmaRestPageFetcher } from "../fetcher.js";
import { MANIFEST_FILENAME, importPages, parseManifest, writeImport } from "../import.js";
import { codeConnectIndexOf, type LinkInputs } from "../link.js";
import { renderPageBackdropHtml } from "../viewer.js";
import type { PageBackdropManifest } from "../types.js";

interface Args {
  command: string;
  repoRoot: string;
  configPath?: string;
  codeConnect?: string;
  designMap?: string;
  manifest?: string;
  out?: string;
  renders: Array<{ code: string; path: string }>;
  sourceUrls: Array<{ code: string; url: string }>;
}

/** Split a `KEY=VALUE` argument, where VALUE may itself contain `=`. */
function splitPair(raw: string, flag: string): { key: string; value: string } {
  const eq = raw.indexOf("=");
  if (eq <= 0) throw new Error(`${flag} expects CODE=VALUE, got '${raw}'`);
  return { key: raw.slice(0, eq), value: raw.slice(eq + 1) };
}

function parseArgs(args: string[]): Args {
  const out: Args = {
    command: args[0] ?? "status",
    repoRoot: process.cwd(),
    renders: [],
    sourceUrls: [],
  };
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    const next = (): string => {
      const v = args[(i += 1)];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--repo":
        out.repoRoot = resolve(next());
        break;
      case "--config":
        out.configPath = resolve(next());
        break;
      case "--code-connect":
        out.codeConnect = resolve(next());
        break;
      case "--design-map":
        out.designMap = resolve(next());
        break;
      case "--manifest":
        out.manifest = resolve(next());
        break;
      case "--out":
        out.out = resolve(next());
        break;
      case "--render": {
        const { key, value } = splitPair(next(), "--render");
        out.renders.push({ code: key, path: resolve(value) });
        break;
      }
      case "--source-url": {
        const { key, value } = splitPair(next(), "--source-url");
        out.sourceUrls.push({ code: key, url: value });
        break;
      }
      default:
        throw new Error(`unknown argument '${a}'`);
    }
  }
  return out;
}

/** Load the committed correspondence inputs, skipping any the caller omitted. */
async function loadLinkInputs(args: Args): Promise<LinkInputs> {
  const inputs: LinkInputs = {};
  const handles = new Set<string>();

  if (args.codeConnect) {
    const map = await loadCodeConnect(args.codeConnect);
    inputs.codeConnect = codeConnectIndexOf(map);
    for (const code of Object.keys(inputs.codeConnect)) handles.add(code);
  }
  if (args.designMap) {
    const designMap: DesignMap = await loadDesignMap(args.designMap);
    inputs.designMap = designMap;
    for (const entry of designMap.components) handles.add(entry.code);
  }
  // Every handle the repo already names is fair game for the last-resort name
  // match; anything it matches is still reported as low-confidence.
  if (handles.size > 0) inputs.codeHandles = [...handles].sort();
  return inputs;
}

function figmaClient(): FigmaRestClient {
  const oauthToken = env.FIGMA_OAUTH_TOKEN;
  const token = env.FIGMA_TOKEN;
  if (!oauthToken && !token) {
    throw new Error(
      "page-backdrop: no Figma credentials — set FIGMA_TOKEN (personal access token) or FIGMA_OAUTH_TOKEN",
    );
  }
  return new FigmaRestClient(oauthToken ? { oauthToken } : { token });
}

async function runImport(args: Args, config: PageBackdropConfig): Promise<void> {
  const inputs = await loadLinkInputs(args);
  const fetcher = figmaRestPageFetcher(figmaClient());

  const result = await importPages({ config, fetcher, inputs });
  const { manifestPath, imagePaths } = await writeImport(result, config.outDir);

  for (const warning of result.warnings) stderr.write(`warning: ${warning}\n`);

  const total = result.manifest.pages.reduce((n, p) => n + p.placements.length, 0);
  const linked = result.manifest.pages.reduce(
    (n, p) => n + p.placements.filter((x) => x.link !== "unlinked").length,
    0,
  );
  stdout.write(
    `imported ${result.manifest.pages.length} page(s), ${linked}/${total} instances linked\n` +
      `  ${manifestPath}\n` +
      imagePaths.map((p) => `  ${p}\n`).join(""),
  );
}

async function runView(args: Args, config: PageBackdropConfig): Promise<void> {
  const manifestPath = args.manifest ?? join(config.outDir, MANIFEST_FILENAME);
  const manifest: PageBackdropManifest = parseManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );

  const manifestDir = resolve(manifestPath, "..");
  const backdrops = new Map<string, Uint8Array>();
  for (const page of manifest.pages) {
    try {
      backdrops.set(page.id, await readFile(join(manifestDir, page.image.uri)));
    } catch {
      stderr.write(`warning: no backdrop image for page '${page.id}' (${page.image.uri})\n`);
    }
  }

  const renders = new Map<string, Uint8Array>();
  for (const { code, path } of args.renders) renders.set(code, await readFile(path));

  const sourceUrls = new Map<string, string>();
  for (const { code, url } of args.sourceUrls) sourceUrls.set(code, url);

  const html = renderPageBackdropHtml({
    manifest,
    backdrops,
    renders,
    sourceUrls,
    overlay: config.overlay,
  });

  const outPath = args.out ?? join(config.outDir, "pages.html");
  await writeFile(outPath, html, "utf8");
  stdout.write(`wrote ${outPath}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(argv.slice(2));

  const location = args.configPath
    ? { configPath: args.configPath }
    : { repoRoot: args.repoRoot };
  const status = await loadPageBackdropConfig(location);
  const configLabel = args.configPath ? basename(args.configPath) : CONFIG_FILENAME;

  if (!status.enabled) {
    // Not an error: an un-adopted repo is the expected default.
    stdout.write(`${explainDisabled(status, configLabel)}\n`);
    return;
  }

  switch (args.command) {
    case "status": {
      const c = status.config;
      stdout.write(
        `page backdrops are ON (${c.configPath})\n` +
          `  file:    ${c.fileKey}\n` +
          `  pages:   ${c.pages.map((p) => p.id ?? p.nodeId).join(", ")}\n` +
          `  out:     ${c.outDir}\n` +
          `  overlay: ${c.overlay.enabled ? "on" : "off"} by default, ${Math.round(c.overlay.opacity * 100)}% ${c.overlay.blend}\n`,
      );
      return;
    }
    case "import":
      await runImport(args, status.config);
      return;
    case "view":
      await runView(args, status.config);
      return;
    default:
      throw new Error(`unknown command '${args.command}' (expected status, import, or view)`);
  }
}

main().catch((err: unknown) => {
  stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  exit(1);
});
