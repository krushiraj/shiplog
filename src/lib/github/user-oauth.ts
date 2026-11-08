// GitHub App user-to-server OAuth, used only to prove an installation belongs to the signed-in user.
// The user token is used for the two calls below and then dropped; it is never stored.

type FetchFn = typeof fetch;

export const USER_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API = "https://api.github.com";
const PER_PAGE = 100;

export class InstallationNotOwnedError extends Error {
  constructor(readonly installationId: number) {
    super(`Installation ${installationId} is not accessible to this GitHub user`);
    this.name = "InstallationNotOwnedError";
  }
}

export function buildUserAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(USER_AUTHORIZE_URL);
  url.search = new URLSearchParams({ client_id: p.clientId, redirect_uri: p.redirectUri, state: p.state }).toString();
  return url.toString();
}

export async function exchangeUserCode(
  code: string,
  opts: { clientId: string; clientSecret: string; fetchFn?: FetchFn },
): Promise<string> {
  const res = await (opts.fetchFn ?? fetch)(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: opts.clientId, client_secret: opts.clientSecret, code }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (body.error || !body.access_token) {
    throw new Error(`GitHub code exchange failed: ${body.error ?? `HTTP ${res.status}`}${body.error_description ? ` (${body.error_description})` : ""}`);
  }
  return body.access_token;
}

async function getJson<T>(path: string, token: string, fetchFn: FetchFn): Promise<T> {
  const res = await fetchFn(`${API}${path}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`GitHub ${path} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function verifyInstallation(
  token: string,
  installationId: number,
  fetchFn: FetchFn = fetch,
): Promise<{ userId: number; login: string }> {
  const user = await getJson<{ id: number; login: string }>("/user", token, fetchFn);
  for (let page = 1; ; page++) {
    const { installations } = await getJson<{ installations: { id: number }[] }>(
      `/user/installations?per_page=${PER_PAGE}&page=${page}`,
      token,
      fetchFn,
    );
    if (installations.some((i) => i.id === installationId)) return { userId: user.id, login: user.login };
    if (installations.length < PER_PAGE) throw new InstallationNotOwnedError(installationId);
  }
}
