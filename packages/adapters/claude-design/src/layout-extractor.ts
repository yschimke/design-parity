/**
 * Capture a reference layout tree from an HTML export.
 *
 * The adapter's image rasterizer uses CLI Chrome `--screenshot`, which has no
 * DOM access, so geometry is read in a separate pass: drive Chrome on PATH via
 * `puppeteer-core` (which bundles **no** browser) and read each labelled leaf
 * element's geometry — its rendered **text box** (a `Range` over the text
 * content, the glyph extent — so it lines up with the candidate's Compose `Text`
 * node rather than the wide flex/grid cell the text sits in), falling back to
 * the element box — plus its resolved `getComputedStyle` (padding, corner
 * radius, font face/size/weight/line-height, colour), into a flat
 * {@link SemanticTree} (bounds in dp / CSS px). The style becomes each node's
 * spec `tokens`, so the report's annotation overlays render on the reference
 * panel too. `puppeteer-core` is imported lazily and kept out of the
 * package's hard dependencies — a consumer that doesn't need the structural
 * layout diff never pays for it, and if it (or Chrome) is absent the extractor
 * returns `undefined` and the layout diff simply doesn't run.
 */
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  DesignTokens,
  SemanticNode,
  SemanticTree,
  TypographyToken,
} from "@design-parity/core";

/** A request to capture one HTML export's layout. */
export interface LayoutRequest {
  /** Absolute path to the HTML export to measure. */
  htmlPath: string;
  /** CSS width to render at — the design's dp width. Defaults to 411. */
  widthDp?: number;
  /** CSS height to render at. Defaults to 914. */
  heightDp?: number;
}

/** Captures a reference layout tree, or `undefined` when it can't. */
export type LayoutExtractor = (req: LayoutRequest) => Promise<SemanticTree | undefined>;

/** Chrome/Chromium executables to try, in order of preference. */
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  process.env.CHROMIUM_BIN,
  "google-chrome-stable",
  "google-chrome",
  "chromium-browser",
  "chromium",
  "chrome",
].filter((c): c is string => typeof c === "string" && c.length > 0);

/**
 * Resolve a Chrome candidate to an **absolute** executable path, or `undefined`
 * when it can't be found. puppeteer-core `existsSync`s the `executablePath` it's
 * given and rejects anything that isn't a real path — so a bare command name
 * like `google-chrome-stable` (resolvable only via `PATH`) must be looked up
 * here first, or every candidate throws and the layout capture silently no-ops.
 * An absolute candidate is used as-is when it exists; a bare name is searched
 * across `PATH`.
 */
export function resolveExecutable(
  candidate: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (isAbsolute(candidate)) return existsSync(candidate) ? candidate : undefined;
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const full = join(dir, candidate);
    if (existsSync(full)) return full;
  }
  return undefined;
}

/**
 * The element's resolved CSS that maps to design spec — read from
 * `getComputedStyle` in the page, carried out as raw strings and parsed in
 * {@link treeFromRects} (so the parsing is unit-testable without a browser).
 */
export interface RawStyle {
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  borderRadius: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  color: string;
}

/** The raw per-element record pulled out of the page. */
interface RawRect {
  label: string;
  role: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Resolved computed style for the spec overlays (absent in older captures). */
  style?: RawStyle;
}

/**
 * Default extractor: render the export headlessly via `puppeteer-core` and read
 * the bounds of every text leaf (an element with text and no element children)
 * plus every "accessible object" — a control/graphic the a11y tree exposes even
 * without text, i.e. an element carrying a `role` / `aria-label` or a native
 * interactive/graphic tag (`button`, `a[href]`, `img`) — into a flat tree. That
 * second class is what boxes the icon buttons / switches the candidate already
 * reports as Compose `Role` nodes. Returns `undefined` if `puppeteer-core`
 * isn't installed or no Chrome launches.
 */
export const puppeteerLayoutExtractor: LayoutExtractor = async (req) => {
  let puppeteer: typeof import("puppeteer-core");
  try {
    puppeteer = (await import("puppeteer-core")).default as unknown as typeof import("puppeteer-core");
  } catch {
    return undefined; // optional dep absent — layout diff stays dormant
  }

  const url = pathToFileURL(req.htmlPath).href;
  for (const candidate of CHROME_CANDIDATES) {
    // puppeteer-core needs a real path, not a PATH-resolvable command name.
    const executablePath = resolveExecutable(candidate);
    if (!executablePath) continue;
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
      browser = await puppeteer.launch({
        executablePath,
        args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
        headless: "shell",
      });
    } catch {
      continue; // try the next candidate binary
    }
    try {
      const page = await browser.newPage();
      await page.setViewport({
        width: req.widthDp ?? 411,
        height: req.heightDp ?? 914,
        deviceScaleFactor: 1,
      });
      await page.goto(url, { waitUntil: "networkidle0" });
      // These callbacks run in the browser; reach the DOM via `globalThis` so
      // the package needn't pull in the TS "dom" lib for its Node build.
      await page.evaluate(async () => {
        const doc = (globalThis as { document?: { fonts?: { ready?: Promise<unknown> } } }).document;
        await doc?.fonts?.ready;
      });
      const rects = (await page.evaluate(() => {
        const win = globalThis as {
          document?: unknown;
          getComputedStyle?: (e: unknown) => Record<string, string>;
        };
        const doc = win.document as {
          querySelectorAll(s: string): ArrayLike<Record<string, unknown>>;
          createRange(): {
            selectNodeContents(n: unknown): void;
            getBoundingClientRect(): { x: number; y: number; width: number; height: number };
          };
        };
        const out: RawRect[] = [];
        for (const el of Array.from(doc.querySelectorAll("body *")) as Array<{
          tagName?: string;
          children: { length: number };
          textContent: string | null;
          getAttribute(n: string): string | null;
          getBoundingClientRect(): { x: number; y: number; width: number; height: number };
        }>) {
          const ariaRole = el.getAttribute("role");
          const ariaLabel = el.getAttribute("aria-label");
          const tag = (el.tagName ?? "").toLowerCase();
          // Native elements the a11y tree exposes with an implicit role.
          const nativeRole =
            tag === "button"
              ? "button"
              : tag === "a" && el.getAttribute("href")
                ? "link"
                : tag === "img"
                  ? "img"
                  : null;
          const isTextLeaf =
            el.children.length === 0 && (el.textContent ?? "").trim().length > 0;
          // An "accessible object" is a control/graphic the a11y tree surfaces
          // even with no text child — an icon button (role / aria-label) or a
          // native interactive/graphic element. The candidate already reports
          // these as Compose `Role` nodes, so capturing them lines the two sides
          // up and lets the label / touch-target checks see unlabelled controls.
          const isObject = Boolean(ariaRole || ariaLabel || nativeRole);
          if (!isTextLeaf && !isObject) continue;

          // Text leaves measure the rendered *text* (glyph) box, not the
          // container box: a text leaf in a wide flex/grid cell has an element
          // box the width of the cell, while the candidate (a Compose `Text`)
          // reports the box of the text it drew. A Range over the contents gives
          // the glyph extent, which lines up on both position and size. Objects
          // keep their element border box — the control's own bounds.
          let r = el.getBoundingClientRect();
          if (isTextLeaf) {
            try {
              const range = doc.createRange();
              range.selectNodeContents(el);
              const tr = range.getBoundingClientRect();
              if (tr.width > 0 && tr.height > 0) r = tr;
            } catch {
              // keep the element box
            }
          }
          if (r.width > 0 && r.height > 0) {
            // Resolved style for the spec overlays (padding/radius/type/colour).
            const cs = win.getComputedStyle?.(el);
            const style = cs
              ? {
                  paddingTop: cs["paddingTop"] ?? "",
                  paddingRight: cs["paddingRight"] ?? "",
                  paddingBottom: cs["paddingBottom"] ?? "",
                  paddingLeft: cs["paddingLeft"] ?? "",
                  borderRadius: cs["borderTopLeftRadius"] ?? "",
                  fontFamily: cs["fontFamily"] ?? "",
                  fontSize: cs["fontSize"] ?? "",
                  fontWeight: cs["fontWeight"] ?? "",
                  lineHeight: cs["lineHeight"] ?? "",
                  color: cs["color"] ?? "",
                }
              : undefined;
            out.push({
              label: (isTextLeaf ? (el.textContent ?? "") : (ariaLabel ?? "")).trim(),
              role: ariaRole ?? (isTextLeaf ? null : nativeRole),
              x: r.x,
              y: r.y,
              w: r.width,
              h: r.height,
              ...(style ? { style } : {}),
            });
          }
        }
        return out;
      })) as RawRect[];
      return treeFromRects(rects, {
        width: req.widthDp ?? 411,
        height: req.heightDp ?? 914,
      });
    } finally {
      await browser.close();
    }
  }
  return undefined;
};

/** Parse a CSS length (`"14px"`) to its number, or `undefined` when not finite. */
function px(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

/** The single value of a four-sided box only when all sides agree (else `undefined`). */
function uniform(style: RawStyle): number | undefined {
  const t = px(style.paddingTop);
  const r = px(style.paddingRight);
  const b = px(style.paddingBottom);
  const l = px(style.paddingLeft);
  if (t === undefined || t !== r || r !== b || b !== l) return undefined;
  return t;
}

/** First concrete font family from a CSS stack, unquoted. */
function firstFamily(stack: string | undefined): string | undefined {
  const first = stack?.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  return first || undefined;
}

/** CSS `font-weight` to a number (`"bold"`/`"normal"` mapped), else the raw token. */
function weight(value: string | undefined): number | string | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  if (value === "bold") return 700;
  if (value === "normal") return 400;
  return value;
}

/** `rgb()/rgba()` to a CSS hex string (`#rrggbb` or `#rrggbbaa`). */
function colorToHex(value: string | undefined): string | undefined {
  const m = value?.match(/rgba?\(([^)]+)\)/i);
  if (!m) return undefined;
  const parts = m[1]!.split(",").map((p) => p.trim());
  const [r, g, b] = parts.map(Number);
  if (r === undefined || g === undefined || b === undefined) return undefined;
  if (![r, g, b].every((v) => Number.isFinite(v))) return undefined;
  const hex = (v: number): string => Math.round(v).toString(16).padStart(2, "0");
  let out = `#${hex(r)}${hex(g)}${hex(b)}`;
  const a = parts[3] !== undefined ? Number(parts[3]) : 1;
  if (Number.isFinite(a) && a < 1) out += hex(a * 255);
  return out;
}

/** Round to 1dp (keeps token values compact and stable). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Map an element's resolved style to the spec {@link DesignTokens} the report's
 * overlays read — typography (face/size/weight/line-height), foreground colour,
 * uniform padding, and corner radius. Values are in CSS px, i.e. dp at the
 * extractor's `deviceScaleFactor: 1`, so they share the reference bounds' unit.
 * Returns `undefined` when the style yields nothing usable.
 */
export function tokensFromStyle(style: RawStyle | undefined): DesignTokens | undefined {
  if (!style) return undefined;
  const tokens: DesignTokens = {};

  const typography: TypographyToken = {};
  const family = firstFamily(style.fontFamily);
  if (family) typography.fontFamily = family;
  const size = px(style.fontSize);
  if (size !== undefined) typography.fontSize = round1(size);
  const w = weight(style.fontWeight);
  if (w !== undefined) typography.fontWeight = w;
  const lh = px(style.lineHeight); // "normal" → undefined (skipped)
  if (lh !== undefined) typography.lineHeight = round1(lh);
  if (Object.keys(typography).length > 0) tokens.typography = { text: typography };

  const fg = colorToHex(style.color);
  if (fg) tokens.colors = { text: fg };

  const pad = uniform(style);
  if (pad !== undefined && pad > 0) tokens.spacing = { padding: Math.round(pad) };

  const radius = px(style.borderRadius);
  if (radius !== undefined && radius > 0) tokens.radius = { corner: Math.round(radius) };

  return Object.keys(tokens).length > 0 ? tokens : undefined;
}

/**
 * Build a flat {@link SemanticTree} from raw element rects (rounded to dp). When
 * the capture `frame` (the render viewport, in dp) is supplied it is stamped on
 * the root as `bounds`, so the diff engine can read the reference's coordinate
 * extent and normalise the candidate's render-pixel geometry into this dp space
 * (the two sides render at different densities). Omitting it leaves the root
 * unbounded, so the diff treats the trees as already sharing a space.
 *
 * Each rect's resolved {@link RawStyle} (when captured) becomes the node's spec
 * `tokens` — padding/radius/typography/colour — so the report's annotation
 * overlays light up on the reference panel, not just the candidate.
 */
export function treeFromRects(
  rects: RawRect[],
  frame?: { width: number; height: number },
): SemanticTree {
  const children: SemanticNode[] = rects.map((r) => {
    const node: SemanticNode = {
      label: r.label,
      ...(r.role ? { role: r.role } : {}),
      bounds: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.w),
        height: Math.round(r.h),
      },
    };
    const tokens = tokensFromStyle(r.style);
    if (tokens) node.tokens = tokens;
    return node;
  });
  const root: SemanticNode = { children };
  if (frame) root.bounds = { x: 0, y: 0, width: frame.width, height: frame.height };
  return { root };
}
