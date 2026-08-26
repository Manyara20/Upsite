/**
 * A very small GitHub REST client.
 *
 * Issues are the incident database, so the only endpoints needed are the issue
 * lifecycle ones. `fetch` is enough for that, and it keeps the workflow install
 * step down to the packages the site already needs.
 */

const API = "https://api.github.com";

export interface IssueRef {
  number: number;
  html_url: string;
  state: "open" | "closed";
  title: string;
  body?: string | null;
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    readonly endpoint: string,
    body: string,
  ) {
    super(`GitHub ${status} on ${endpoint}: ${body.slice(0, 400)}`);
    this.name = "GitHubError";
  }
}

export class GitHub {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token: string,
  ) {}

  /**
   * Built from the environment a workflow already provides. Returns null when
   * there is no token, so the scripts stay runnable locally — they then do
   * everything except talk to GitHub.
   */
  static fromEnv(owner: string, repo: string): GitHub | null {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (!token) {
      console.warn("[upsite] no GITHUB_TOKEN — issue management is disabled for this run");
      return null;
    }
    return new GitHub(owner, repo, token);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const endpoint = `/repos/${this.owner}/${this.repo}${path}`;
    const res = await fetch(`${API}${endpoint}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "Upsite",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) throw new GitHubError(res.status, endpoint, await res.text());
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * Finds the open incident issue for a monitor. Used only as a fallback: the
   * issue number is normally remembered in `history/<id>.yml`, and this covers
   * the case where that file was reset or the issue was opened by hand.
   */
  async findOpenIncident(labels: string[], marker: string): Promise<IssueRef | null> {
    const issues = await this.request<IssueRef[]>(
      "GET",
      `/issues?state=open&per_page=100&labels=${encodeURIComponent(labels.join(","))}`,
    );
    return issues.find((i) => (i.body ?? "").includes(marker)) ?? null;
  }

  /**
   * Creates the incident labels if they are missing. Applying an unknown label
   * to an issue would create it anyway, but with a random colour — doing it
   * here means the incident labels are recognisable at a glance.
   */
  async ensureLabels(labels: string[]): Promise<void> {
    const palette: Record<string, { color: string; description: string }> = {
      status: { color: "d73a4a", description: "Automated uptime status" },
      incident: { color: "b60205", description: "An endpoint is down or degraded" },
    };

    for (const name of labels) {
      try {
        await this.request("GET", `/labels/${encodeURIComponent(name)}`);
      } catch {
        const spec = palette[name] ?? { color: "ededed", description: "Upsite" };
        await this.request("POST", "/labels", { name, ...spec }).catch((err) =>
          console.warn(`[upsite] could not create label "${name}":`, err),
        );
        console.log(`[upsite] created label "${name}"`);
      }
    }
  }

  async createIssue(input: {
    title: string;
    body: string;
    labels: string[];
    assignees: string[];
  }): Promise<IssueRef> {
    return this.request<IssueRef>("POST", "/issues", input);
  }

  async comment(issue: number, body: string): Promise<void> {
    await this.request("POST", `/issues/${issue}/comments`, { body });
  }

  async close(issue: number): Promise<void> {
    await this.request("PATCH", `/issues/${issue}`, {
      state: "closed",
      state_reason: "completed",
    });
  }

  /** Locking is what keeps non-members out of the incident thread. */
  async lock(issue: number): Promise<void> {
    await this.request("PUT", `/issues/${issue}/lock`, { lock_reason: "resolved" });
  }

  async unlock(issue: number): Promise<void> {
    await this.request("DELETE", `/issues/${issue}/lock`);
  }

  /**
   * Assignees without push access are silently dropped by the API, so an
   * unusable login would quietly leave every incident unowned. Filtering first
   * turns that into a warning an operator can act on.
   */
  async filterAssignees(candidates: string[]): Promise<string[]> {
    const ok: string[] = [];
    for (const login of candidates) {
      try {
        await this.request("GET", `/assignees/${encodeURIComponent(login)}`);
        ok.push(login);
      } catch {
        console.warn(`[upsite] "${login}" cannot be assigned issues here — skipping`);
      }
    }
    return ok;
  }

  /**
   * Commenting on a locked issue is rejected even for the token that locked it,
   * so a follow-up report has to unlock, comment and lock again.
   */
  async commentOnLocked(issue: number, body: string, locked: boolean): Promise<void> {
    if (!locked) return this.comment(issue, body);
    await this.unlock(issue).catch(() => undefined);
    try {
      await this.comment(issue, body);
    } finally {
      await this.lock(issue).catch(() => undefined);
    }
  }
}
