import { describe, expect, it } from "vitest";
import { normalise } from "@/lib/github/normalise";
import push from "../../../fixtures/github/push.json";
import pushForce from "../../../fixtures/github/push_force.json";
import pushBranch from "../../../fixtures/github/push_branch.json";
import pushRevert from "../../../fixtures/github/push_revert.json";
import prMerged from "../../../fixtures/github/pr_merged.json";
import prClosedUnmerged from "../../../fixtures/github/pr_closed_unmerged.json";
import releasePublished from "../../../fixtures/github/release_published.json";
import issueClosed from "../../../fixtures/github/issue_closed.json";
import issueNotPlanned from "../../../fixtures/github/issue_closed_not_planned.json";
import createTag from "../../../fixtures/github/create_tag.json";
import createBranch from "../../../fixtures/github/create_branch.json";

const clone = <T>(x: T): T => structuredClone(x);

describe("normalise push", () => {
  it("emits one commit event per non-merge commit on the default branch", () => {
    const events = normalise("push", push);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.ref)).toEqual([push.commits[0].id, push.commits[1].id]);
    const [first] = events;
    expect(first.kind).toBe("commit");
    expect(first.repoFullName).toBe("krushiraj/shiplog");
    expect(first.occurredAt).toEqual(new Date("2026-11-08T15:30:12+05:30"));
    expect(first.payload).toEqual({
      message: push.commits[0].message,
      url: push.commits[0].url,
      author: "krushiraj",
      added: ["src/lib/score.ts"],
      modified: ["src/lib/cards.ts"],
      removed: [],
    });
  });

  it("falls back to author name when username is missing", () => {
    const p = clone(push) as any;
    delete p.commits[0].author.username;
    expect(normalise("push", p)[0].payload.author).toBe("Krushi Raj");
  });

  it("skips 'Merge branch' commits", () => {
    const p = clone(push);
    p.commits[0].message = "Merge branch 'main' into feature-x";
    expect(normalise("push", p)).toHaveLength(1);
  });

  it("ignores force pushes", () => {
    expect(normalise("push", pushForce)).toEqual([]);
  });

  it("ignores non-default branches", () => {
    expect(normalise("push", pushBranch)).toEqual([]);
  });

  it("ignores branch deletions", () => {
    expect(normalise("push", { ...clone(push), deleted: true })).toEqual([]);
  });

  it("marks reverts and extracts the reverted sha", () => {
    const [event] = normalise("push", pushRevert);
    expect(event.kind).toBe("revert");
    expect(event.payload.revertsSha).toBe("a1b2c3d4e5f60718293a4b5c6d7e8f9012345678");
  });

  it("handles a revert without a 'This reverts commit' line", () => {
    const p = clone(pushRevert);
    p.commits[0].message = 'Revert "Add scoring"';
    const [event] = normalise("push", p);
    expect(event.kind).toBe("revert");
    expect(event.payload.revertsSha).toBeUndefined();
  });
});

describe("normalise pull_request", () => {
  it("emits pr_merged for merged closed PRs", () => {
    const [event] = normalise("pull_request", prMerged);
    expect(event).toEqual({
      repoFullName: "krushiraj/shiplog",
      kind: "pr_merged",
      ref: "12",
      occurredAt: new Date("2026-11-08T09:15:41Z"),
      payload: {
        number: 12,
        title: prMerged.pull_request.title,
        body: prMerged.pull_request.body,
        labels: ["ship-it"],
        url: "https://github.com/krushiraj/shiplog/pull/12",
        mergeSha: prMerged.pull_request.merge_commit_sha,
        additions: 182,
        deletions: 37,
        changedFiles: 6,
      },
    });
  });

  it("ignores PRs closed without merging", () => {
    expect(normalise("pull_request", prClosedUnmerged)).toEqual([]);
  });

  it("ignores other PR actions", () => {
    expect(normalise("pull_request", { ...clone(prMerged), action: "opened" })).toEqual([]);
  });
});

describe("normalise release", () => {
  it("emits release on publish", () => {
    const [event] = normalise("release", releasePublished);
    expect(event).toEqual({
      repoFullName: "krushiraj/shiplog",
      kind: "release",
      ref: "v0.2.0",
      occurredAt: new Date("2026-11-08T11:02:30Z"),
      payload: {
        name: "v0.2.0: voice rules",
        body: releasePublished.release.body,
        url: "https://github.com/krushiraj/shiplog/releases/tag/v0.2.0",
        prerelease: false,
      },
    });
  });

  it("keeps prereleases", () => {
    const p = clone(releasePublished);
    p.release.prerelease = true;
    expect(normalise("release", p)[0].payload.prerelease).toBe(true);
  });

  it("skips drafts and other actions", () => {
    const draft = clone(releasePublished);
    draft.release.draft = true;
    expect(normalise("release", draft)).toEqual([]);
    expect(normalise("release", { ...clone(releasePublished), action: "created" })).toEqual([]);
  });
});

describe("normalise issues", () => {
  it("emits issue_closed when completed", () => {
    const [event] = normalise("issues", issueClosed);
    expect(event).toEqual({
      repoFullName: "krushiraj/shiplog",
      kind: "issue_closed",
      ref: "9",
      occurredAt: new Date("2026-11-08T09:15:43Z"),
      payload: {
        number: 9,
        title: "Drafts ignore my edits",
        body: issueClosed.issue.body,
        url: "https://github.com/krushiraj/shiplog/issues/9",
        labels: ["bug"],
      },
    });
  });

  it("ignores not_planned closes and other actions", () => {
    expect(normalise("issues", issueNotPlanned)).toEqual([]);
    expect(normalise("issues", { ...clone(issueClosed), action: "opened" })).toEqual([]);
  });
});

describe("normalise create", () => {
  it("emits tag events using the supplied now", () => {
    const now = new Date("2026-11-08T12:00:00Z");
    expect(normalise("create", createTag, now)).toEqual([
      { repoFullName: "krushiraj/shiplog", kind: "tag", ref: "v0.2.0", occurredAt: now, payload: {} },
    ]);
  });

  it("ignores branch creation", () => {
    expect(normalise("create", createBranch)).toEqual([]);
  });
});

describe("normalise other events", () => {
  it("returns [] for unknown events", () => {
    expect(normalise("star", { action: "created", repository: push.repository })).toEqual([]);
  });

  it("keeps trimmed payloads small", () => {
    const all = [
      ...normalise("push", push),
      ...normalise("pull_request", prMerged),
      ...normalise("release", releasePublished),
      ...normalise("issues", issueClosed),
    ];
    for (const e of all) {
      expect(e.payload).not.toHaveProperty("repository");
      expect(e.payload).not.toHaveProperty("user");
      expect(e.payload).not.toHaveProperty("head");
      expect(JSON.stringify(e.payload).length).toBeLessThan(1000);
    }
  });
});
