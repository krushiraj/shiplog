import type { GitHub } from "../github/app";
import type { TreeFile } from "./rank";

const TOP_DIRS = 15;
const CHURN_COMMITS = 15;
const NOISY_COMMIT_FILES = 50;

type Entry = { path?: string; type?: string; size?: number; sha?: string };

const blobsOf = (entries: Entry[], prefix = ""): TreeFile[] =>
  entries.filter((t) => t.type === "blob" && t.path).map((t) => ({ path: prefix + t.path!, size: t.size, sha: t.sha }));

/**
 * The repo's file list. When GitHub truncates the recursive tree, keep the partial list, then re-read the
 * ~15 biggest top-level dirs as their own (much smaller) trees; other dirs become "dir/" markers.
 */
export async function fetchTree(gh: GitHub, owner: string, repo: string, ref: string): Promise<{ files: TreeFile[]; dirs: string[]; truncated: boolean }> {
  const { data } = await gh.rest.git.getTree({ owner, repo, tree_sha: ref, recursive: "true" });
  const partial = blobsOf(data.tree);
  if (!data.truncated) return { files: partial, dirs: [], truncated: false };

  const { data: top } = await gh.rest.git.getTree({ owner, repo, tree_sha: ref });
  const seen = new Map<string, number>();
  for (const f of partial) if (f.path.includes("/")) seen.set(f.path.split("/")[0], (seen.get(f.path.split("/")[0]) ?? 0) + 1);
  const dirs = top.tree.filter((t) => t.type === "tree" && t.path && t.sha);
  const biggest = [...dirs].sort((a, b) => (seen.get(b.path!) ?? 0) - (seen.get(a.path!) ?? 0)).slice(0, TOP_DIRS);

  const subtrees = await Promise.all(
    biggest.map(async (d) => {
      try {
        const { data: sub } = await gh.rest.git.getTree({ owner, repo, tree_sha: d.sha!, recursive: "true" });
        return { dir: d.path!, files: blobsOf(sub.tree, `${d.path}/`) };
      } catch {
        return null;
      }
    }),
  );
  const reread = new Set(subtrees.filter((s) => s !== null).map((s) => s.dir));
  const files = [
    ...blobsOf(top.tree),
    ...partial.filter((f) => f.path.includes("/") && !reread.has(f.path.split("/")[0])),
    ...subtrees.flatMap((s) => s?.files ?? []),
  ];
  const known = new Set(files.map((f) => f.path.split("/")[0]));
  return { files, dirs: dirs.filter((d) => !known.has(d.path!)).map((d) => `${d.path}/`), truncated: true };
}

/** How often each file was touched in the last ~15 commits on `ref` (bulk commits over 50 files are ignored). */
export async function recentChurn(gh: GitHub, owner: string, repo: string, ref: string): Promise<Map<string, number>> {
  const churn = new Map<string, number>();
  try {
    const { data: commits } = await gh.rest.repos.listCommits({ owner, repo, sha: ref, per_page: 30 });
    const details = await Promise.all(
      commits.slice(0, CHURN_COMMITS).map((c) => gh.rest.repos.getCommit({ owner, repo, ref: c.sha }).then((r) => r.data.files ?? [], () => [])),
    );
    for (const files of details) {
      if (files.length > NOISY_COMMIT_FILES) continue;
      for (const f of files) churn.set(f.filename, (churn.get(f.filename) ?? 0) + 1);
    }
  } catch {}
  return churn;
}
