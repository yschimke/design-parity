/**
 * Bundle the Figma-runtime glue. Two IIFE bundles, no code-splitting (Figma
 * loads a single `code.js` and a single `ui.html`):
 *
 * - `figma/code.ts`  → `figma/dist/plugin/code.js`   (main thread)
 * - `figma/ui.ts`    → inlined into `figma/dist/plugin/ui.html` (UI iframe)
 *
 * It also writes a flattened `figma/dist/plugin/manifest.json` (entrypoints
 * `./code.js` / `./ui.html`) so `dist/plugin/` is a *self-contained* bundle: a
 * user can grab that one folder — no repo, no `npm`, no build — and Import
 * plugin from manifest… straight into their local Figma. (The source
 * `figma/manifest.json` stays the dev entrypoint, pointing at `./dist/plugin`.)
 *
 * Run after `tsc --build` so `@design-parity/*` deps resolve to their `dist`.
 * A tiny resolve shim maps NodeNext-style `./x.js` imports to their `.ts`
 * source so the glue can import the planner from `../src` directly.
 */
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Figma requires manifest entrypoints to live in the manifest directory or one
// of its subdirectories, so the plugin bundle is emitted under `figma/`.
const OUT = "figma/dist/plugin";

const tsResolve = {
  name: "ts-resolve",
  setup(b) {
    b.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.path.startsWith(".")) return null;
      const ts = resolve(args.resolveDir, args.path).replace(/\.js$/, ".ts");
      return existsSync(ts) ? { path: ts } : null;
    });
  },
};

const common = {
  bundle: true,
  format: "iife",
  target: "es2017",
  plugins: [tsResolve],
  logLevel: "info",
};

await mkdir(OUT, { recursive: true });

await build({ ...common, entryPoints: ["figma/code.ts"], outfile: `${OUT}/code.js` });

const ui = await build({ ...common, entryPoints: ["figma/ui.ts"], write: false });
const html = await readFile("figma/ui.html", "utf8");
await writeFile(
  `${OUT}/ui.html`,
  `${html}\n<script>\n${ui.outputFiles[0].text}\n</script>\n`,
);

// Flatten the manifest so the emitted folder stands alone: entrypoints point at
// their siblings, not back through `dist/plugin`. Everything else (network
// allowlist, editorType, …) is carried through unchanged.
const manifest = JSON.parse(await readFile("figma/manifest.json", "utf8"));
await writeFile(
  `${OUT}/manifest.json`,
  JSON.stringify({ ...manifest, main: "./code.js", ui: "./ui.html" }, null, 2) + "\n",
);
console.log(`Wrote ${OUT}/{manifest.json,code.js,ui.html} — importable as-is`);
