import { describe, expect, it } from "vitest";

import { resolveDirection } from "../src/direction.js";

describe("resolveDirection", () => {
  it("honours an explicit code-led", () => {
    expect(resolveDirection("code-led")).toBe("code-led");
  });

  it("honours an explicit design-led", () => {
    expect(resolveDirection("design-led")).toBe("design-led");
  });

  it("treats unresolved auto as design-led — never clobber a designer", () => {
    expect(resolveDirection("auto")).toBe("design-led");
  });

  it("treats an unknown string, empty, null, and undefined as design-led", () => {
    expect(resolveDirection("whatever")).toBe("design-led");
    expect(resolveDirection("")).toBe("design-led");
    expect(resolveDirection(null)).toBe("design-led");
    expect(resolveDirection(undefined)).toBe("design-led");
  });
});
