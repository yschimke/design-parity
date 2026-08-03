/**
 * Regenerate the golden preview-bundle polyglot fixture (reproducible, no
 * network). Run from anywhere:
 *
 *   node packages/candidate/test/fixtures/gen-bundle.mjs
 *
 * It writes:
 *   - preview-bundle.png   the PNG+zip polyglot (cover PNG + appended bundle zip)
 *   - expected-candidate.json   the golden CandidateRender the reader must emit
 *
 * The bundle mirrors a compose-ai-tools portable preview bundle (issue #38):
 * bundle.json + previews.json + previews/<id>.png + previews/<id>.semantics.json.
 * The semantics blob follows the #38 "Update: a11y tree will be added" contract.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { zlibSync, zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));

// --- tiny PNG encoder (8-bit RGB, single solid colour) ---------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32(n) {
  return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}
function chunk(type, data) {
  const t = new TextEncoder().encode(type);
  const body = new Uint8Array(t.length + data.length);
  body.set(t, 0);
  body.set(data, t.length);
  return concat([u32(data.length), body, u32(crc32(body))]);
}
function concat(arrs) {
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
function png(w, h, [r, g, b]) {
  const sig = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const ihdr = concat([u32(w), u32(h), Uint8Array.of(8, 2, 0, 0, 0)]);
  const row = new Uint8Array(1 + w * 3);
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = r;
    row[1 + x * 3 + 1] = g;
    row[1 + x * 3 + 2] = b;
  }
  const raw = new Uint8Array(row.length * h);
  for (let y = 0; y < h; y++) raw.set(row, y * row.length);
  // PNG IDAT carries a zlib-wrapped deflate stream (header + Adler-32), which
  // is what conformant decoders (pngjs, used by the diff engine) expect.
  const idat = zlibSync(raw, { level: 9 });
  return concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
}

// --- fixture content -------------------------------------------------------
const ID = "ui.Button.PrimaryButton"; // filename-safe bundle id
const RAW_ID = "ui.Button.Primary Button"; // canonical discovery/design-map id

const lightPng = png(160, 48, [0x64, 0x5a, 0xff]);
const darkPng = png(160, 48, [0x7a, 0x72, 0xf0]);
const coverPng = png(8, 8, [0x00, 0x00, 0x00]); // small cover up front

// Semantics blob per the #38 contract: role/label + bounds (dp) + tokens with
// a fg/bg colour pair per theme and typography, so contrast + a11y + i18n run.
const lightSemantics = {
  theme: "light",
  root: {
    role: "button",
    label: "Continue",
    bounds: { x: 0, y: 0, width: 160, height: 48 },
    tokens: {
      spacing: { padding: 16 },
      radius: { corner: 8 },
      colors: {
        label: "#FFFFFF",
        "container.light": "#645AFF",
        "container.dark": "#8A82FF",
      },
      typography: {
        label: { fontFamily: "Roboto", fontSize: 14, fontWeight: 500, lineHeight: 20 },
      },
    },
    children: [
      {
        role: "text",
        label: "Continue",
        bounds: { x: 16, y: 14, width: 128, height: 20 },
        // Per-node v6 typography with a resolved face *path* — the reader must
        // normalize it to the display family ("fonts/SpaceGrotesk.ttf" → "Space
        // Grotesk") so the candidate reads like the reference (issue: bundle path).
        typography: { fontFamily: "fonts/SpaceGrotesk.ttf", fontSize: "14.0sp", fontWeight: 500, lineHeight: "20.0sp" },
      },
    ],
  },
};
const darkSemantics = {
  ...lightSemantics,
  theme: "dark",
};

const previews = {
  schema: 4,
  module: "app",
  variant: "debug",
  previews: [
    {
      id: ID,
      functionName: "PrimaryButton",
      className: "ui.Button",
      sourceFile: "ui/Button.kt",
      params: { uiMode: 0x10, widthDp: 160, heightDp: 48, state: "default" },
      captures: [
        {
          id: "light",
          image: `previews/${ID}.light.png`,
          semantics: `previews/${ID}.light.semantics.json`,
          params: { uiMode: 0x10 },
        },
        {
          id: "dark",
          image: `previews/${ID}.dark.png`,
          semantics: `previews/${ID}.dark.semantics.json`,
          params: { uiMode: 0x20 },
        },
      ],
    },
  ],
};

const manifest = {
  schemaVersion: 4,
  previewIds: [ID],
  rawPreviewIds: [RAW_ID],
  coverPreviewId: ID,
  classpath: ["classes/app.jar"],
};

const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 2));

const zip = zipSync(
  {
    "bundle.json": enc(manifest),
    "previews.json": enc(previews),
    [`previews/${ID}.light.png`]: lightPng,
    [`previews/${ID}.dark.png`]: darkPng,
    [`previews/${ID}.light.semantics.json`]: enc(lightSemantics),
    [`previews/${ID}.dark.semantics.json`]: enc(darkSemantics),
  },
  { level: 0 },
);

// Polyglot: cover PNG up front, bundle zip appended. fflate.unzipSync reads the
// whole-file bytes via the EOCD scan.
const polyglot = concat([coverPng, zip]);
await writeFile(join(here, "preview-bundle.png"), polyglot);

// Golden CandidateRender the reader must produce.
const dataUri = (bytes) =>
  `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
const expected = {
  componentId: ID,
  functionName: "PrimaryButton",
  images: [
    { state: "default", theme: "light", size: "compact", uri: dataUri(lightPng), width: 160, height: 48 },
    { state: "default", theme: "dark", size: "compact", uri: dataUri(darkPng), width: 160, height: 48 },
  ],
  semantics: {
    theme: "light",
    root: {
      role: "button",
      label: "Continue",
      bounds: { x: 0, y: 0, width: 160, height: 48 },
      tokens: lightSemantics.root.tokens,
      children: [
        {
          role: "text",
          label: "Continue",
          bounds: { x: 16, y: 14, width: 128, height: 20 },
          tokens: {
            typography: {
              text: { fontSize: 14, fontFamily: "Space Grotesk", fontWeight: 500, lineHeight: 20 },
            },
          },
        },
      ],
    },
  },
};
await writeFile(join(here, "expected-candidate.json"), JSON.stringify(expected, null, 2) + "\n");

console.log("wrote preview-bundle.png and expected-candidate.json");
