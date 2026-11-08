export type EventKind = "commit" | "revert" | "pr_merged" | "release" | "issue_closed" | "tag";

export type NormalisedEvent = {
  repoFullName: string;
  kind: EventKind;
  ref: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

const labelNames = (labels: { name: string }[] = []) => labels.map((l) => l.name);

function normalisePush(repo: string, p: any): NormalisedEvent[] {
  if (p.forced || p.deleted || p.ref !== `refs/heads/${p.repository.default_branch}`) return [];
  return (p.commits ?? [])
    .filter((c: any) => !/^Merge (pull request|branch)/.test(c.message))
    .map((c: any): NormalisedEvent => {
      const isRevert = c.message.startsWith('Revert "');
      const revertsSha = c.message.match(/This reverts commit ([0-9a-f]{7,40})\./)?.[1];
      return {
        repoFullName: repo,
        kind: isRevert ? "revert" : "commit",
        ref: c.id,
        occurredAt: new Date(c.timestamp),
        payload: {
          message: c.message,
          url: c.url,
          author: c.author?.username || c.author?.name,
          added: c.added ?? [],
          modified: c.modified ?? [],
          removed: c.removed ?? [],
          ...(isRevert && revertsSha ? { revertsSha } : {}),
        },
      };
    });
}

export function normalise(eventName: string, payload: any, now = new Date()): NormalisedEvent[] {
  const repo: string = payload?.repository?.full_name;
  if (!repo) return [];

  switch (eventName) {
    case "push":
      return normalisePush(repo, payload);

    case "pull_request": {
      const pr = payload.pull_request;
      if (payload.action !== "closed" || !pr?.merged) return [];
      return [{
        repoFullName: repo,
        kind: "pr_merged",
        ref: String(pr.number),
        occurredAt: new Date(pr.merged_at),
        payload: {
          number: pr.number,
          title: pr.title,
          body: pr.body,
          labels: labelNames(pr.labels),
          url: pr.html_url,
          mergeSha: pr.merge_commit_sha,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changed_files,
        },
      }];
    }

    case "release": {
      const r = payload.release;
      if (payload.action !== "published" || !r || r.draft) return [];
      return [{
        repoFullName: repo,
        kind: "release",
        ref: r.tag_name,
        occurredAt: new Date(r.published_at ?? now),
        payload: { name: r.name, body: r.body, url: r.html_url, prerelease: r.prerelease },
      }];
    }

    case "issues": {
      const i = payload.issue;
      if (payload.action !== "closed" || i?.state_reason !== "completed") return [];
      return [{
        repoFullName: repo,
        kind: "issue_closed",
        ref: String(i.number),
        occurredAt: new Date(i.closed_at ?? now),
        payload: { number: i.number, title: i.title, body: i.body, url: i.html_url, labels: labelNames(i.labels) },
      }];
    }

    case "create":
      if (payload.ref_type !== "tag") return [];
      return [{ repoFullName: repo, kind: "tag", ref: payload.ref, occurredAt: now, payload: {} }];

    default:
      return [];
  }
}
