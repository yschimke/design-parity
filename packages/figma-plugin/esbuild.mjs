/**
 * Bundle the Figma-runtime glue. Two IIFE bundles, no code-splitting (Figma
 * loads a single `code.js` and a single `ui.html`):
 *
 * - `figma/code.ts`  → `dist/plugin/code.js`   (main thread)
 * - `figma/ui.ts`    → inlined into `dist/plugin/ui.html` (UI iframe)
 *
 * Run after `tsc --build` so `@design-parity/*` deps resolve to their `dist`.
 * A tiny resolve shim maps NodeNext-style `./x.js` imports to their `.ts`
 * source so the glue can import the planner from `../src` directly.
 */
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const OUT = "dist/plugin";

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
console.log(`Wrote ${OUT}/code.js and ${OUT}/ui.html`);
