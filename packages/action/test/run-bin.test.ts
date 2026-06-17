import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// The published `design-parity` bin is a launcher that *imports*
// @design-parity/action/run. Regression guard for the bug where `run`'s
// self-entry guard (`import.meta.url === argv[1]`) was false under the launcher,
// so `main` never ran: `design-parity run` imported the module, printed nothing,
// wrote no --out dir, and exited 0 — silently doing nothing. Spawn the real bin
// and assert `main` actually executes (no --components ⇒ usage on stdout, exit 2).
const bin = fileURLToPath(
  new URL("../../cli/bin/design-parity.mjs", import.meta.url),
);

describe("design-parity bin launcher", () => {
  it("actually runs the `run` command's main (not a silent no-op)", async () => {
    let stdout = "";
    let code = 0;
    try {
      ({ stdout } = await exec(process.execPath, [bin, "run"]));
    } catch (err) {
      // Non-zero exit is expected (usage ⇒ 2); capture its streams.
      const e = err as { code?: number; stdout?: string };
      code = typeof e.code === "number" ? e.code : 1;
      stdout = e.stdout ?? "";
    }
    expect(code).toBe(2);
    expect(stdout).toContain("design-parity run --components");
  });
});
