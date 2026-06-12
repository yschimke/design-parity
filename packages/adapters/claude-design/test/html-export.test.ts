import { describe, it, expect } from "vitest";

import { parseHandoff, HANDOFF_MIME } from "../src/index.js";

const wrap = (body: string) =>
  `<!doctype html><html><body>
   <script type="${HANDOFF_MIME}">${body}</script>
   </body></html>`;

describe("parseHandoff", () => {
  it("extracts and parses the embedded handoff manifest", () => {
    const manifest = parseHandoff(
      wrap(`{"componentId":"a#b","tokens":{"spacing":{"padding":16}}}`),
    );
    expect(manifest).toEqual({
      componentId: "a#b",
      tokens: { spacing: { padding: 16 } },
    });
  });

  it("returns undefined when the document has no handoff block", () => {
    expect(parseHandoff("<html><body>no script here</body></html>")).toBeUndefined();
  });

  it("ignores scripts of other types", () => {
    const html = `<script type="application/json">{"x":1}</script>`;
    expect(parseHandoff(html)).toBeUndefined();
  });

  it("matches the first handoff block when several are present", () => {
    const html = wrap(`{"componentId":"first#x"}`) + wrap(`{"componentId":"second#y"}`);
    expect(parseHandoff(html)?.componentId).toBe("first#x");
  });

  it("throws on a malformed JSON body", () => {
    expect(() => parseHandoff(wrap(`{ nope }`), "ex.html")).toThrow(
      /not valid JSON/,
    );
  });

  it("throws on an empty handoff block", () => {
    expect(() => parseHandoff(wrap(`   `), "ex.html")).toThrow(/empty/);
  });

  it("throws when the handoff body is not a JSON object", () => {
    expect(() => parseHandoff(wrap(`[1,2,3]`), "ex.html")).toThrow(
      /must be a JSON object/,
    );
  });
});
