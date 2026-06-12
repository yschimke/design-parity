/**
 * Resolve a code component to a Figma node by reading the repo's Code Connect
 * data — the machine link that makes Figma the keystone source.
 *
 * In CI this is the JSON the Code Connect CLI emits (`figma connect parse
 * --json` / the published index), NOT the Dev Mode MCP server (that is
 * local/desktop-session oriented). We consume the parsed docs deterministically.
 */
import { readFile } from "node:fs/promises";

import { parseFigmaRef, type FigmaRef } from "./figma-ref.js";

/** One Code Connect document, as emitted by the CLI (fields we rely on). */
interface CodeConnectDoc {
  /** A figma.com URL pointing at the connected node. */
  figmaNode: string;
  /** Connected code component name, e.g. `"PrimaryButton"`. */
  component?: string;
  /** Source file of the component, e.g. `"ui/Button.kt"`. */
  source?: string;
}

/** A componentId → FigmaRef index built from Code Connect docs. */
export type CodeConnectMap = Map<string, FigmaRef>;

function isDoc(v: unknown): v is CodeConnectDoc {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).figmaNode === "string"
  );
}

/**
 * Build a {@link CodeConnectMap} from parsed Code Connect output. Accepts
 * either a bare array of docs or `{ docs: [...] }`. Docs whose `figmaNode`
 * URL can't be parsed are skipped silently (a connection to another file/page).
 */
export function parseCodeConnectDocs(json: unknown): CodeConnectMap {
  const docs: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { docs?: unknown[] })?.docs)
      ? (json as { docs: unknown[] }).docs
      : [];

  const map: CodeConnectMap = new Map();
  for (const raw of docs) {
    if (!isDoc(raw)) continue;
    let ref: FigmaRef;
    try {
      ref = parseFigmaRef(raw.figmaNode);
    } catch {
      continue;
    }
    // Prefer the fully-qualified `source#component` handle; also index the bare
    // component name so a convention-style lookup still resolves.
    if (raw.source && raw.component) {
      map.set(`${raw.source}#${raw.component}`, ref);
    }
    if (raw.component && !map.has(raw.component)) {
      map.set(raw.component, ref);
    }
  }
  return map;
}

/** Read and parse a Code Connect JSON file into a {@link CodeConnectMap}. */
export async function loadCodeConnect(path: string): Promise<CodeConnectMap> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`figma: cannot read Code Connect file '${path}'`, { cause });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`figma: Code Connect file '${path}' is not valid JSON`, {
      cause,
    });
  }
  return parseCodeConnectDocs(json);
}

/**
 * Look up a component in a {@link CodeConnectMap}. Tries the exact handle, then
 * the bare member name after `#` (e.g. `ui/Button.kt#PrimaryButton` →
 * `PrimaryButton`).
 */
export function resolveFromCodeConnect(
  componentId: string,
  map: CodeConnectMap,
): FigmaRef | undefined {
  const exact = map.get(componentId);
  if (exact) return exact;
  const member = componentId.includes("#")
    ? componentId.slice(componentId.indexOf("#") + 1)
    : componentId;
  return map.get(member);
}
