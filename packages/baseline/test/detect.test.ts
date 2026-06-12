import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { detectMaturity } from "../src/index.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fixture = (name: string) => resolve(fixtures, name);

describe("detectMaturity", () => {
  it("classifies a Code Connect repo as machine-link", async () => {
    const r = await detectMaturity(fixture("rung1-code-connect"));
    expect(r.rung).toBe("machine-link");
    expect(r.hasCodeConnect).toBe(true);
    expect(r.signals.some((s) => s.kind === "code-connect")).toBe(true);
  });

  it("classifies a design-map repo as manifest", async () => {
    const r = await detectMaturity(fixture("rung2-design-map"));
    expect(r.rung).toBe("manifest");
    expect(r.hasDesignMap).toBe(true);
    expect(r.hasCodeConnect).toBe(false);
  });

  it("classifies a token-only design system as manifest", async () => {
    const r = await detectMaturity(fixture("rung2-tokens"));
    expect(r.rung).toBe("manifest");
    expect(r.hasTokens).toBe(true);
    expect(r.hasCodeConnect).toBe(false);
    expect(r.hasDesignMap).toBe(false);
  });

  it("classifies a greenfield repo as bootstrap", async () => {
    const r = await detectMaturity(fixture("rung3-greenfield"));
    expect(r.rung).toBe("bootstrap");
    expect(r.hasCodeConnect).toBe(false);
    expect(r.hasDesignMap).toBe(false);
    expect(r.hasTokens).toBe(false);
    expect(r.signals).toEqual([]);
  });

  it("reports a stable, human label per rung", async () => {
    const r = await detectMaturity(fixture("rung1-code-connect"));
    expect(r.label).toMatch(/Code Connect/);
  });
});
