/**
 * Process-spawning seam. The default {@link execFileRunner} shells out with
 * `node:child_process`; tests inject a {@link CommandRunner} that returns canned
 * output so unit tests never need a live renderer (see AGENTS.md).
 */
import { execFile } from "node:child_process";

export interface RunOptions {
  cwd?: string;
  /** Kill the process after this many ms (0 / undefined = no timeout). */
  timeoutMs?: number;
}

export interface RunResult {
  /** Process exit code; `0` on success. */
  code: number;
  stdout: string;
  stderr: string;
}

/** Abstraction over spawning a process, injectable for tests. */
export interface CommandRunner {
  run(command: string, args: string[], opts?: RunOptions): Promise<RunResult>;
}

/** True when a spawn error means the executable was not found on `PATH`. */
export function isNotFound(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

/** Default runner: spawn the binary and collect stdio. */
export const execFileRunner: CommandRunner = {
  run(command, args, opts = {}) {
    return new Promise<RunResult>((resolve, reject) => {
      execFile(
        command,
        args,
        {
          cwd: opts.cwd,
          timeout: opts.timeoutMs ?? 0,
          maxBuffer: 64 * 1024 * 1024,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          // A missing binary is reported up so it maps to MissingComposePreviewError.
          if (error && isNotFound(error)) {
            reject(error);
            return;
          }
          const rawCode = (error as { code?: unknown } | null)?.code;
          const code =
            typeof rawCode === "number" ? rawCode : error ? 1 : 0;
          resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
        },
      );
    });
  },
};
