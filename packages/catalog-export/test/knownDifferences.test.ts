import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_ARTIFACT_BYTES,
  MAX_DOCUMENT_BYTES,
  publishedArtifactPath,
  writeKnownDifferences,
} from "../src/knownDifferences.js";

let out: string;
let src: string;

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), "kd-out-"));
  src = await mkdtemp(join(tmpdir(), "kd-src-"));
});
afterEach(async () => {
  await rm(out, { recursive: true, force: true });
  await rm(src, { recursive: true, force: true });
});

async function commit(relative: string, contents: string | Uint8Array): Promise<void> {
  const path = join(src, ".design-parity", relative);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents);
}

const DOCUMENT = JSON.stringify({
  schema: "compose-preview-known-differences/v1",
  acceptances: [{ id: "glyph", mask: "mask.png" }],
});

describe("writeKnownDifferences", () => {
  it("says nothing about a repo that has accepted nothing", async () => {
    const result = await writeKnownDifferences(out, { repositoryRoot: src });
    expect(result.documentPath).toBeUndefined();
    expect(result.artifactCount).toBe(0);
    expect(result.skipped).toEqual([]);
  });

  it("carries the document byte for byte", async () => {
    // Bytes, not a re-serialisation. A parse-and-rewrite reorders members, normalises numbers and
    // drops a duplicated key — and a duplicated key is one of the document-level refusals the
    // contract spends a paragraph on, precisely because runtimes disagree about which value wins.
    const awkward = '{"schema":"compose-preview-known-differences/v1","acceptances":[],"acceptances":[]}\n';
    await commit("known-differences.json", awkward);
    const result = await writeKnownDifferences(out, { repositoryRoot: src });
    expect(result.documentPath).toBe(join(out, "parity", "known-differences.json"));
    expect(await readFile(result.documentPath!, "utf8")).toBe(awkward);
  });

  it("carries the artifact tree, nested directories included", async () => {
    await commit("known-differences.json", DOCUMENT);
    await commit("known-differences/glyph/mask.png", "mask bytes");
    await commit("known-differences/glyph/accepted-candidate.png", "crop bytes");
    await commit("known-differences/glyph/nested/extra.png", "nested bytes");
    const result = await writeKnownDifferences(out, { repositoryRoot: src });
    expect(result.artifactCount).toBe(3);
    expect(
      await readFile(join(out, "parity", "known-differences", "glyph", "mask.png"), "utf8"),
    ).toBe("mask bytes");
    expect(
      await readFile(join(out, "parity", "known-differences", "glyph", "nested", "extra.png"), "utf8"),
    ).toBe("nested bytes");
  });

  it("skips a name a checkout cannot create, and says which", async () => {
    // Not tidiness: `CON.png` commits fine on POSIX and cannot be created under that name on
    // Windows at all, so a bundle carrying it is one whose consumers disagree about whether the
    // record's artifact exists. Skipped rather than thrown — a catalog with one broken acceptance
    // is still worth publishing, and the consumer reports that record's own verdict.
    await commit("known-differences.json", DOCUMENT);
    await commit("known-differences/glyph/mask.png", "kept");
    await commit("known-differences/glyph/CON.png", "dropped");
    await commit("known-differences/glyph/trailing.png.", "dropped");
    const result = await writeKnownDifferences(out, { repositoryRoot: src });
    expect(result.artifactCount).toBe(1);
    expect(result.skipped.map((entry) => entry.reason)).toEqual([
      "path-not-portable",
      "path-not-portable",
    ]);
    expect(result.skipped.map((entry) => entry.path).sort()).toEqual([
      "glyph/CON.png",
      "glyph/trailing.png.",
    ]);
  });

  it("refuses an artifact past the schema's ceiling from its length", async () => {
    // Publishing it would produce a bundle whose consumers refuse a record the publisher accepted.
    await commit("known-differences.json", DOCUMENT);
    await commit("known-differences/glyph/mask.png", "x".repeat(MAX_ARTIFACT_BYTES + 1));
    const result = await writeKnownDifferences(out, { repositoryRoot: src });
    expect(result.artifactCount).toBe(0);
    expect(result.skipped).toEqual([{ path: "glyph/mask.png", reason: "artifact-too-large" }]);
  });

  it("accepts an artifact of exactly the ceiling", async () => {
    // Inclusive at both ends, like every cap in this contract. A `>=` check would refuse what the
    // consumers call legal.
    await commit("known-differences.json", DOCUMENT);
    await commit("known-differences/glyph/mask.png", "x".repeat(MAX_ARTIFACT_BYTES));
    const result = await writeKnownDifferences(out, { repositoryRoot: src });
    expect(result.artifactCount).toBe(1);
    expect(result.skipped).toEqual([]);
  });

  it("refuses a document past the ceiling and publishes nothing", async () => {
    await commit("known-differences.json", "x".repeat(MAX_DOCUMENT_BYTES + 1));
    await commit("known-differences/glyph/mask.png", "mask bytes");
    const result = await writeKnownDifferences(out, { repositoryRoot: src });
    expect(result.documentPath).toBeUndefined();
    // And no artifacts either: without a document nothing names them, so a tree of masks in the
    // bundle would be bytes no consumer can reach and every consumer must fetch past.
    expect(result.artifactCount).toBe(0);
    expect(result.skipped).toEqual([
      { path: "known-differences.json", reason: "artifact-too-large" },
    ]);
  });

  it("neither follows nor publishes a symlinked artifact", async () => {
    // A link's *target* is what a consumer would read, so publishing the link either dangles or
    // smuggles bytes from outside the tree into a record that does not own them — and the record's
    // recorded hash would then be checked against a file it never named.
    await commit("known-differences.json", DOCUMENT);
    await writeFile(join(src, "outside.png"), "not yours");
    await mkdir(join(src, ".design-parity", "known-differences", "glyph"), { recursive: true });
    const link = await tryLink(
      join(src, "outside.png"),
      join(src, ".design-parity", "known-differences", "glyph", "mask.png"),
    );
    if (!link) return;
    const result = await writeKnownDifferences(out, { repositoryRoot: src });
    expect(result.artifactCount).toBe(0);
    expect(result.skipped).toEqual([{ path: "glyph/mask.png", reason: "symlink" }]);
  });

  it("neither follows nor publishes a symlinked document", async () => {
    // `stat` follows a link; `lstat` does not. The document is not walked as a directory entry, so
    // the `Dirent` check that protects the artifacts never sees it — a committed link here would
    // publish an arbitrary readable file from the export runner.
    await writeFile(join(src, "outside.json"), '{"secret":true}');
    await mkdir(join(src, ".design-parity"), { recursive: true });
    const link = await tryLink(
      join(src, "outside.json"),
      join(src, ".design-parity", "known-differences.json"),
    );
    if (!link) return;
    const result = await writeKnownDifferences(out, { repositoryRoot: src });
    expect(result.documentPath).toBeUndefined();
    expect(result.skipped).toEqual([{ path: "known-differences.json", reason: "symlink" }]);
  });

  it("neither follows nor publishes a symlinked artifact root", async () => {
    // `readdir` follows a linked directory, and the per-entry check only ever sees what is already
    // inside — so a linked root hands the walk someone else's tree wholesale.
    await commit("known-differences.json", DOCUMENT);
    await mkdir(join(src, "elsewhere"), { recursive: true });
    await writeFile(join(src, "elsewhere", "mask.png"), "not yours");
    const link = await tryLink(
      join(src, "elsewhere"),
      join(src, ".design-parity", "known-differences"),
    );
    if (!link) return;
    const result = await writeKnownDifferences(out, { repositoryRoot: src });
    expect(result.artifactCount).toBe(0);
    expect(result.skipped).toEqual([{ path: "known-differences", reason: "symlink" }]);
  });

  it("clears a previous publish when the repo has stopped accepting", async () => {
    // `outDir` is reused across renders. A bundle that kept the last good copy would go on
    // suppressing a difference the repository explicitly deleted — the same silent suppression the
    // contract exists to prevent, arriving through the publisher instead of the record.
    await commit("known-differences.json", DOCUMENT);
    await commit("known-differences/glyph/mask.png", "mask bytes");
    const first = await writeKnownDifferences(out, { repositoryRoot: src });
    expect(first.artifactCount).toBe(1);

    await rm(join(src, ".design-parity"), { recursive: true, force: true });
    const second = await writeKnownDifferences(out, { repositoryRoot: src });
    expect(second.documentPath).toBeUndefined();
    await expect(readFile(join(out, "parity", "known-differences.json"), "utf8")).rejects.toThrow();
    await expect(
      readFile(join(out, "parity", "known-differences", "glyph", "mask.png"), "utf8"),
    ).rejects.toThrow();
  });

  it("clears an artifact the repo has removed", async () => {
    await commit("known-differences.json", DOCUMENT);
    await commit("known-differences/glyph/mask.png", "mask bytes");
    await commit("known-differences/glyph/accepted-candidate.png", "crop bytes");
    await writeKnownDifferences(out, { repositoryRoot: src });

    await rm(join(src, ".design-parity", "known-differences", "glyph", "mask.png"));
    const second = await writeKnownDifferences(out, { repositoryRoot: src });
    expect(second.artifactCount).toBe(1);
    await expect(
      readFile(join(out, "parity", "known-differences", "glyph", "mask.png"), "utf8"),
    ).rejects.toThrow();
  });
});

describe("publishedArtifactPath", () => {
  it("names a path inside the artifact directory", () => {
    expect(publishedArtifactPath("glyph/mask.png")).toBe(
      "parity/known-differences/glyph/mask.png",
    );
  });

  it("refuses anything the copier would refuse", () => {
    // The helper that exists to name safe paths must not mint a traversal: `../../catalog.json`
    // reads as being inside the artifact directory and resolves outside it the moment a URL or a
    // filesystem normalises it.
    for (const path of [
      "../../catalog.json",
      "/etc/passwd",
      "glyph\\mask.png",
      "glyph/CON.png",
      "glyph/mask.png.",
      "",
    ]) {
      expect(() => publishedArtifactPath(path), path).toThrow();
    }
  });
});

/**
 * Create a symlink, or report that this filesystem cannot.
 *
 * Only `EPERM` and `ENOSYS` are swallowed — the two ways a platform says "not supported". Anything
 * else (a wrong path, an `EEXIST` from a fixture that drifted) is rethrown, because a security test
 * that returns early on an unexplained setup failure is green for the wrong reason and would stay
 * green through the regression it exists to catch.
 */
async function tryLink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "ENOSYS") return false;
    throw error;
  }
}
