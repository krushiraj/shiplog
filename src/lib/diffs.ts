import { scrub } from "./scrub";

const SKIP_PATTERNS: RegExp[] = [
  /(^|\/)(yarn\.lock|package-lock\.json|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|Gemfile\.lock|go\.sum)$/,
  /(^|\/)(dist|build|\.next|out|vendor|node_modules|__generated__)\//,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.generated\.[^/]+$/,
  /(^|\/)drizzle\/(.*\/)?[^/]+\.sql$/,
  /(^|\/)(drizzle|migrations)\/(.*\/)?meta\/[^/]+\.json$/,
  /\.snap$/,
  /\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|mp4)$/i,
];

export function shouldSkipFile(path: string): boolean {
  return SKIP_PATTERNS.some((re) => re.test(path));
}

export type FileDiff = { file: string; patch?: string; additions?: number; deletions?: number };
export type BudgetedFile = { file: string; patch: string; truncated: boolean; additions: number; deletions: number };

export function budgetHunks(
  files: FileDiff[],
  opts: { maxLinesPerFile: number; maxFiles: number } = { maxLinesPerFile: 40, maxFiles: 25 },
): BudgetedFile[] {
  return files
    .filter((f) => !shouldSkipFile(f.file))
    .map((f) => ({ ...f, additions: f.additions ?? 0, deletions: f.deletions ?? 0 }))
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
    .slice(0, opts.maxFiles)
    .map(({ file, patch, additions, deletions }) => {
      // Scrub before truncating so a secret split by the cut is still caught.
      const lines = scrub(patch ?? "").split("\n");
      const truncated = lines.length > opts.maxLinesPerFile;
      const kept = truncated
        ? [...lines.slice(0, opts.maxLinesPerFile), `… (${lines.length - opts.maxLinesPerFile} more lines)`]
        : lines;
      return { file, patch: kept.join("\n"), truncated, additions, deletions };
    });
}
