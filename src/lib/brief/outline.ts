type Dir = { name: string; depth: number; count: number; files: string[]; dirs: Map<string, Dir> };

const SAMPLES = 3;
const ROOT_SAMPLES = 8;
const MAX_DEPTH = 6;
const ENTRYISH = /^(index|main|app|server|cli|mod|lib|page|layout|__init__)\./;

const newDir = (name: string, depth: number): Dir => ({ name, depth, count: 0, files: [], dirs: new Map() });

function build(paths: string[]): Dir {
  const root = newDir("", 0);
  for (const p of paths) {
    const isDir = p.endsWith("/");
    const parts = p.replace(/\/$/, "").split("/");
    const file = isDir ? null : parts.pop()!;
    let node = root;
    if (file) root.count++;
    for (const part of parts) {
      let child = node.dirs.get(part);
      if (!child) node.dirs.set(part, (child = newDir(part, node.depth + 1)));
      node = child;
      if (file) node.count++;
    }
    if (file) node.files.push(file);
  }
  return root;
}

function samples(files: string[], n: number): string[] {
  return [...files].sort((a, b) => Number(ENTRYISH.test(b)) - Number(ENTRYISH.test(a)) || a.localeCompare(b)).slice(0, n);
}

function line(d: Dir, expanded: boolean): string {
  const s = samples(d.files, SAMPLES);
  const more = d.files.length > s.length ? ", …" : "";
  const hidden = !expanded && d.dirs.size > 0 ? ` +${d.dirs.size} subdirs` : "";
  return `${"  ".repeat(d.depth - 1)}${d.name}/ (${d.count})${s.length ? ` ${s.join(", ")}${more}` : ""}${hidden}`;
}

function render(root: Dir, expanded: Set<Dir>): string {
  const out: string[] = [];
  const rootFiles = samples(root.files, ROOT_SAMPLES);
  if (rootFiles.length) out.push(`${rootFiles.join(", ")}${root.files.length > rootFiles.length ? `, … (${root.files.length} root files)` : ""}`);
  const walk = (d: Dir) => {
    for (const child of [...d.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(line(child, expanded.has(child)));
      if (expanded.has(child)) walk(child);
    }
  };
  walk(root);
  return out.join("\n");
}

/**
 * A collapsed directory outline: every top-level dir with its file count and up to 3 sample files,
 * then the biggest dirs expanded one level at a time while the result still fits `budgetChars`.
 * Paths ending in "/" are directories whose contents are unknown (e.g. from a truncated tree).
 */
export function outlineTree(paths: string[], budgetChars = 6000): string {
  const root = build(paths);
  const expanded = new Set<Dir>();
  let text = render(root, expanded);
  if (text.length > budgetChars) return `${text.slice(0, Math.max(0, budgetChars - 2))}\n…`.slice(0, budgetChars);

  let size = text.length;
  const queue = [...root.dirs.values()];
  while (queue.length) {
    queue.sort((a, b) => b.count - a.count);
    const d = queue.shift()!;
    if (d.dirs.size === 0 || d.depth >= MAX_DEPTH) continue;
    const children = [...d.dirs.values()];
    const delta = line(d, true).length - line(d, false).length + children.reduce((s, c) => s + line(c, false).length + 1, 0);
    if (size + delta > budgetChars) continue;
    expanded.add(d);
    size += delta;
    queue.push(...children);
  }
  text = render(root, expanded);
  return text;
}
