import { describe, it, expect, vi } from "vitest";
import { buildBrief, pickKeyFiles, briefProgress, type BriefDeps } from "@/lib/brief";
import type { GitHub } from "@/lib/github/app";

const b64 = (s: string) => Buffer.from(s).toString("base64");

function bigTree() {
  const files = [
    { path: "yarn.lock", size: 900_000 },
    { path: "package-lock.json", size: 800_000 },
    { path: "dist/bundle.js", size: 700_000 },
    { path: "src/lib/__tests__/huge.test.ts", size: 600_000 },
    { path: "src/huge.spec.ts", size: 500_000 },
    { path: "tests/e2e.ts", size: 400_000 },
    { path: "src/types.d.ts", size: 300_000 },
    { path: "logo.png", size: 250_000 },
    { path: "src/index.ts", size: 10 },
    { path: "src/app/page.tsx", size: 20 },
    { path: "README.md", size: 100 },
    { path: "docs/guide.md", size: 100 },
    { path: "package.json", size: 100 },
  ];
  for (let i = 0; i < 80; i++) files.push({ path: `src/mod${i}.ts`, size: 1000 + i });
  return files;
}

describe("pickKeyFiles", () => {
  it("picks at most 40 source files, entry points first, skipping lockfiles, tests and build output", () => {
    const picked = pickKeyFiles(bigTree());
    expect(picked.length).toBeLessThanOrEqual(40);
    expect(picked.slice(0, 2)).toEqual(["src/index.ts", "src/app/page.tsx"]);
    expect(picked).toContain("src/mod79.ts");
    expect(picked).not.toContain("src/mod0.ts");
    for (const bad of ["yarn.lock", "package-lock.json", "dist/bundle.js", "src/lib/__tests__/huge.test.ts", "src/huge.spec.ts", "tests/e2e.ts", "src/types.d.ts", "logo.png", "README.md"]) {
      expect(picked).not.toContain(bad);
    }
  });
});

describe("buildBrief", () => {
  it("reads the repo, summarises key files in batches of 10, and stores the brief keeping existing facts", async () => {
    const tree = bigTree();
    const getContent = vi.fn(async ({ path }: { path: string }) => ({ data: { type: "file", content: b64(`content of ${path}`), encoding: "base64" } }));
    const gh = {
      rest: {
        repos: {
          get: async () => ({ data: { default_branch: "main" } }),
          getReadme: async () => ({ data: { content: b64("# Shiplog\nTurns commits into posts.") } }),
          getContent,
        },
        git: { getTree: async () => ({ data: { tree: tree.map((f) => ({ ...f, type: "blob" })), truncated: false } }) },
      },
    } as unknown as GitHub;

    const calls: { user: string }[] = [];
    const callJson = vi.fn(async (_schema: unknown, args: { user: string }) => {
      calls.push(args);
      if (args.user.includes("<file>")) {
        const paths = [...args.user.matchAll(/path: (\S+)/g)].map((m) => m[1]);
        return { data: { summaries: paths.map((path) => ({ path, summary: `does ${path}` })) }, usage: {} };
      }
      return {
        data: { pitch: "p", audience: "a", problem: "x", architecture: [], glossary: [], stack: ["ts"], milestones: [], facts: ["MIT", "new"] },
        usage: {},
      };
    });

    let saved: Record<string, unknown> | null = null;
    const steps: string[] = [];
    const deps: BriefDeps = {
      store: {
        getProject: async () => ({ brief: { facts: ["User said: launched in 2025", "MIT"] }, repos: [{ repoFullName: "octo/app", installationId: 1 }] }),
        saveBrief: async (_id, brief) => void (saved = brief),
      },
      github: async () => gh,
      callJson: callJson as unknown as BriefDeps["callJson"],
      onProgress: (s) => void steps.push(s),
    };

    await buildBrief("p1", deps);

    const summaryCalls = calls.filter((c) => c.user.includes("<file>"));
    expect(summaryCalls).toHaveLength(4); // 40 files / 10
    const fetched = getContent.mock.calls.map(([a]) => a.path);
    expect(fetched).not.toContain("yarn.lock");
    expect(fetched.filter((p) => p.endsWith(".test.ts"))).toEqual([]);
    expect(fetched).toContain("docs/guide.md");
    expect(fetched).toContain("package.json");

    const final = calls.at(-1)!.user;
    expect(final).toContain("Turns commits into posts.");
    expect(final).toContain("does src/index.ts");
    expect(saved).toMatchObject({ pitch: "p", facts: ["User said: launched in 2025", "MIT", "new"] });
    expect(steps).toEqual([...briefProgress]);
  });
});
