/**
 * The PR comment surface: post the parity report as a single comment and update
 * that same comment on every re-run (idempotent), found by the stable
 * {@link REPORT_MARKER}. The GitHub client is an injected interface so this is
 * unit-testable with a fake and free of any SDK dependency.
 */
import { REPORT_MARKER } from "../report.js";

export interface IssueComment {
  id: number;
  body: string;
}

/** The minimal slice of the GitHub API the surface needs (already PR-scoped). */
export interface GitHubCommentClient {
  listComments(): Promise<IssueComment[]>;
  createComment(body: string): Promise<void>;
  updateComment(id: number, body: string): Promise<void>;
}

export type PostOutcome = "created" | "updated";

/**
 * Create the report comment, or update the bot's existing one in place. Matches
 * its own comment by {@link REPORT_MARKER}, so re-runs never pile up duplicates.
 */
export async function postReport(
  client: GitHubCommentClient,
  body: string,
): Promise<PostOutcome> {
  const existing = (await client.listComments()).find((c) =>
    c.body.includes(REPORT_MARKER),
  );
  if (existing) {
    await client.updateComment(existing.id, body);
    return "updated";
  }
  await client.createComment(body);
  return "created";
}
