/**
 * Enumerating a design file's pages.
 *
 * Page ids are the coordinate for anything addressing a whole page rather than
 * a component — a {@link file://./config.ts | `design-pages.json`} entry wants
 * one — and they are as undiscoverable as the node ids the rest of this
 * ecosystem exists to resolve. Figma's Dev Mode MCP server exposes only the
 * page a user is looking at, and enumerating through it means a full subtree
 * dump per page: the Material 3 kit's `Buttons` page alone is ~448 KB of
 * metadata. That is an absurd way to learn thirty names.
 *
 * `GET /v1/files/:key?depth=1` answers the whole question in ONE request: the
 * document with its children truncated to the page level — every page's `id`
 * and `name`, and nothing else.
 *
 * The formatting is pure, so what a page is called on the way out can be pinned
 * without a network call. The fetch is the CLI's.
 */
import type { FigmaNodeDoc } from "@design-parity/adapter-figma";

/** One page of a design file: what it is called, and how to address it. */
export interface DesignPage {
  id: string;
  name: string;
}

/**
 * The pages of a `?depth=1` document, in document order.
 *
 * Filtered to `CANVAS` — a Figma document's children are its pages, but the
 * type check is what keeps a future sibling node kind out of a list a consumer
 * will paste node ids from.
 */
export function pagesOf(document: { children?: FigmaNodeDoc[] } | undefined): DesignPage[] {
  return (document?.children ?? [])
    .filter((node) => node.type === "CANVAS")
    .map((node) => ({ id: node.id, name: node.name }));
}

/**
 * A figma.com deep link to a page.
 *
 * The URL spells a node id with a dash where the REST API uses a colon, which
 * is the single most common way a hand-built Figma link silently opens the file
 * at the wrong place — it does not error, it just ignores the fragment.
 */
export function pageUrl(fileKey: string, pageId: string, slug = "design"): string {
  return `https://www.figma.com/design/${fileKey}/${slug}?node-id=${pageId.replace(/:/g, "-")}`;
}

export interface PageTableOptions {
  fileKey: string;
  /** The file's name in its URL. Cosmetic to Figma, which keys on the id. */
  slug?: string;
  /** What to name as the regenerating command, in the leading comment. */
  generatedBy?: string;
}

/**
 * The pages as a markdown table, ready to paste into a doc.
 *
 * Carries a leading HTML comment naming the count and the command that
 * regenerates it — a pasted table with no provenance is one nobody dares
 * refresh, and a stale page list sends an importer at ids that have moved.
 */
export function pageTable(pages: DesignPage[], opts: PageTableOptions): string {
  const { fileKey, slug = "design", generatedBy = "design-parity-pages list" } = opts;
  const lines = [
    `<!-- ${pages.length} page(s) in ${fileKey}; regenerate with \`${generatedBy}\` -->`,
    "",
    "| Page | Node id | Link |",
    "| --- | --- | --- |",
  ];
  for (const page of pages) {
    // A page name is author-supplied and may contain a pipe, which would end
    // the cell early and shift every column after it.
    const name = page.name.replace(/\|/g, "\\|");
    lines.push(`| ${name} | \`${page.id}\` | [open](${pageUrl(fileKey, page.id, slug)}) |`);
  }
  return lines.join("\n");
}
