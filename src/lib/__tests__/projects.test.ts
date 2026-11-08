import { describe, it, expect, vi } from "vitest";
import { createProject, configDiff, ProjectInputError, type ProjectDeps, type ProjectStore } from "@/lib/projects";
import { DEFAULTS } from "@/lib/config";
import type { CachedChannel } from "@/db/schema";

const channel = (id: string, service: string, isDisconnected = false): CachedChannel => ({
  id,
  name: id,
  displayName: null,
  service,
  avatar: "",
  isDisconnected,
  isLocked: false,
  isQueuePaused: false,
  timezone: null,
  type: null,
  descriptor: null,
});

function fakeDeps(over: Partial<ProjectStore> = {}) {
  const inserted: { project: Parameters<ProjectStore["insertProject"]>[0]; repos: Parameters<ProjectStore["insertProject"]>[1] }[] = [];
  const store: ProjectStore = {
    getUser: async () => ({ defaults: {}, channels: [channel("ch-li", "linkedin"), channel("ch-x", "twitter"), channel("ch-off", "threads", true)] }),
    installationIds: async () => [11, 22],
    insertProject: async (project, repos) => {
      inserted.push({ project, repos });
      return "proj-1";
    },
    ...over,
  };
  const listRepos = vi.fn(async (installationId: number) =>
    installationId === 11
      ? [{ fullName: "kr/encore-web", defaultBranch: "main", private: false, description: null }]
      : [{ fullName: "acme/api", defaultBranch: "main", private: true, description: null }],
  );
  const deps: ProjectDeps = { store, listRepos };
  return { deps, inserted, listRepos };
}

const valid = {
  name: "Encore",
  repos: [{ fullName: "kr/encore-web", installationId: 11 }],
  channels: ["ch-li", "ch-x"],
  timezone: "Asia/Kolkata",
  digestEvery: "1d",
  digestAt: "18:30",
  reviewMode: "inbox",
};

describe("createProject", () => {
  it("creates the project with only non-default config fields and its repos", async () => {
    const { deps, inserted } = fakeDeps();
    const res = await createProject("u1", valid, deps);
    expect(res).toEqual({ id: "proj-1" });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].project).toEqual({
      userId: "u1",
      name: "Encore",
      config: { channels: ["ch-li", "ch-x"], timezone: "Asia/Kolkata" },
    });
    expect(inserted[0].repos).toEqual([{ repoFullName: "kr/encore-web", installationId: 11 }]);
  });

  it("stores changed digest and review settings", async () => {
    const { deps, inserted } = fakeDeps();
    await createProject("u1", { ...valid, digestEvery: "weekly:Fri", digestAt: "09:00", reviewMode: "draft" }, deps);
    expect(inserted[0].project.config).toMatchObject({
      triggers: { digest: { every: "weekly:Fri", at: "09:00" } },
      review: { mode: "draft" },
    });
  });

  it("rejects invalid input", async () => {
    const { deps, inserted } = fakeDeps();
    await expect(createProject("u1", { ...valid, name: " " }, deps)).rejects.toBeInstanceOf(ProjectInputError);
    await expect(createProject("u1", { ...valid, repos: [] }, deps)).rejects.toBeInstanceOf(ProjectInputError);
    await expect(createProject("u1", { ...valid, timezone: "Mars/Olympus" }, deps)).rejects.toBeInstanceOf(ProjectInputError);
    await expect(createProject("u1", { ...valid, digestAt: "25:00" }, deps)).rejects.toBeInstanceOf(ProjectInputError);
    await expect(createProject("u1", { ...valid, reviewMode: "yolo" }, deps)).rejects.toBeInstanceOf(ProjectInputError);
    expect(inserted).toHaveLength(0);
  });

  it("rejects repos from an installation the user does not own", async () => {
    const { deps, inserted, listRepos } = fakeDeps();
    const input = { ...valid, repos: [{ fullName: "evil/repo", installationId: 99 }] };
    await expect(createProject("u1", input, deps)).rejects.toMatchObject({ status: 403 });
    expect(listRepos).not.toHaveBeenCalledWith(99);
    expect(inserted).toHaveLength(0);
  });

  it("rejects repos the installation cannot access", async () => {
    const { deps, inserted } = fakeDeps();
    const input = { ...valid, repos: [{ fullName: "acme/api", installationId: 11 }] };
    await expect(createProject("u1", input, deps)).rejects.toMatchObject({ status: 403 });
    expect(inserted).toHaveLength(0);
  });

  it("accepts repos across several of the user's installations", async () => {
    const { deps, inserted } = fakeDeps();
    const input = { ...valid, repos: [{ fullName: "kr/encore-web", installationId: 11 }, { fullName: "acme/api", installationId: 22 }] };
    await createProject("u1", input, deps);
    expect(inserted[0].repos.map((r) => r.repoFullName)).toEqual(["kr/encore-web", "acme/api"]);
  });

  it("rejects unknown or disconnected channels", async () => {
    const { deps } = fakeDeps();
    await expect(createProject("u1", { ...valid, channels: ["nope"] }, deps)).rejects.toBeInstanceOf(ProjectInputError);
    await expect(createProject("u1", { ...valid, channels: ["ch-off"] }, deps)).rejects.toBeInstanceOf(ProjectInputError);
  });

  it("fails when the user does not exist", async () => {
    const { deps } = fakeDeps({ getUser: async () => null });
    await expect(createProject("u1", valid, deps)).rejects.toMatchObject({ status: 401 });
  });
});

describe("configDiff", () => {
  it("is empty when everything matches the baseline", () => {
    const diff = configDiff(
      { channels: [], timezone: "UTC", digestEvery: "1d", digestAt: "18:30", reviewMode: "inbox" },
      DEFAULTS,
    );
    expect(diff).toEqual({});
  });
});
