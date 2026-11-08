export const MAX_INPUT_TOKENS = 120_000;

export type Shrink = {
  fileClip: number;
  docs: number;
  docClip: number;
  readmeClip: number;
  manifestClip: number;
  outlineChars: number;
  fileShare: number;
};

/** Tried in order until the estimated input for the whole build fits MAX_INPUT_TOKENS. */
export const shrinkLevels: Shrink[] = [
  { fileClip: 3000, docs: 10, docClip: 4000, readmeClip: 8000, manifestClip: 3000, outlineChars: 6000, fileShare: 1 },
  { fileClip: 2000, docs: 6, docClip: 2500, readmeClip: 6000, manifestClip: 2000, outlineChars: 5000, fileShare: 1 },
  { fileClip: 1200, docs: 3, docClip: 1500, readmeClip: 4000, manifestClip: 1500, outlineChars: 4000, fileShare: 0.75 },
  { fileClip: 800, docs: 1, docClip: 1000, readmeClip: 3000, manifestClip: 1000, outlineChars: 3000, fileShare: 0.5 },
  { fileClip: 500, docs: 0, docClip: 0, readmeClip: 1500, manifestClip: 600, outlineChars: 2000, fileShare: 0.25 },
];

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (truncated)` : s);
