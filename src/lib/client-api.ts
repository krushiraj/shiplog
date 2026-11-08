/** Small fetch wrapper for the app's JSON routes; throws with the server's error message. */
export async function sendJson<T = Record<string, unknown>>(url: string, method: "PATCH" | "PUT" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export type LearnedRuleDto = { ruleId: string; kind: string; rule: string; register: string | null; sightings: number; active: boolean };

export const draftAction = <T = Record<string, unknown>>(draftId: string, body: Record<string, unknown>) =>
  sendJson<T>(`/api/drafts/${draftId}`, "PATCH", body);

export const ruleAction = (ruleId: string, body: { active: boolean } | { undo: true }) => sendJson(`/api/rules/${ruleId}`, "PATCH", body);
