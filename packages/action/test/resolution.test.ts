import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { ParityReport } from "../src/orchestrate.js";
import {
  acceptanceEvidence,
  canonicalIssue,
  resolveKnownDifferences,
  writeAcceptanceEvidence,
} from "../src/resolution.js";
import { parseArgs } from "../src/cli/resolve-cli.js";

const acceptanceReport = (statuses: Record<string, { status: "resolved" | "valid" | "out-of-scope" }>) => ({
  documentRejected: false,
  statuses,
  validationFailures: [],
  scores: { raw: 90, accepted: 60, unaccepted: 100 },
  suppressing: [],
});

describe("acceptance resolution", () => {
  it("canonicalises hand-authored GitHub issue spellings", () => {
    expect(canonicalIssue("https://WWW.GitHub.com/Owner/Repo/issues/42/#issuecomment-1"))
      .toBe("owner/repo#42");
    expect(canonicalIssue("Owner/Repo#42")).toBe("owner/repo#42");
    expect(canonicalIssue("https://example.com/Owner/Repo/issues/42")).toBeNull();
  });

  it("keeps only agreeing in-scope observations actionable", () => {
    const report = {
      results: [
        { code: "A", status: "ok", acceptances: { light: acceptanceReport({ fixed: { status: "resolved" }, other: { status: "out-of-scope" } }) } },
        { code: "B", status: "ok", acceptances: { dark: acceptanceReport({ fixed: { status: "resolved" }, conflict: { status: "valid" } }) } },
        { code: "C", status: "ok", acceptances: { large: acceptanceReport({ conflict: { status: "resolved" } }) } },
      ],
    } as ParityReport;
    const evidence = acceptanceEvidence(report, {
      now: new Date("2026-08-24T12:00:00Z"),
      verificationUrl: "https://github.com/owner/catalog/pull/7",
    });
    expect(evidence.statuses.fixed).toMatchObject({ status: "resolved" });
    expect(evidence.statuses.fixed?.conflict).toBeUndefined();
    expect(evidence.statuses.conflict).toMatchObject({ conflict: true });
    expect(evidence.statuses.other).toBeUndefined();
  });

  it("joins lifecycle canonically and marks only closed live acceptances stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "design-parity-lifecycle-"));
    const documentPath = join(root, "known-differences.json");
    const issueIndexPath = join(root, "issues.json");
    await writeFile(documentPath, JSON.stringify({
      schema: "compose-preview-known-differences/v1",
      acceptances: [
        { id: "live", issue: "https://WWW.GitHub.com/Owner/Repo/issues/40/#issuecomment-1" },
        { id: "fixed", issue: "https://github.com/owner/repo/issues/41" },
        { id: "conflict", issue: "https://github.com/owner/repo/issues/42" },
        { id: "absent", issue: "https://github.com/owner/repo/issues/43" },
      ],
    }));
    await writeFile(issueIndexPath, JSON.stringify({
      schema: "compose-preview-issues/v1",
      issues: [
        { repository: "OWNER/REPO", number: 40, state: "closed" },
        { repository: "owner/repo", number: 41, state: "closed" },
        { repository: "owner/repo", number: 42, state: "open" },
        { repository: "OWNER/REPO", number: 42, state: "closed" },
      ],
    }));
    const report = {
      results: [{
        code: "A",
        status: "ok",
        acceptances: {
          light: acceptanceReport({
            live: { status: "valid" },
            fixed: { status: "resolved" },
            conflict: { status: "valid" },
            absent: { status: "valid" },
          }),
        },
      }],
    } as ParityReport;
    const evidence = await writeAcceptanceEvidence(join(root, "evidence.json"), report, {
      documentPath,
      issueIndexPath,
      now: new Date("2026-08-24T12:00:00Z"),
    });
    expect(evidence.statuses.live).toMatchObject({ lifecycle: "closed", stale: true });
    expect(evidence.statuses.fixed).toMatchObject({ lifecycle: "closed" });
    expect(evidence.statuses.fixed?.stale).toBeUndefined();
    expect(evidence.statuses.conflict).toMatchObject({ lifecycle: "unknown" });
    expect(evidence.statuses.absent).toMatchObject({ lifecycle: "unknown" });
  });

  it("treats an unreadable issue index as unknown rather than stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "design-parity-lifecycle-"));
    const documentPath = join(root, "known-differences.json");
    await writeFile(documentPath, JSON.stringify({
      schema: "compose-preview-known-differences/v1",
      acceptances: [{ id: "live", issue: "https://github.com/owner/repo/issues/40" }],
    }));
    const report = {
      results: [{ code: "A", status: "ok", acceptances: { light: acceptanceReport({ live: { status: "valid" } }) } }],
    } as ParityReport;
    const evidence = await writeAcceptanceEvidence(join(root, "evidence.json"), report, {
      documentPath,
      issueIndexPath: join(root, "missing.json"),
    });
    expect(evidence.statuses.live).toMatchObject({ lifecycle: "unknown" });
    expect(evidence.statuses.live?.stale).toBeUndefined();
  });

  it("deletes resolved records, groups canonical issues, and closes only asserted owners", async () => {
    const root = await mkdtemp(join(tmpdir(), "design-parity-resolve-"));
    const config = join(root, ".design-parity");
    const artifacts = join(config, "known-differences");
    await mkdir(join(artifacts, "a"), { recursive: true });
    await mkdir(join(artifacts, "b"), { recursive: true });
    await mkdir(join(artifacts, "c"), { recursive: true });
    await writeFile(join(artifacts, "a", "mask.png"), "a");
    await writeFile(join(artifacts, "b", "mask.png"), "b");
    await writeFile(join(artifacts, "c", "mask.png"), "c");
    await writeFile(join(config, "known-differences.json"), JSON.stringify({
      schema: "compose-preview-known-differences/v1",
      acceptances: [
        { id: "a", issue: "https://github.com/Owner/Repo/issues/42" },
        { id: "b", issue: "https://www.github.com/owner/repo/issues/42/#issuecomment-1" },
        { id: "c", issue: "https://github.com/owner/repo/issues/43" },
      ],
    }));
    const evidencePath = join(root, "evidence.json");
    await writeFile(evidencePath, JSON.stringify({
      schema: "design-parity-acceptance-evidence/v1",
      generatedAt: "2026-08-24T12:00:00Z",
      verificationUrl: "https://github.com/owner/catalog/pull/7",
      statuses: {
        a: { status: "resolved", comparisons: ["A:light"] },
        b: { status: "resolved", comparisons: ["B:light"] },
        c: { status: "resolved", comparisons: ["C:light"], conflict: true },
      },
    }));

    const result = await resolveKnownDifferences({
      repoRoot: root,
      evidencePath,
      ownedIssues: ["OWNER/REPO#42"],
    });
    expect(result.removed).toEqual(["a", "b"]);
    expect(result.closingIssues).toEqual(["owner/repo#42"]);
    expect(result.body).toContain("Verified by https://github.com/owner/catalog/pull/7");
    expect(result.body).toContain("Closes owner/repo#42");
    expect(existsSync(join(artifacts, "a"))).toBe(false);
    expect(existsSync(join(artifacts, "b"))).toBe(false);
    expect(existsSync(join(artifacts, "c"))).toBe(true);
    const document = JSON.parse(await readFile(join(config, "known-differences.json"), "utf8"));
    expect(document.acceptances.map((record: { id: string }) => record.id)).toEqual(["c"]);
  });

  it("omits closing keywords when ownership is not established", async () => {
    const root = await mkdtemp(join(tmpdir(), "design-parity-resolve-"));
    const config = join(root, ".design-parity");
    await mkdir(join(config, "known-differences", "a"), { recursive: true });
    await writeFile(join(config, "known-differences.json"), JSON.stringify({
      schema: "compose-preview-known-differences/v1",
      acceptances: [{ id: "a", issue: "https://github.com/owner/repo/issues/9" }],
    }));
    const evidencePath = join(root, "evidence.json");
    await writeFile(evidencePath, JSON.stringify({
      schema: "design-parity-acceptance-evidence/v1",
      generatedAt: "2026-08-24T12:00:00Z",
      statuses: { a: { status: "resolved", comparisons: ["A:light"] } },
    }));
    const result = await resolveKnownDifferences({ repoRoot: root, evidencePath });
    expect(result.ownershipUnknownIssues).toEqual(["owner/repo#9"]);
    expect(result.body).not.toContain("Closes owner/repo#9");
    expect(result.body).toContain("single-document ownership was not established");
  });

  it("parses the resolve CLI ownership and body flags", () => {
    expect(parseArgs([
      "resolve", "--repo", ".", "--evidence", "out/evidence.json",
      "--owned-issue", "owner/repo#42", "--body-out", "out/pr.md",
    ])).toMatchObject({ ownedIssues: ["owner/repo#42"] });
  });
});
