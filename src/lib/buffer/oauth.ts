export const AUTHORIZE_URL = "https://auth.buffer.com/auth";
export const TOKEN_URL = "https://auth.buffer.com/token";

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

export function buildAuthorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  scopes: string | string[];
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: Array.isArray(p.scopes) ? p.scopes.join(" ") : p.scopes,
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    prompt: "consent",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

type ClientAuth = { clientId: string; clientSecret?: string };

export type TokenGrant =
  | (ClientAuth & { grantType: "authorization_code"; code: string; redirectUri: string; codeVerifier: string })
  | (ClientAuth & { grantType: "refresh_token"; refreshToken: string });

// Buffer uses client_secret_post: the secret goes in the form body, never HTTP Basic.
export function tokenRequestBody(g: TokenGrant): URLSearchParams {
  const body = new URLSearchParams({ client_id: g.clientId });
  if (g.clientSecret) body.set("client_secret", g.clientSecret);
  body.set("grant_type", g.grantType);
  if (g.grantType === "authorization_code") {
    body.set("code", g.code);
    body.set("redirect_uri", g.redirectUri);
    body.set("code_verifier", g.codeVerifier);
  } else {
    body.set("refresh_token", g.refreshToken);
  }
  return body;
}

export class OAuthError extends Error {
  constructor(public code: string, description?: string) {
    super(description ? `${code}: ${description}` : code);
    this.name = "OAuthError";
  }
}

export async function requestToken(grant: TokenGrant, fetchFn: typeof fetch = fetch): Promise<TokenResponse> {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: tokenRequestBody(grant),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new OAuthError(json.error ?? `http_${res.status}`, json.error_description);
  return json as TokenResponse;
}
