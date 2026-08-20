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
async function runBin(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === "number" ? e.code : 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
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

  // Same trap again, and the same consequence: an `import` that only imported
  // its module would exit 0 having refreshed nothing, and the parity run would
  // then read a cache that never moved — a stale board that looks current.
  it("dispatches `import` to its own main", async () => {
    const { code, stdout } = await runBin(["import"]);
    expect(code).toBe(2);
    expect(stdout).toContain("design-parity import --cache");
  });

  it("advertises the reference cache on the run usage line", async () => {
    const { stdout } = await runBin(["run"]);
    expect(stdout).toContain("--reference-cache <dir>");
  });

  it("dispatches `publish` to its own main", async () => {
    const { code, stderr } = await runBin(["publish"]);
    expect(code).toBe(2);
    expect(stderr).toContain("--dir and --branch are required");
  });

  // The launcher used to send an unrecognised subcommand to the `else` branch —
  // a parity RUN. `design-parity publish …` against a CLI predating `publish`
  // therefore printed "Parity pass" and exited 0 while publishing nothing: a
  // green step that silently stopped updating the board. Version skew between a
  // workflow pinned `@main` and a `latest` CLI makes that a live scenario every
  // time a subcommand is added, so it fails loudly and names the version.
  it("refuses an unknown subcommand instead of running a parity comparison", async () => {
    const { code, stdout, stderr } = await runBin(["publish-typo", "--dir", "out"]);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown subcommand 'publish-typo'");
    expect(stderr).toContain("older than the workflow");
    expect(stdout).not.toContain("Parity pass");
  });

  it("still treats a leading flag as a parity run, not a subcommand", async () => {
    const { stdout } = await runBin(["--components", ""]);
    expect(stdout).toContain("design-parity run --components");
  });
});
