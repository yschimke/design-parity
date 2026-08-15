/**
 * Enumerating a file's pages, and what they are called on the way out.
 *
 * The table is something a human pastes into a doc and an importer reads node
 * ids from, so its shape is worth pinning rather than discovering from a diff
 * after the fact.
 */
import type { FigmaNodeDoc } from "@design-parity/adapter-figma";
import { describe, expect, it } from "vitest";

import { pageTable, pageUrl, pagesOf } from "../src/list.js";

const node = (id: string, name: string, type = "CANVAS"): FigmaNodeDoc =>
  ({ id, name, type }) as FigmaNodeDoc;

describe("pagesOf", () => {
  it("returns every page in document order", () => {
    expect(
      pagesOf({
        children: [node("11:1833", "Getting started"), node("55141:14175", "Date & time pickers")],
      }),
    ).toEqual([
      { id: "11:1833", name: "Getting started" },
      { id: "55141:14175", name: "Date & time pickers" },
    ]);
  });

  it("keeps only CANVAS children", () => {
    // A document's children are its pages today. The type check is what keeps a
    // future sibling node kind out of a list someone pastes node ids from.
    expect(
      pagesOf({ children: [node("1:1", "Page"), node("2:2", "Something", "FRAME")] }),
    ).toEqual([{ id: "1:1", name: "Page" }]);
  });

  it("tolerates a document with no children", () => {
    expect(pagesOf({})).toEqual([]);
    expect(pagesOf(undefined)).toEqual([]);
  });
});

describe("pageUrl", () => {
  it("spells the node id the way a figma.com URL does", () => {
    // The URL uses a dash where the REST API uses a colon. Get it wrong and the
    // link does not error — it silently opens the file at no particular place.
    expect(pageUrl("AbCdEf", "55141:14175")).toBe(
      "https://www.figma.com/design/AbCdEf/design?node-id=55141-14175",
    );
  });

  it("carries the file's own slug when one is known", () => {
    expect(pageUrl("AbCdEf", "1:2", "Material-3-Design-Kit")).toContain(
      "/AbCdEf/Material-3-Design-Kit?",
    );
  });
});

describe("pageTable", () => {
  const pages = [
    { id: "11:1833", name: "Getting started" },
    { id: "58548:7093", name: "Shape" },
  ];

  it("renders a markdown table with a regenerating comment", () => {
    const table = pageTable(pages, { fileKey: "AbCdEf" });
    expect(table.split("\n")[0]).toBe(
      "<!-- 2 page(s) in AbCdEf; regenerate with `design-parity-pages list` -->",
    );
    expect(table).toContain("| Page | Node id | Link |");
    expect(table).toContain("| Shape | `58548:7093` |");
    expect(table).toContain("?node-id=58548-7093)");
  });

  it("escapes a pipe in a page name", () => {
    // A page name is author-supplied. An unescaped pipe ends the cell early and
    // shifts every column after it, which reads as a corrupted table rather
    // than as one page with an odd name.
    const table = pageTable([{ id: "1:1", name: "Light | Dark" }], { fileKey: "K" });
    expect(table).toContain("| Light \\| Dark | `1:1` |");
  });

  it("renders a header and no rows for an empty file", () => {
    const table = pageTable([], { fileKey: "K" });
    expect(table).toContain("0 page(s) in K");
    expect(table.trimEnd().split("\n")).toHaveLength(4);
  });
});
