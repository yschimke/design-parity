/**
 * A tiny GitHub REST client over `fetch` — just the few endpoints the Action
 * needs (changed files + issue comments). No SDK dependency, mirroring the figma
 * adapter's hand-rolled client. `fetch` is injectable for tests.
 */
import type { GitHubCommentClient, IssueComment } from "./surface.js";

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

export interface GitHubRestOptions {
  token: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

export interface RepoRef {
  owner: string;
  repo: string;
}

export class GitHubRest {
  readonly #base: string;
  readonly #fetch: FetchLike;
  readonly #headers: Record<string, string>;

  constructor(opts: GitHubRestOptions) {
    const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) throw new Error("design-parity: no fetch available");
    this.#fetch = fetchImpl;
    this.#base = (opts.baseUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.#headers = {
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async #req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.#fetch(`${this.#base}${path}`, {
      method,
      headers: this.#headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`github: ${method} ${path} → ${res.status} ${text}`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  /** Changed file paths in a PR (paginated). */
  async listPullRequestFiles(
    { owner, repo }: RepoRef,
    prNumber: number,
  ): Promise<string[]> {
    const files: string[] = [];
    for (let page = 1; page <= 30; page++) {
      const batch = await this.#req<{ filename: string }[]>(
        "GET",
        `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      );
      files.push(...batch.map((f) => f.filename));
      if (batch.length < 100) break;
    }
    return files;
  }

  /** A {@link GitHubCommentClient} bound to one PR's comment thread. */
  commentClient(ref: RepoRef, prNumber: number): GitHubCommentClient {
    const base = `/repos/${ref.owner}/${ref.repo}/issues/${prNumber}/comments`;
    const commentsBase = `/repos/${ref.owner}/${ref.repo}/issues/comments`;
    return {
      listComments: async () => {
        const out: IssueComment[] = [];
        for (let page = 1; page <= 10; page++) {
          const batch = await this.#req<IssueComment[]>(
            "GET",
            `${base}?per_page=100&page=${page}`,
          );
          out.push(...batch.map((c) => ({ id: c.id, body: c.body })));
          if (batch.length < 100) break;
        }
        return out;
      },
      createComment: async (body) => {
        await this.#req("POST", base, { body });
      },
      updateComment: async (id, body) => {
        await this.#req("PATCH", `${commentsBase}/${id}`, { body });
      },
    };
  }
}
