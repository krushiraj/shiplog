import { InstallationNotOwnedError } from "./user-oauth";

export type InstallState = { installationId: number };

export type VerifiedInstallation = {
  installationId: number;
  userId: string;
  accountLogin: string;
  suspended: boolean;
  githubUserId: number;
  githubLogin: string;
  verifiedAt: Date;
};

export type InstallFlowDeps = {
  sessionUserId(): Promise<string | null>;
  sign(payload: InstallState): Promise<string>;
  verify(token: string): Promise<InstallState | null>;
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<string>;
  verifyInstallation(token: string, installationId: number): Promise<{ userId: number; login: string }>;
  getInstallation(installationId: number): Promise<{ accountLogin: string; suspended: boolean }>;
  /** false when the installation is already verified for a different Shiplog user. */
  link(row: VerifiedInstallation): Promise<boolean>;
  now(): Date;
};

/** installCookie: a value to set, null to clear it, undefined to leave it. */
export type InstallFlowResult = { redirect: string; installCookie?: string | null };

const SIGN_IN = "/api/auth/buffer/start";
const notice = (github: string): InstallFlowResult => ({ redirect: `/onboarding?github=${github}`, installCookie: null });

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** GitHub callback: after install (with "Request user authorization during installation") or after the OAuth web flow. */
export async function handleInstallCallback(params: URLSearchParams, deps: InstallFlowDeps): Promise<InstallFlowResult> {
  if (params.get("setup_action") === "request") return notice("requested");
  if (params.get("error")) return notice("error");

  const fromQuery = params.get("installation_id") ? parseId(params.get("installation_id")) : null;
  const rawState = params.get("state");
  let installationId = fromQuery;
  if (rawState) {
    const state = await deps.verify(rawState);
    const fromState = parseId(state?.installationId);
    if (!fromState || (fromQuery && fromQuery !== fromState)) return notice("error");
    installationId = fromState;
  }
  if (!installationId) return notice("missing");

  const userId = await deps.sessionUserId();
  // The code expires in minutes, so after sign-in /api/github/installed asks GitHub for a fresh one.
  if (!userId) return { redirect: SIGN_IN, installCookie: await deps.sign({ installationId }) };

  const code = params.get("code");
  if (!code) return { redirect: deps.authorizeUrl(await deps.sign({ installationId })), installCookie: null };

  try {
    const token = await deps.exchangeCode(code);
    const ghUser = await deps.verifyInstallation(token, installationId);
    const install = await deps.getInstallation(installationId);
    const linked = await deps.link({
      installationId,
      userId,
      ...install,
      githubUserId: ghUser.userId,
      githubLogin: ghUser.login,
      verifiedAt: deps.now(),
    });
    if (!linked) return notice("taken");
  } catch (e) {
    if (e instanceof InstallationNotOwnedError) return notice("unverified");
    console.error("GitHub installation verification failed", e);
    return notice("error");
  }
  return { redirect: `/onboarding/project?installation=${installationId}`, installCookie: null };
}

/** Legacy setup URL and the post-sign-in hop: never links, only routes into GitHub authorization. */
export async function handleInstalled(
  params: URLSearchParams,
  cookie: string | null,
  deps: Pick<InstallFlowDeps, "sessionUserId" | "sign" | "verify" | "authorizeUrl">,
): Promise<InstallFlowResult> {
  if (params.get("setup_action") === "request") return notice("requested");

  const saved = cookie ? await deps.verify(cookie) : null;
  const installationId = parseId(params.get("installation_id") ?? saved?.installationId);
  if (!installationId) return notice("missing");

  const state = await deps.sign({ installationId });
  if (!(await deps.sessionUserId())) return { redirect: SIGN_IN, installCookie: state };
  return { redirect: deps.authorizeUrl(state), installCookie: null };
}
