import { describe, it, expect, vi } from "vitest";
import { buildBrief, pickKeyFiles, briefProgress, type BriefDeps, type BriefStore } from "@/lib/brief";
import type { BriefBuildStatus } from "@/lib/brief/status";
import { estimateTokens } from "@/lib/ai/pricing";
import type { GitHub } from "@/lib/github/app";
import { AiBudgetError } from "@/lib/ai/budget";

const b64 = (s: string) => Buffer.from(s).toString("base64");

type F = { path: string; size?: number; sha?: string };

function bigTree(): F[] {
  const files: F[] = [
    { path: "yarn.lock", size: 900_000 },
    { path: "package-lock.json", size: 800_000 },
    { path: "dist/bundle.js", size: 700_000 },
    { path: "src/lib/__tests__/huge.test.ts", size: 600_000 },
    { path: "src/huge.spec.ts", size: 500_000 },
    { path: "tests/e2e.ts", size: 400_000 },
    { path: "src/types.d.ts", size: 300_000 },
    { path: "src/api.generated.ts", size: 90_000 },
    { path: "logo.png", size: 250_000 },
    { path: "src/index.ts", size: 10 },
    { path: "src/app/page.tsx", size: 20 },
    { path: "README.md", size: 100 },
    { path: "docs/guide.md", size: 100 },
    { path: "package.json", size: 100 },
  ];
  for (let i = 0; i < 80; i++) files.push({ path: `src/mod${i}.ts`, size: 1000 + i });
  return files.map((f) => ({ ...f, sha: `sha-${f.path}` }));
}

function fakeGitHub(tree: F[], opts: { readme?: string; content?: (path: string) => string; truncatedAt?: number } = {}) {
  const getContent = vi.fn(async ({ path }: { path: string }) => ({
    data: { type: "file", content: b64(opts.content?.(path) ?? `content of ${path}`), encoding: "base64" },
  }));
  const asEntries = (files: F[]) => files.map((f) => ({ ...f, type: "blob" }));
  const getTree = vi.fn(async ({ tree_sha, recursive }: { tree_sha: string; recursive?: string }) => {
    if (opts.truncatedAt === undefined) return { data: { tree: asEntries(tree), truncated: false } };
    if (tree_sha === "main" && recursive) return { data: { tree: asEntries(tree.slice(0, opts.truncatedAt)), truncated: true } };
    if (tree_sha === "main") {
      const dirs = [...new Set(tree.filter((f) => f.path.includes("/")).map((f) => f.path.split("/")[0]))];
      return { data: { tree: [...asEntries(tree.filter((f) => !f.path.includes("/"))), ...dirs.map((d) => ({ path: d, type: "tree", sha: `dir:${d}` }))], truncated: false } };
    }
    const dir = tree_sha.slice(4);
    const sub = tree.filter((f) => f.path.startsWith(`${dir}/`)).map((f) => ({ ...f, path: f.path.slice(dir.length + 1) }));
    return { data: { tree: asEntries(sub), truncated: false } };
  });
  const gh = {
    rest: {
      repos: {
        get: async () => ({ data: { default_branch: "main" } }),
        getReadme: async () => ({ data: { content: b64(opts.readme ?? "# Shiplog\nTurns commits into posts.") } }),
        getContent,
        listCommits: async () => ({ data: [{ sha: "c1" }, { sha: "c2" }] }),
        getCommit: async () => ({ data: { files: [{ filename: "src/mod3.ts" }] } }),
      },
      git: { getTree },
    },
  } as unknown as GitHub;
  return { gh, getContent, getTree };
}

const BRIEF = { pitch: "p", audience: "a", problem: "x", architecture: [], glossary: [], stack: ["ts"], milestones: [], facts: ["MIT", "new"] };

type Call = { system: string; user: string; model?: string; meta?: { purpose: string; projectId?: string; refType?: string } };

function fakeAi({ delayMs = 0, hangSummaries = false, hangFinal = false } = {}) {
  const calls: Call[] = [];
  let inFlight = 0;
  let peak = 0;
  const callJson = vi.fn(async (_schema: unknown, args: Call) => {
    calls.push(args);
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      if (args.user.includes("<file>")) {
        if (hangSummaries) await new Promise(() => {});
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        const paths = [...args.user.matchAll(/path: (\S+)/g)].map((m) => m[1]);
        return { data: { summaries: paths.map((path) => ({ path, summary: `does ${path}` })) }, usage: {} };
      }
      if (args.user.includes("<module>")) {
        const names = [...args.user.matchAll(/name: (\S+)/g)].map((m) => m[1]);
        return { data: { modules: names.map((module) => ({ module, summary: `module ${module} handles things` })) }, usage: {} };
      }
      if (hangFinal) await new Promise(() => {});
      return { data: BRIEF, usage: {} };
    } finally {
      inFlight--;
    }
  });
  return { calls, callJson: callJson as unknown as BriefDeps["callJson"], peak: () => peak };
}

function memoryStore(repos: { repoFullName: string; installationId: number }[], cache = new Map<string, string>()) {
  const statuses: BriefBuildStatus[] = [];
  let saved: Record<string, unknown> | null = null;
  const savedSummaries: { repoFullName: string; path: string; blobSha: string; summary: string; model: string }[] = [];
  const store: BriefStore = {
    getProject: async () => ({ brief: { facts: ["User said: launched in 2025", "MIT"] }, repos, userId: "u1", name: "Shiplog", isDemo: false }),
    saveBrief: async (_id, brief) => void (saved = brief),
    saveStatus: async (_id, s) => void statuses.push(structuredClone(s)),
    cachedSummaries: async (repo, files) =>
      new Map(files.filter((f) => cache.has(`${repo}:${f.path}:${f.sha}`)).map((f) => [f.path, cache.get(`${repo}:${f.path}:${f.sha}`)!])),
    saveSummaries: async (rows) => void savedSummaries.push(...rows),
  };
  return { store, statuses, savedSummaries, saved: () => saved };
}

const summaryCalls = (calls: Call[]) => calls.filter((c) => c.user.includes("<file>"));
const moduleCalls = (calls: Call[]) => calls.filter((c) => c.user.includes("<module>"));

describe("pickKeyFiles", () => {
  it("picks at most 40 ranked source files, entry points first, skipping lockfiles, tests, generated and build output", () => {
    const picked = pickKeyFiles(bigTree());
    expect(picked.length).toBeLessThanOrEqual(40);
    expect(picked.slice(0, 2).sort()).toEqual(["src/app/page.tsx", "src/index.ts"]);
    for (const bad of ["yarn.lock", "package-lock.json", "dist/bundle.js", "src/lib/__tests__/huge.test.ts", "src/huge.spec.ts", "tests/e2e.ts", "src/types.d.ts", "src/api.generated.ts", "logo.png", "README.md"]) {
      expect(picked).not.toContain(bad);
    }
  });
});

describe("buildBrief", () => {
  const oneRepo = [{ repoFullName: "octo/app", installationId: 1 }];

  it("summarises key files with Haiku in parallel batches of 10, then writes the brief with Sonnet keeping existing facts", async () => {
    const { gh, getContent } = fakeGitHub(bigTree());
    const ai = fakeAi({ delayMs: 10 });
    const mem = memoryStore(oneRepo);
    const steps: string[] = [];
    await buildBrief("p1", { store: mem.store, github: async () => gh, callJson: ai.callJson, onProgress: (s) => void steps.push(s) });

    const batches = summaryCalls(ai.calls);
    expect(batches).toHaveLength(4); // 40 files / 10
    expect(ai.peak()).toBe(4);
    for (const c of batches) {
      expect(c.model).toBe("claude-haiku-5-5");
      expect(c.meta).toMatchObject({ purpose: "brief-files", userId: "u1", projectId: "p1", refType: "project", refId: "p1" });
    }
    expect(moduleCalls(ai.calls)).toHaveLength(0);

    const fetched = getContent.mock.calls.map(([a]) => a.path);
    expect(fetched).not.toContain("yarn.lock");
    expect(fetched.filter((p) => p.endsWith(".test.ts"))).toEqual([]);
    expect(fetched).toContain("docs/guide.md");
    expect(fetched).toContain("package.json");

    const final = ai.calls.at(-1)!;
    expect(final.model).toBeUndefined();
    expect(final.meta).toMatchObject({ purpose: "brief", userId: "u1", projectId: "p1", refType: "project", refId: "p1" });
    expect(final.user).toContain("Turns commits into posts.");
    expect(final.user).toContain("does src/index.ts");
    expect(final.user).toContain("src/ (");
    expect(mem.saved()).toMatchObject({ pitch: "p", facts: ["User said: launched in 2025", "MIT", "new"] });
    expect(mem.saved()).not.toHaveProperty("partial");
    expect(steps).toEqual([...briefProgress]);

    expect(mem.statuses.map((s) => s.step)).toEqual([...briefProgress]);
    const done = mem.statuses.at(-1)!;
    expect(done.finishedAt).toBeTruthy();
    expect(done.stats).toMatchObject({ files: 40, cachedSummaries: 0, newSummaries: 40 });
    expect(done.stats.estTokens).toBeGreaterThan(0);
    expect(mem.savedSummaries).toHaveLength(40);
    expect(mem.savedSummaries[0]).toMatchObject({ repoFullName: "octo/app", model: "claude-haiku-5-5" });
    expect(mem.savedSummaries[0].blobSha).toMatch(/^sha-/);
  });

  it("reuses cached summaries for unchanged blobs and only summarises changed files", async () => {
    const tree = bigTree();
    const cache = new Map<string, string>();
    for (const f of tree) cache.set(`octo/app:${f.path}:${f.sha}`, `cached ${f.path}`);
    const changed = tree.find((f) => f.path === "src/index.ts")!;
    changed.sha = "sha-new";
    const { gh, getContent } = fakeGitHub(tree);
    const ai = fakeAi();
    const mem = memoryStore(oneRepo, cache);
    await buildBrief("p1", { store: mem.store, github: async () => gh, callJson: ai.callJson });

    const batches = summaryCalls(ai.calls);
    expect(batches).toHaveLength(1);
    expect(batches[0].user).toContain("path: src/index.ts");
    expect(batches[0].user).not.toContain("path: src/mod");
    expect(getContent.mock.calls.map(([a]) => a.path).filter((p) => p.startsWith("src/mod"))).toEqual([]);
    expect(ai.calls.at(-1)!.user).toContain("cached src/mod");
    expect(mem.savedSummaries.map((r) => r.path)).toEqual(["src/index.ts"]);
    expect(mem.statuses.at(-1)!.stats).toMatchObject({ cachedSummaries: 39, newSummaries: 1 });
  });

  it("goes hierarchical above 2,000 source files: per-module picks, module summaries, brief from modules", async () => {
    const tree: F[] = [{ path: "package.json", sha: "m" }];
    for (let p = 0; p < 25; p++) for (let i = 0; i < 100; i++) tree.push({ path: `packages/p${p}/src/f${i}.ts`, size: 2000, sha: `s${p}-${i}` });
    const { gh } = fakeGitHub(tree);
    const ai = fakeAi();
    const mem = memoryStore(oneRepo);
    await buildBrief("p1", { store: mem.store, github: async () => gh, callJson: ai.callJson });

    const summarised = summaryCalls(ai.calls).flatMap((c) => [...c.user.matchAll(/path: (\S+)/g)].map((m) => m[1]));
    expect(summarised.length).toBe(60);
    expect(moduleCalls(ai.calls).length).toBeGreaterThan(0);
    const final = ai.calls.at(-1)!.user;
    expect(final).toContain("module packages/p0 handles things");
    expect(final).not.toContain("does packages/");
  });

  it("goes hierarchical with more than 3 repos", async () => {
    const repos = ["a/1", "a/2", "a/3", "a/4"].map((repoFullName) => ({ repoFullName, installationId: 1 }));
    const { gh } = fakeGitHub(bigTree());
    const ai = fakeAi();
    await buildBrief("p1", { store: memoryStore(repos).store, github: async () => gh, callJson: ai.callJson });
    expect(moduleCalls(ai.calls).length).toBeGreaterThan(0);
  });

  it("falls back to top-level subtrees when GitHub truncates the tree", async () => {
    const tree: F[] = [{ path: "package.json", sha: "m" }];
    for (const d of ["api", "web", "zeta"]) for (let i = 0; i < 30; i++) tree.push({ path: `${d}/src/f${i}.ts`, size: 1000, sha: `${d}${i}` });
    const { gh, getTree } = fakeGitHub(tree, { truncatedAt: 5 });
    const ai = fakeAi();
    await buildBrief("p1", { store: memoryStore(oneRepo).store, github: async () => gh, callJson: ai.callJson });

    expect(getTree.mock.calls.map(([a]) => a.tree_sha)).toEqual(expect.arrayContaining(["dir:api", "dir:web", "dir:zeta"]));
    const final = ai.calls.at(-1)!.user;
    for (const d of ["api/ (30)", "web/ (30)", "zeta/ (30)"]) expect(final).toContain(d);
    const summarised = summaryCalls(ai.calls).flatMap((c) => [...c.user.matchAll(/path: (\S+)/g)].map((m) => m[1]));
    expect(summarised.some((p) => p.startsWith("zeta/"))).toBe(true);
  });

  it("shrinks docs, clips and outline until the whole build is estimated under 120k input tokens", async () => {
    const repos = Array.from({ length: 8 }, (_, i) => ({ repoFullName: `o/r${i}`, installationId: 1 }));
    const tree: F[] = [{ path: "package.json", sha: "m" }];
    for (let d = 0; d < 12; d++) tree.push({ path: `docs/d${d}.md`, sha: `d${d}` });
    for (let i = 0; i < 300; i++) tree.push({ path: `src/m${i % 12}/f${i}.ts`, size: 5000, sha: `f${i}` });
    const { gh } = fakeGitHub(tree, { readme: "R".repeat(20_000), content: () => "x ".repeat(10_000) });
    const ai = fakeAi();
    const mem = memoryStore(repos);
    await buildBrief("p1", { store: mem.store, github: async () => gh, callJson: ai.callJson });

    const total = ai.calls.reduce((s, c) => s + estimateTokens(c.system + c.user), 0);
    expect(total).toBeLessThanOrEqual(120_000);
    const est = mem.statuses.at(-1)!.stats.estTokens;
    expect(est).toBeLessThanOrEqual(120_000);
    expect(est).toBeGreaterThan(0);
    expect((ai.calls.at(-1)!.user.match(/<doc>/g) ?? []).length).toBeLessThan(80);
  });

  it("saves a partial brief from what is done when file summaries run past the time budget", async () => {
    const { gh } = fakeGitHub(bigTree());
    const ai = fakeAi({ hangSummaries: true });
    const mem = memoryStore(oneRepo);
    await buildBrief("p1", { store: mem.store, github: async () => gh, callJson: ai.callJson, timeBudgetMs: 200 });
    expect(mem.saved()).toMatchObject({ pitch: "p", partial: true });
    expect(mem.statuses.at(-1)).toMatchObject({ step: "Done", partial: true });
  });

  it("saves a fallback partial brief when the final call runs past the time budget", async () => {
    const { gh } = fakeGitHub(bigTree());
    const ai = fakeAi({ hangFinal: true });
    const mem = memoryStore(oneRepo);
    await buildBrief("p1", { store: mem.store, github: async () => gh, callJson: ai.callJson, timeBudgetMs: 200 });
    const saved = mem.saved()!;
    expect(saved.partial).toBe(true);
    expect(saved.pitch).toContain("Shiplog");
    expect((saved.architecture as unknown[]).length).toBeGreaterThan(0);
    expect(saved.facts).toEqual(["User said: launched in 2025", "MIT"]);
  });

  it("saves a partial brief with error 'budget' when the daily AI budget runs out", async () => {
    const { gh } = fakeGitHub(bigTree());
    const mem = memoryStore(oneRepo);
    const callJson = vi.fn(async () => {
      throw new AiBudgetError("Daily AI budget reached", 0, 0.01);
    });
    await buildBrief("p1", { store: mem.store, github: async () => gh, callJson: callJson as unknown as BriefDeps["callJson"] });
    expect(mem.saved()).toMatchObject({ partial: true, facts: ["User said: launched in 2025", "MIT"] });
    expect(mem.statuses.at(-1)).toMatchObject({ step: "Done", partial: true, error: "budget" });
    expect(callJson.mock.calls.length).toBeLessThanOrEqual(4); // stops after the first budget refusals, no final call
  });

  it("records Failed with the error when the build throws", async () => {
    const { gh } = fakeGitHub(bigTree());
    const mem = memoryStore(oneRepo);
    const callJson = (async () => {
      throw new Error("boom");
    }) as unknown as BriefDeps["callJson"];
    await expect(buildBrief("p1", { store: mem.store, github: async () => gh, callJson })).rejects.toThrow("boom");
    expect(mem.statuses.at(-1)).toMatchObject({ step: "Failed", error: "boom" });
  });
});
