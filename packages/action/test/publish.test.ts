import { describe, it, expect } from "vitest";

import { publishBaseline, type GitRunner, type GitResult } from "../src/index.js";

const ok = (stdout = ""): GitResult => ({ stdout, stderr: "", code: 0 });
const fail = (stderr = "boom", code = 1): GitResult => ({ stdout: "", stderr, code });

/**
 * A scripted git runner: `handlers` map an `args.join(" ")` prefix to a result
 * (or a per-call sequence of results). Records every invocation for assertions.
 */
function fakeGit(
  handler: (args: string[], callIndex: number) => GitResult,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    const r = handler(args, calls.length);
    calls.push(args);
    return r;
  };
  return { git, calls };
}

const baseOpts = {
  sourceDir: "/tmp/stage",
  branch: "design-parity/main",
  repo: "owner/repo",
  token: "t0ken",
  message: "design-parity: baseline pass",
  sleep: async () => {},
};

describe("publishBaseline", () => {
  it("orphan-commits and pushes when the branch does not exist yet", async () => {
    const { git, calls } = fakeGit((args) => {
      if (args[0] === "write-tree") return ok("TREE");
      if (args[0] === "fetch") return fail("couldn't find remote ref", 128);
      if (args[0] === "commit-tree") return ok("COMMIT1");
      return ok();
    });

    const result = await publishBaseline({ ...baseOpts, git });

    expect(result).toEqual({
      branch: "design-parity/main",
      pushed: true,
      sha: "COMMIT1",
    });
    // Orphan commit: commit-tree was called with no `-p` parent.
    const commit = calls.find((c) => c[0] === "commit-tree")!;
    expect(commit).not.toContain("-p");
    // Pushed the commit to the branch ref.
    const push = calls.find((c) => c[0] === "push")!;
    expect(push).toContain("COMMIT1:refs/heads/design-parity/main");
  });

  it("re-parents on the existing tip", async () => {
    const { git, calls } = fakeGit((args) => {
      if (args[0] === "write-tree") return ok("TREE");
      if (args[0] === "fetch") return ok();
      if (args[0] === "rev-parse" && args[1] === "FETCH_HEAD") return ok("PARENT");
      if (args[0] === "commit-tree") return ok("COMMIT2");
      return ok();
    });

    const result = await publishBaseline({ ...baseOpts, git });

    expect(result.sha).toBe("COMMIT2");
    const commit = calls.find((c) => c[0] === "commit-tree")!;
    expect(commit).toEqual(["commit-tree", "TREE", "-p", "PARENT", "-m", baseOpts.message]);
  });

  it("skips the push when the tree is unchanged vs the tip", async () => {
    const { git, calls } = fakeGit((args) => {
      if (args[0] === "write-tree") return ok("SAME_TREE");
      if (args[0] === "fetch") return ok();
      if (args[0] === "rev-parse" && args[1] === "FETCH_HEAD") return ok("PARENT");
      if (args[0] === "rev-parse" && args[1] === "PARENT^{tree}") return ok("SAME_TREE");
      return ok();
    });

    const result = await publishBaseline({ ...baseOpts, git, skipIfUnchanged: true });

    expect(result).toEqual({ branch: "design-parity/main", pushed: false });
    expect(calls.some((c) => c[0] === "commit-tree")).toBe(false);
    expect(calls.some((c) => c[0] === "push")).toBe(false);
  });

  it("retries the push on a race, re-fetching the tip each attempt", async () => {
    let pushes = 0;
    const { git, calls } = fakeGit((args) => {
      if (args[0] === "write-tree") return ok("TREE");
      if (args[0] === "fetch") return ok();
      if (args[0] === "rev-parse" && args[1] === "FETCH_HEAD") return ok("PARENT");
      if (args[0] === "commit-tree") return ok("COMMIT");
      if (args[0] === "push") {
        pushes += 1;
        return pushes < 2 ? fail("non-fast-forward", 1) : ok();
      }
      return ok();
    });

    const result = await publishBaseline({ ...baseOpts, git });

    expect(result.pushed).toBe(true);
    expect(calls.filter((c) => c[0] === "push")).toHaveLength(2);
    // Re-fetched the tip before the retry.
    expect(calls.filter((c) => c[0] === "fetch")).toHaveLength(2);
  });

  it("gives up after maxAttempts and throws", async () => {
    const { git } = fakeGit((args) => {
      if (args[0] === "write-tree") return ok("TREE");
      if (args[0] === "fetch") return ok();
      if (args[0] === "rev-parse") return ok("PARENT");
      if (args[0] === "commit-tree") return ok("COMMIT");
      if (args[0] === "push") return fail("non-fast-forward", 1);
      return ok();
    });

    await expect(
      publishBaseline({ ...baseOpts, git, maxAttempts: 3 }),
    ).rejects.toThrow(/failed after 3 attempts/);
  });

  it("uses the GitHub Actions bot identity and a token-embedded remote", async () => {
    const { git, calls } = fakeGit((args) => {
      if (args[0] === "write-tree") return ok("TREE");
      if (args[0] === "fetch") return fail("no ref", 128);
      if (args[0] === "commit-tree") return ok("C");
      return ok();
    });

    await publishBaseline({ ...baseOpts, git });

    const name = calls.find((c) => c[0] === "config" && c[1] === "user.name")!;
    expect(name[2]).toBe("github-actions[bot]");
    const remote = calls.find((c) => c[0] === "remote")!;
    expect(remote[3]).toBe(
      "https://x-access-token:t0ken@github.com/owner/repo.git",
    );
  });
});
