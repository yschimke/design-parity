import { describe, expect, it } from "vitest";

import { diagnoseServerLoad } from "../src/serverHelp.js";

const at = { serverBase: "http://localhost:8723", system: "compose-m3" };

describe("diagnoseServerLoad", () => {
  it("treats a fetch rejection as an unreachable host, with start-a-host steps", () => {
    const help = diagnoseServerLoad({ ...at, networkError: "Failed to fetch" });
    expect(help.issue).toBe("unreachable");
    expect(help.title).toMatch(/No compose-preview server reachable/);
    expect(help.detail).toContain("http://localhost:8723");
    expect(help.steps.some((s) => s.includes("compose-preview serve --catalogs compose-m3"))).toBe(true);
    // Teaches the offline fallback.
    expect(help.steps.some((s) => /offline/i.test(s))).toBe(true);
  });

  it("defaults to unreachable when no failure field is set", () => {
    expect(diagnoseServerLoad(at).issue).toBe("unreachable");
  });

  it("reports an HTTP error with the status and a system-mismatch hint", () => {
    const help = diagnoseServerLoad({ ...at, httpStatus: 404 });
    expect(help.issue).toBe("http-error");
    expect(help.title).toBe("Server responded 404");
    expect(help.detail).toContain("404");
    expect(help.detail).toContain("compose-m3");
    expect(help.steps.some((s) => s.includes("--catalogs"))).toBe(true);
  });

  it("flags a non-serve host on a schema mismatch", () => {
    const help = diagnoseServerLoad({ ...at, badSchema: true });
    expect(help.issue).toBe("not-serve-host");
    expect(help.detail).toMatch(/isn't a compose-preview-serve\/v2/);
    expect(help.steps[0]).toMatch(/compose-preview-serve\/v2/);
  });

  it("explains an empty system when the host is up but serves nothing", () => {
    const help = diagnoseServerLoad({ ...at, emptyPreviews: true });
    expect(help.issue).toBe("no-previews");
    expect(help.title).toBe("No previews for “compose-m3”");
    expect(help.steps.some((s) => s.includes("compose-m3"))).toBe(true);
  });

  it("falls back to a placeholder system in the steps when none is given", () => {
    const help = diagnoseServerLoad({ serverBase: "", system: "", networkError: "x" });
    expect(help.detail).toContain("the preview server");
    expect(help.steps.some((s) => s.includes("<system>"))).toBe(true);
  });
});
