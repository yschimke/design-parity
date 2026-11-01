/**
 * rc-vendored-webfonts.mjs — answer the TypeScript player's Google Fonts requests from the vendored
 * font directory, for the families that directory carries.
 *
 * A document that names `google:<Family>` makes the player fetch a stylesheet from the Google Fonts
 * CSS API and then the font file it points at. What comes back is not fixed: the same request is
 * sometimes answered with the static `/s/<family>/v<N>/….woff2` file and sometimes with a
 * dynamically built `/l/font?kit=…` one, and the two rasterize differently — by one pixel on the
 * `typeface_variable_weight` specimen, which is enough for two runs of the same catalog to disagree
 * and for `rc-cmp-wasm-compare-concurrency.test.mjs` to fail on a change that touched nothing. A
 * parity lane that scores whatever a CDN served that minute cannot tell a regression from noise.
 *
 * The vendored directory already holds those families as the files the other lanes render with:
 * its `fonts.json` lists the catalog's default family and its `named` Google Fonts (see the
 * directory's README — the CMP/Wasm player reads the same manifest and never fetches, and the
 * Android player reads the directory as its Google Fonts cache). Serving the `rc` lane from them
 * makes it deterministic and puts it on the same bytes as its neighbours. A family the directory
 * does not carry still goes to the network, exactly as before, so no document loses a face it used
 * to get.
 */
import fs from "node:fs";
import path from "node:path";

const CSS_API = /^https:\/\/fonts\.googleapis\.com\/css2\?/;
// Never requested by anything but the stylesheets below, so it cannot shadow a real file.
const FILE_ORIGIN = "https://fonts.gstatic.com/__rc-compare-vendored__/";

/**
 * The `default`- and `named`-role families in [dir]'s `fonts.json`, keyed by lowercased family name,
 * each with its distinct files. The `generic` roles (`serif`, `monospace`) are generic CSS families,
 * not Google Fonts names, and are left out. A directory without a manifest yields an empty map.
 */
export function vendoredWebFontFamilies(dir) {
  const families = new Map();
  const manifest = dir && path.join(dir, "fonts.json");
  if (!manifest || !fs.existsSync(manifest)) return families;
  for (const family of JSON.parse(fs.readFileSync(manifest, "utf8")).families ?? []) {
    if (!["default", "named"].includes(family.role ?? "default") || !family.name) continue;
    const byFile = new Map();
    for (const font of family.fonts ?? []) {
      const file = path.join(dir, font.file);
      if (path.dirname(file) !== path.resolve(dir) || !fs.existsSync(file)) continue;
      const key = `${font.file}|${font.style ?? "normal"}`;
      const entry = byFile.get(key) ?? { file: font.file, style: font.style ?? "normal", weights: [] };
      entry.weights.push(font.weight ?? 400);
      byFile.set(key, entry);
    }
    if (byFile.size > 0) families.set(family.name.toLowerCase(), { name: family.name, files: [...byFile.values()] });
  }
  return families;
}

/**
 * The `font-weight` / `font-stretch` ranges a variable font's `fvar` table declares, or `{}` for a
 * static font (or one this cannot read). These are what the Google Fonts API itself puts on a ranged
 * face, and what lets CSS apply a document's axis values instead of clamping them.
 */
export function fvarDescriptors(bytes) {
  try {
    const u16 = (o) => bytes.readUInt16BE(o);
    const u32 = (o) => bytes.readUInt32BE(o);
    const tag = (o) => bytes.toString("latin1", o, o + 4);
    let fvar = -1;
    for (let i = 0, n = u16(4); i < n; i++) {
      if (tag(12 + i * 16) === "fvar") fvar = u32(12 + i * 16 + 8);
    }
    if (fvar < 0) return {};
    const descriptors = {};
    const axesOffset = u16(fvar + 4);
    const count = u16(fvar + 8);
    const size = u16(fvar + 10);
    for (let i = 0; i < count; i++) {
      const axis = fvar + axesOffset + i * size;
      const min = bytes.readInt32BE(axis + 4) / 65536;
      const max = bytes.readInt32BE(axis + 12) / 65536;
      if (tag(axis) === "wght") descriptors.weight = `${min} ${max}`;
      if (tag(axis) === "wdth") descriptors.stretch = `${min}% ${max}%`;
    }
    return descriptors;
  } catch {
    return {};
  }
}

/** The `@font-face` rules for one vendored family, every face pointing at [FILE_ORIGIN]. */
function familyCss({ name, files }, dir) {
  return files
    .map(({ file, style, weights }) => {
      const { weight, stretch } = fvarDescriptors(fs.readFileSync(path.join(dir, file)));
      const declared = weight ?? (weights.length === 1 ? String(weights[0]) : `${Math.min(...weights)} ${Math.max(...weights)}`);
      return (
        `@font-face{font-family:'${name.replace(/'/g, "\\'")}';font-style:${style};font-weight:${declared};` +
        (stretch ? `font-stretch:${stretch};` : "") +
        `font-display:block;src:url(${FILE_ORIGIN}${encodeURIComponent(file)}) format('truetype');}`
      );
    })
    .join("");
}

/**
 * Route [page]'s Google Fonts requests for the families [dir] carries to those files. Returns the
 * family names it will serve (empty when [dir] has no manifest, in which case nothing is routed).
 */
export async function routeVendoredWebFonts(page, dir) {
  const families = vendoredWebFontFamilies(dir);
  if (families.size === 0) return [];
  const css = new Map([...families].map(([key, family]) => [key, familyCss(family, dir)]));
  await page.route(CSS_API, (route) => {
    const spec = new URL(route.request().url()).searchParams.get("family") ?? "";
    const body = css.get(spec.split(":")[0].trim().toLowerCase());
    if (body === undefined) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "text/css",
      headers: { "access-control-allow-origin": "*" },
      body,
    });
  });
  await page.route(`${FILE_ORIGIN}**`, (route) => {
    const file = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop());
    const known = [...families.values()].some((f) => f.files.some((entry) => entry.file === file));
    if (!known) return route.fulfill({ status: 404 });
    return route.fulfill({
      status: 200,
      contentType: "font/ttf",
      headers: { "access-control-allow-origin": "*" },
      body: fs.readFileSync(path.join(dir, file)),
    });
  });
  return [...families.values()].map((f) => f.name);
}
