import { describe, expect, it } from "vitest";
import { budgetHunks, shouldSkipFile } from "../diffs";

describe("shouldSkipFile", () => {
  it.each([
    "yarn.lock",
    "package-lock.json",
    "apps/web/pnpm-lock.yaml",
    "Cargo.lock",
    "poetry.lock",
    "Gemfile.lock",
    "go.sum",
    "dist/index.js",
    "packages/x/build/out.js",
    ".next/server/page.js",
    "out/index.html",
    "vendor/lib.go",
    "node_modules/react/index.js",
    "public/app.min.js",
    "styles/app.min.css",
    "dist.js.map",
    "src/__generated__/types.ts",
    "src/schema.generated.ts",
    "drizzle/0001_init.sql",
    "drizzle/meta/_journal.json",
    "migrations/meta/0001_snapshot.json",
    "src/__snapshots__/a.test.ts.snap",
    "public/logo.png",
    "a.jpg",
    "a.JPEG",
    "a.gif",
    "a.webp",
    "favicon.ico",
    "doc.pdf",
    "x.zip",
    "f.woff",
    "f.woff2",
    "f.ttf",
    "v.mp4",
  ])("skips %s", (p) => {
    expect(shouldSkipFile(p)).toBe(true);
  });

  it.each([
    "src/app/page.tsx",
    "src/lib/build-post.ts",
    "README.md",
    "src/output/format.ts",
    "package.json",
    "src/meta/config.json",
  ])("keeps %s", (p) => {
    expect(shouldSkipFile(p)).toBe(false);
  });
});

const lines = (n: number) => Array.from({ length: n }, (_, i) => `+line ${i}`).join("\n");

describe("budgetHunks", () => {
  it("drops skipped files", () => {
    const out = budgetHunks([
      { file: "yarn.lock", patch: lines(3), additions: 3, deletions: 0 },
      { file: "src/a.ts", patch: lines(2), additions: 2, deletions: 0 },
    ]);
    expect(out.map((f) => f.file)).toEqual(["src/a.ts"]);
  });

  it("truncates long patches with a marker", () => {
    const [f] = budgetHunks([{ file: "src/a.ts", patch: lines(50), additions: 50, deletions: 0 }]);
    const out = f.patch.split("\n");
    expect(f.truncated).toBe(true);
    expect(out).toHaveLength(41);
    expect(out[39]).toBe("+line 39");
    expect(out[40]).toBe("… (10 more lines)");
  });

  it("leaves short patches untouched and honours custom limits", () => {
    const [f] = budgetHunks([{ file: "src/a.ts", patch: lines(5) }], { maxLinesPerFile: 5, maxFiles: 25 });
    expect(f).toEqual({ file: "src/a.ts", patch: lines(5), truncated: false, additions: 0, deletions: 0 });
  });

  it("defaults a missing patch to an empty string", () => {
    const [f] = budgetHunks([{ file: "src/a.ts" }]);
    expect(f.patch).toBe("");
    expect(f.truncated).toBe(false);
  });

  it("keeps the biggest files when over maxFiles", () => {
    const out = budgetHunks(
      [
        { file: "small.ts", patch: "+a", additions: 1, deletions: 0 },
        { file: "big.ts", patch: "+a", additions: 10, deletions: 5 },
        { file: "mid.ts", patch: "+a", additions: 3, deletions: 3 },
      ],
      { maxLinesPerFile: 40, maxFiles: 2 },
    );
    expect(out.map((f) => f.file)).toEqual(["big.ts", "mid.ts"]);
  });

  it("scrubs secrets from patches", () => {
    const token = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const [f] = budgetHunks([{ file: "src/a.ts", patch: `+const t = "${token}";` }]);
    expect(f.patch).not.toContain(token);
    expect(f.patch).toContain("[REDACTED]");
  });
});
