// Client-safe pieces of voice bootstrap (no db or AI imports).

export const INTERVIEW_QUESTIONS = [
  "Who do you build for?",
  "What are you building, and why?",
  "How would you explain it to a friend?",
  "Which words or phrases would you never use?",
  "How do you feel about emoji and hashtags?",
  "Paste one post you liked writing.",
] as const;

/** Splits on `---` separator lines when present, otherwise on blank lines. */
export function splitPastedPosts(text: string): string[] {
  const separator = /^\s*-{3,}\s*$/m;
  const parts = separator.test(text) ? text.split(separator) : text.split(/\n\s*\n/);
  return parts.map((p) => p.trim()).filter(Boolean);
}
