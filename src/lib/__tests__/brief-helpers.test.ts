import { describe, it, expect } from "vitest";
import { outlineTree } from "@/lib/brief/outline";
import { rankFiles, referencedCounts, moduleOf, pickModuleFiles } from "@/lib/brief/rank";
import { mapLimit } from "@/lib/brief/pool";
import { shrinkLevels } from "@/lib/brief/budget";

describe("rankFiles", () => {
  it("prefers central src entry points over large generated, example or script files", () => {
    const tree = [
      { path: "src/generated/schema.ts", size: 90_000 },
      { path: "src/api.generated.ts", size: 80_000 },
      { path: "examples/demo/main.ts", size: 50_000 },
      { path: "scripts/release.ts", size: 40_000 },
      { path: "src/huge.ts", size: 150_000 },
      { path: "src/index.ts", size: 400 },
      { path: "src/core/engine.ts", size: 3000 },
      { path: "src/util.ts", size: 2000 },
    ];
    const ranked = rankFiles(tree, { referenced: new Map([["src/core/engine.ts", 3]]), churn: new Map() }).map((f) => f.path);
    expect(ranked.slice(0, 2)).toEqual(["src/index.ts", "src/core/engine.ts"]);
    expect(ranked).not.toContain("src/huge.ts"); // > 100 KB
    expect(ranked).not.toContain("src/api.generated.ts");
    expect(ranked.indexOf("src/util.ts")).toBeLessThan(ranked.indexOf("examples/demo/main.ts"));
    expect(ranked.indexOf("src/util.ts")).toBeLessThan(ranked.indexOf("scripts/release.ts"));
  });

  it("boosts recently churned files", () => {
    const tree = [
      { path: "src/a.ts", size: 1000 },
      { path: "src/b.ts", size: 1000 },
    ];
    const ranked = rankFiles(tree, { referenced: new Map(), churn: new Map([["src/b.ts", 5]]) });
    expect(ranked[0].path).toBe("src/b.ts");
  });
});

describe("referencedCounts", () => {
  it("counts relative, alias and python imports and manifest entry fields against the tree", () => {
    const paths = ["src/index.ts", "src/lib/db.ts", "src/lib/auth/index.ts", "pkg/core/run.py", "bin/cli.js"];
    const counts = referencedCounts(paths, [
      { path: "src/index.ts", content: `import { db } from "./lib/db";\nimport auth from '@/lib/auth';\nconst x = require("./lib/db.ts");` },
      { path: "src/app.ts", content: `export * from "./lib/db.js";` },
      { path: "main.py", content: "from pkg.core.run import go" },
      { path: "package.json", content: JSON.stringify({ main: "bin/cli.js" }) },
    ]);
    expect(counts.get("src/lib/db.ts")).toBe(2);
    expect(counts.get("src/lib/auth/index.ts")).toBe(1);
    expect(counts.get("pkg/core/run.py")).toBe(1);
    expect(counts.get("bin/cli.js")).toBe(1);
  });
});

describe("moduleOf / pickModuleFiles", () => {
  it("groups monorepo packages by two segments and others by one", () => {
    expect(moduleOf("packages/web/src/index.ts")).toBe("packages/web");
    expect(moduleOf("src/lib/x.ts")).toBe("src/lib");
    expect(moduleOf("server/main.go")).toBe("server");
    expect(moduleOf("main.go")).toBe(".");
  });

  it("takes at most 6 files per module and 60 overall, spread across modules", () => {
    const tree = [];
    for (let m = 0; m < 20; m++) for (let i = 0; i < 20; i++) tree.push({ path: `packages/p${m}/src/f${i}.ts`, size: 1000 });
    const picked = pickModuleFiles(rankFiles(tree, { referenced: new Map(), churn: new Map() }));
    expect(picked.length).toBe(60);
    const perModule = new Map<string, number>();
    for (const p of picked) perModule.set(moduleOf(p.path), (perModule.get(moduleOf(p.path)) ?? 0) + 1);
    expect(Math.max(...perModule.values())).toBeLessThanOrEqual(6);
    expect(perModule.size).toBeGreaterThanOrEqual(10);
  });
});

describe("outlineTree", () => {
  const big = () => {
    const paths: string[] = ["package.json", "README.md"];
    for (let d = 0; d < 30; d++) for (let s = 0; s < 10; s++) for (let f = 0; f < 70; f++) paths.push(`top${d}/sub${s}/file${f}.ts`);
    return paths; // 21k files
  };

  it("fits the budget and mentions every top-level dir with file counts", () => {
    const out = outlineTree(big(), 6000);
    expect(out.length).toBeLessThanOrEqual(6000);
    for (let d = 0; d < 30; d++) expect(out).toMatch(new RegExp(`(^|\\n)top${d}/ \\(700\\)`));
    expect(out).toContain("package.json");
  });

  it("shows sample filenames and expands subfolders when there is room", () => {
    const out = outlineTree(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/lib/x.ts"], 6000);
    expect(out).toContain("src/ (5)");
    expect(out).toContain("lib/ (1)");
    expect(out).toMatch(/a\.ts, b\.ts, c\.ts/);
    expect(out).not.toContain("d.ts");
  });

  it("lists directory markers (paths ending in /) even with no known files", () => {
    expect(outlineTree(["src/a.ts", "vendor-big/"], 6000)).toContain("vendor-big/");
  });
});

describe("mapLimit", () => {
  it("runs at most N at once and keeps order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(peak).toBe(4);
  });
});

describe("shrinkLevels", () => {
  it("get strictly smaller", () => {
    for (let i = 1; i < shrinkLevels.length; i++) {
      expect(shrinkLevels[i].fileClip).toBeLessThanOrEqual(shrinkLevels[i - 1].fileClip);
      expect(shrinkLevels[i].docs).toBeLessThanOrEqual(shrinkLevels[i - 1].docs);
      expect(shrinkLevels[i].outlineChars).toBeLessThan(shrinkLevels[i - 1].outlineChars);
    }
  });
});
