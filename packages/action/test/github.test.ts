import { describe, it, expect, vi } from "vitest";

import type { DesignMap } from "@design-parity/core";

import {
  postReport,
  componentsForChangedFiles,
  filePathOf,
  checkConclusion,
  exitCode,
  REPORT_MARKER,
  type GitHubCommentClient,
  type IssueComment,
  type ParityReport,
} from "../src/index.js";

function fakeClient(initial: IssueComment[] = []) {
  const comments = [...initial];
  const create = vi.fn(async (body: string) => {
    comments.push({ id: comments.length + 1, body });
  });
  const update = vi.fn(async (id: number, body: string) => {
    const c = comments.find((x) => x.id === id);
    if (c) c.body = body;
  });
  const client: GitHubCommentClient = {
    listComments: async () => comments,
    createComment: create,
    updateComment: update,
  };
  return { client, create, update, comments };
}

const report = (over: Partial<ParityReport> = {}): ParityReport => ({
  status: "pass",
  blocked: false,
  direction: "code-led",
  results: [],
  warnings: [],
  ...over,
});

describe("postReport (idempotent comment)", () => {
  it("creates a comment when none exists", async () => {
    const { client, create, update } = fakeClient();
    const outcome = await postReport(client, `${REPORT_MARKER}\nhello`);
    expect(outcome).toBe("created");
    expect(create).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });

  it("updates the existing report comment in place, ignoring others", async () => {
    const { client, create, update, comments } = fakeClient([
      { id: 7, body: "a human comment" },
      { id: 9, body: `${REPORT_MARKER}\nold verdict` },
    ]);
    const outcome = await postReport(client, `${REPORT_MARKER}\nnew verdict`);
    expect(outcome).toBe("updated");
    expect(update).toHaveBeenCalledWith(9, `${REPORT_MARKER}\nnew verdict`);
    expect(create).not.toHaveBeenCalled();
    expect(comments.find((c) => c.id === 9)?.body).toContain("new verdict");
  });
});

describe("componentsForChangedFiles", () => {
  const map: DesignMap = {
    components: [
      { code: "ui/Button.kt#PrimaryButton", source: "figma", ref: "figma:K/1:1" },
      { code: "ui/Card.kt#OfferCard", source: "stitch", ref: "stitch:design/x" },
    ],
  };

  it("returns mapped components whose file changed", () => {
    expect(
      componentsForChangedFiles(map, ["ui/Button.kt", "README.md"]),
    ).toEqual(["ui/Button.kt#PrimaryButton"]);
  });

  it("tolerates a ./ path prefix on either side", () => {
    expect(componentsForChangedFiles(map, ["./ui/Card.kt"])).toEqual([
      "ui/Card.kt#OfferCard",
    ]);
  });

  it("is empty for a non-UI PR (no mapped file changed)", () => {
    expect(componentsForChangedFiles(map, ["docs/x.md"])).toEqual([]);
    expect(componentsForChangedFiles(undefined, ["ui/Button.kt"])).toEqual([]);
  });

  it("filePathOf strips the member", () => {
    expect(filePathOf("ui/Button.kt#PrimaryButton")).toBe("ui/Button.kt");
    expect(filePathOf("ui/Button.kt")).toBe("ui/Button.kt");
  });
});

describe("checkConclusion / exitCode", () => {
  it("blocks: design-led failure → failure + exit 1", () => {
    const r = report({ status: "fail", blocked: true, direction: "design-led" });
    expect(checkConclusion(r)).toBe("failure");
    expect(exitCode(r)).toBe(1);
  });

  it("advisory: code-led failure → neutral + exit 0", () => {
    const r = report({ status: "fail", blocked: false });
    expect(checkConclusion(r)).toBe("neutral");
    expect(exitCode(r)).toBe(0);
  });

  it("warn → neutral; pass → success", () => {
    expect(checkConclusion(report({ status: "warn" }))).toBe("neutral");
    expect(checkConclusion(report({ status: "pass" }))).toBe("success");
    expect(exitCode(report({ status: "warn" }))).toBe(0);
  });
});
