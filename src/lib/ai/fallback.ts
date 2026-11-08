export type FallbackCard = { what: string; significance: number };

export function fallbackDraft(cards: FallbackCard[], _channel: string, limit: number, projectName: string): string {
  const head = `Today in ${projectName}:`;
  if (cards.length === 0) return clip(`${head} small fixes and upkeep.`, limit);

  const bullets = [...cards]
    .sort((a, b) => b.significance - a.significance || a.what.localeCompare(b.what))
    .map((c) => `• ${c.what.trim()}`);

  let text = head;
  for (const b of bullets) {
    const next = `${text}\n${b}`;
    if (next.length > limit) break;
    text = next;
  }
  if (text === head) text = `${head}\n${bullets[0]}`;
  return clip(text, limit);
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
}
