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

/** Spawn the real bin, tolerating the non-zero exit a usage message carries. */
async function runBin(args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await exec(process.execPath, [bin, ...args]);
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { code?: number; stdout?: string };
    return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "" };
  }
}

describe("design-parity bin launcher", () => {
  it("actually runs the `run` command's main (not a silent no-op)", async () => {
    const { code, stdout } = await runBin(["run"]);
    expect(code).toBe(2);
    expect(stdout).toContain("design-parity run --components");
  });

  // `merge` reaches `main` the same way `run` does, so it is exposed to the same
  // self-entry-guard trap: a launcher that only imported it would exit 0 having
  // published nothing, which in a sharded run looks like a clean pass.
  it("dispatches `merge` to its own main", async () => {
    const { code, stdout } = await runBin(["merge"]);
    expect(code).toBe(2);
    expect(stdout).toContain("design-parity merge");
  });

  it("advertises --shard on the run usage line", async () => {
    const { stdout } = await runBin(["run"]);
    expect(stdout).toContain("--shard <index>/<total>");
  });
});
