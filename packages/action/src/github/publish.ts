/**
 * Publish a staged artifact directory to a permanent branch (issue #56),
 * encapsulating the git plumbing so a consumer workflow is just "render
 * candidates → use the action". Mirrors the `compose-ai-tools` `apply`
 * `push-branch.sh` helper, in TypeScript and with an injectable git runner so
 * the sequence is unit-testable (the same shape as the `fetch`-injectable REST
 * client).
 *
 * The staged dir is treated as a throwaway repo: `git init` there, write its
 * contents as one tree, re-parent on the branch tip (orphan commit the first
 * time), and push. A race-retry loop re-fetches the tip and re-parents when a
 * concurrent run beat us to the branch. Nothing touches the consumer's working
 * checkout.
 *
 * Requires a token with `contents: write`. The commit identity defaults to the
 * GitHub Actions bot so published commits never claim a human author.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitResult {
  stdout: string;
  stderr: string;
  /** Process exit code; non-zero is expected (and handled) for some commands. */
  code: number;
}

/** Runs one `git` invocation. Injectable so tests can script the sequence. */
export type GitRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<GitResult>;

/** Default runner: shells out to the system `git` in `cwd`. */
export const execGit: GitRunner = async (args, { cwd }) => {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
};

export interface PublishOptions {
  /** Directory whose current contents become the published tree. */
  sourceDir: string;
  /** Destination branch on the remote (force-updated / re-parented each run). */
  branch: string;
  /** `owner/repo`. */
  repo: string;
  /** Token with `contents: write`. */
  token: string;
  /** Commit message. */
  message: string;
  /** When the tree matches the branch tip, skip the push (no empty commits). */
  skipIfUnchanged?: boolean;
  /** Commit identity (defaults to the GitHub Actions bot). */
  authorName?: string;
  authorEmail?: string;
  /** Remote host, e.g. `https://github.com` or a GHES server URL. */
  serverUrl?: string;
  /** Push-race retry budget. Default 5. */
  maxAttempts?: number;
  /** Injected git runner (tests); defaults to {@link execGit}. */
  git?: GitRunner;
  /** Backoff sleeper (tests); defaults to a real `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PublishResult {
  branch: string;
  /** False when `skipIfUnchanged` short-circuited an unchanged tree. */
  pushed: boolean;
  /** The pushed commit SHA (absent when nothing was pushed). */
  sha?: string;
}

const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function remoteUrl(serverUrl: string, repo: string, token: string): string {
  const host = serverUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://x-access-token:${token}@${host}/${repo}.git`;
}

/**
 * Stage `sourceDir`'s contents and push them as a single commit on `branch`,
 * re-parented on the existing tip. Retries the push on a non-fast-forward race.
 */
export async function publishBaseline(
  options: PublishOptions,
): Promise<PublishResult> {
  const git = options.git ?? execGit;
  const sleep = options.sleep ?? wait;
  const cwd = options.sourceDir;
  const maxAttempts = options.maxAttempts ?? 5;
  const run = async (...args: string[]): Promise<GitResult> =>
    git(args, { cwd });
  const ok = async (...args: string[]): Promise<string> => {
    const r = await run(...args);
    if (r.code !== 0) {
      throw new Error(`git ${args.join(" ")} → ${r.code}: ${r.stderr.trim()}`);
    }
    return r.stdout.trim();
  };

  await ok("init", "-q");
  await ok("config", "user.name", options.authorName ?? BOT_NAME);
  await ok("config", "user.email", options.authorEmail ?? BOT_EMAIL);
  await ok(
    "remote",
    "add",
    "origin",
    remoteUrl(options.serverUrl ?? "https://github.com", options.repo, options.token),
  );

  await ok("add", "-A");
  const tree = await ok("write-tree");

  for (let attempt = 1; ; attempt++) {
    // Re-fetch the tip every attempt so a retry re-parents on the latest.
    let parent = "";
    const fetched = await run("fetch", "--depth=1", "--quiet", "origin", options.branch);
    if (fetched.code === 0) {
      parent = await ok("rev-parse", "FETCH_HEAD");
      if (options.skipIfUnchanged) {
        const parentTree = await ok("rev-parse", `${parent}^{tree}`);
        if (parentTree === tree) {
          return { branch: options.branch, pushed: false };
        }
      }
    }

    const commit = parent
      ? await ok("commit-tree", tree, "-p", parent, "-m", options.message)
      : await ok("commit-tree", tree, "-m", options.message); // orphan: first push

    const pushed = await run(
      "push",
      "--quiet",
      "origin",
      `${commit}:refs/heads/${options.branch}`,
    );
    if (pushed.code === 0) {
      return { branch: options.branch, pushed: true, sha: commit };
    }

    if (attempt >= maxAttempts) {
      throw new Error(
        `push to ${options.branch} failed after ${attempt} attempts: ${pushed.stderr.trim()}`,
      );
    }
    await sleep(attempt * 2000);
  }
}
