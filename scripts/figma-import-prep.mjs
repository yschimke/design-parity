#!/usr/bin/env node
/**
 * Prepare a design-artifact catalog for import into Figma.
 *
 * The code→Figma import has one deterministic half (fetch the published
 * catalog, download its render PNGs, and shape them into a board model) and one
 * agent-driven half (upload the PNGs via the Figma MCP `upload_assets` tool and
 * lay the board out with `use_figma`). This script owns the deterministic half
 * so the agent session (e.g. the weekly re-import trigger) does the minimum,
 * error-prone work. See docs/design-artifacts/FIGMA_IMPORT.md for the full
 * playbook.
 *
 *   node scripts/figma-import-prep.mjs \
 *     --repo   yschimke/meshcore-mobile \
 *     --branch design-artifacts/meshcore-mobile \
 *     --out    .figma-import/meshcore-mobile \
 *     [--sha   <pin a specific commit; default: branch HEAD>]
 *
 * Writes under --out:
 *   images/<...>.png   every render referenced by the catalog
 *   board.json         { meta, groups:[{ name, items:[{ cid, nodeId:null, w, h,
 *                        caption, state, theme, size, live, slug, imagePath }] }] }
 *   order.tsv          one row per component IN CATALOG ORDER:
 *                        <componentId>\t<local image path>\t<slug>
 *
 * `order.tsv` is the POST order: request N upload URLs, then POST images/<slug>
 * to url[i] as multipart (filename = "<slug>.png" so the Figma layer is named),
 * capturing each response's `placedOnNodeId`. Splice those ids into board.json's
 * `nodeId` fields, then hand board.json to `use_figma` to build the sticker
 * sheet. `mesh.sha` in board.json.meta records exactly which commit was pulled.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

const RAW = "https://raw.githubusercontent.com";

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    branch: { type: "string" },
    out: { type: "string" },
    sha: { type: "string" },
  },
});

const repo = values.repo;
const branch = values.branch;
const out = values.out;
if (!repo || !branch || !out) {
  console.error(
    "Usage: figma-import-prep.mjs --repo <owner/name> --branch <design-artifacts/...> --out <dir> [--sha <commit>]",
  );
  process.exit(2);
}

/** Resolve the branch HEAD sha (for provenance) unless one was pinned. */
async function resolveSha() {
  if (values.sha) return values.sha;
  const res = await fetch(`https://api.github.com/repos/${repo}/branches/${encodeURIComponent(branch)}`, {
    headers: { "User-Agent": "design-parity-figma-import-prep" },
  });
  if (!res.ok) {
    // Unauthenticated API may be rate-limited; fall back to the branch ref name.
    // Downloads still work off the branch, we just record the ref instead of a sha.
    return branch;
  }
  const body = await res.json();
  return body?.commit?.sha ?? branch;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "design-parity-figma-import-prep" } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { "User-Agent": "design-parity-figma-import-prep" } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return buf.length;
}

const ref = await resolveSha();
const base = `${RAW}/${repo}/${ref}`;

const catalog = JSON.parse(await fetchText(`${base}/catalog.json`));

const groupsByName = new Map();
const order = [];
let images = 0;

for (const comp of catalog.components ?? []) {
  const im = comp.images?.[0];
  if (!im) continue;
  const slug = im.path.split("/")[1]; // images/<slug>/<file>.png
  const imagePath = join(out, im.path);
  images += await download(`${base}/${im.path}`, imagePath);

  const item = {
    cid: comp.componentId,
    nodeId: null,
    w: im.width,
    h: im.height,
    caption: comp.caption ?? "",
    state: im.state ?? null,
    theme: im.theme ?? null,
    size: im.size ?? null,
    live: im.livePreview ?? null,
    slug,
    imagePath: im.path,
  };
  if (!groupsByName.has(comp.group)) groupsByName.set(comp.group, []);
  groupsByName.get(comp.group).push(item);
  order.push(`${comp.componentId}\t${im.path}\t${slug}`);
}

const board = {
  meta: {
    system: catalog.system,
    title: catalog.title,
    renderer: catalog.renderer,
    generatedAt: catalog.generatedAt,
    source: catalog.source,
    library: catalog.library,
    repo,
    branch,
    sha: ref,
  },
  groups: [...groupsByName].map(([name, items]) => ({ name, items })),
};

await mkdir(out, { recursive: true });
await writeFile(join(out, "board.json"), JSON.stringify(board, null, 2));
await writeFile(join(out, "order.tsv"), order.join("\n") + "\n");

const n = order.length;
console.error(
  `${catalog.system}: ${n} components across ${board.groups.length} groups, ` +
    `${(images / 1024).toFixed(0)} KiB of renders → ${out} (ref ${ref.slice(0, 12)})`,
);
console.error(`Next: request ${n} upload URLs, POST images in order.tsv order, splice placedOnNodeId into board.json.`);
