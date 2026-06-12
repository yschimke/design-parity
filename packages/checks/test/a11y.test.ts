import { describe, it, expect } from "vitest";

import {
  checkSemantics,
  checkTouchTargets,
  resolveConfig,
} from "../src/index.js";
import { candidateOf, goldenCandidate } from "./helpers.js";

const cfg = resolveConfig();

describe("checkTouchTargets", () => {
  it("passes the 160×48 golden button", () => {
    expect(checkTouchTargets(goldenCandidate(), cfg)).toEqual([]);
  });

  it("warns below the 48dp minimum", () => {
    const c = candidateOf({
      role: "button",
      label: "Like",
      bounds: { x: 0, y: 0, width: 40, height: 40 },
    });
    const [f, ...rest] = checkTouchTargets(c, cfg);
    expect(rest).toEqual([]);
    expect(f!.kind).toBe("a11y");
    expect(f!.severity).toBe("warn");
    expect(f!.message).toMatch(/below the 48dp minimum/);
  });

  it("errors below the WCAG 2.5.8 floor of 24dp", () => {
    const c = candidateOf({
      role: "checkbox",
      label: "Agree",
      bounds: { x: 0, y: 0, width: 16, height: 16 },
    });
    const f = checkTouchTargets(c, cfg)[0];
    expect(f!.severity).toBe("error");
    expect(f!.message).toMatch(/WCAG 2\.5\.8 floor/);
  });
});

describe("checkSemantics", () => {
  it("passes the golden button (role + label present)", () => {
    expect(checkSemantics(goldenCandidate(), cfg)).toEqual([]);
  });

  it("errors on an interactive node with no accessible label", () => {
    const c = candidateOf({
      role: "button",
      bounds: { x: 0, y: 0, width: 48, height: 48 },
    });
    const f = checkSemantics(c, cfg)[0];
    expect(f!.kind).toBe("a11y");
    expect(f!.severity).toBe("error");
    expect(f!.message).toMatch(/no accessible label/);
  });

  it("warns on an image with no content description", () => {
    const c = candidateOf({
      role: "image",
      bounds: { x: 0, y: 0, width: 24, height: 24 },
    });
    const f = checkSemantics(c, cfg)[0];
    expect(f!.severity).toBe("warn");
    expect(f!.message).toMatch(/content description/);
  });

  it("does not require a label on a plain text node", () => {
    const c = candidateOf({ role: "text", label: "" });
    expect(checkSemantics(c, cfg)).toEqual([]);
  });
});
