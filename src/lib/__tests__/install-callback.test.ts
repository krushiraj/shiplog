import { describe, it, expect, vi } from "vitest";
import { handleInstallCallback, handleInstalled, type InstallFlowDeps } from "@/lib/github/install-callback";
import { InstallationNotOwnedError } from "@/lib/github/user-oauth";

function deps(over: Partial<InstallFlowDeps> = {}): InstallFlowDeps {
  return {
    sessionUserId: async () => "user-1",
    sign: async (p) => `signed:${p.installationId}`,
    verify: async (t) => (t.startsWith("signed:") ? { installationId: Number(t.slice(7)) } : null),
    authorizeUrl: (state) => `https://github.com/login/oauth/authorize?state=${state}`,
    exchangeCode: vi.fn(async () => "ghu_token"),
    verifyInstallation: vi.fn(async () => ({ userId: 42, login: "octo" })),
    getInstallation: vi.fn(async () => ({ accountLogin: "octo-org", suspended: false })),
    link: vi.fn(async () => true),
    now: () => new Date("2026-11-08T00:00:00Z"),
    ...over,
  };
}

const params = (p: Record<string, string>) => new URLSearchParams(p);

describe("handleInstallCallback", () => {
  it("stashes the installation and sends a signed-out user to Buffer sign-in", async () => {
    const d = deps({ sessionUserId: async () => null });
    const res = await handleInstallCallback(params({ code: "c", installation_id: "5", setup_action: "install" }), d);
    expect(res).toEqual({ redirect: "/api/auth/buffer/start", installCookie: "signed:5" });
    expect(d.exchangeCode).not.toHaveBeenCalled();
  });

  it("links a verified installation and opens project setup", async () => {
    const d = deps();
    const res = await handleInstallCallback(params({ code: "c", installation_id: "5", setup_action: "install" }), d);
    expect(res).toEqual({ redirect: "/onboarding/project?installation=5", installCookie: null });
    expect(d.exchangeCode).toHaveBeenCalledWith("c");
    expect(d.verifyInstallation).toHaveBeenCalledWith("ghu_token", 5);
    expect(d.link).toHaveBeenCalledWith({
      installationId: 5,
      userId: "user-1",
      accountLogin: "octo-org",
      suspended: false,
      githubUserId: 42,
      githubLogin: "octo",
      verifiedAt: new Date("2026-11-08T00:00:00Z"),
    });
  });

  it("takes the installation id from a valid state on the re-auth leg", async () => {
    const d = deps();
    const res = await handleInstallCallback(params({ code: "c", state: "signed:8" }), d);
    expect(res.redirect).toBe("/onboarding/project?installation=8");
    expect(d.verifyInstallation).toHaveBeenCalledWith("ghu_token", 8);
  });

  it("rejects a forged state", async () => {
    const d = deps();
    const res = await handleInstallCallback(params({ code: "c", state: "forged" }), d);
    expect(res.redirect).toBe("/onboarding?github=error");
    expect(d.exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects a state that disagrees with installation_id", async () => {
    const res = await handleInstallCallback(params({ code: "c", state: "signed:8", installation_id: "9" }), deps());
    expect(res.redirect).toBe("/onboarding?github=error");
  });

  it("refuses an installation the GitHub user cannot access", async () => {
    const d = deps({ verifyInstallation: vi.fn(async () => Promise.reject(new InstallationNotOwnedError(5))) });
    const res = await handleInstallCallback(params({ code: "c", installation_id: "5" }), d);
    expect(res.redirect).toBe("/onboarding?github=unverified");
    expect(d.link).not.toHaveBeenCalled();
  });

  it("refuses an installation linked to another Shiplog user", async () => {
    const res = await handleInstallCallback(params({ code: "c", installation_id: "5" }), deps({ link: vi.fn(async () => false) }));
    expect(res.redirect).toBe("/onboarding?github=taken");
  });

  it("reports pending org approval", async () => {
    const res = await handleInstallCallback(params({ setup_action: "request", installation_id: "5" }), deps());
    expect(res.redirect).toBe("/onboarding?github=requested");
  });

  it("asks GitHub for a code when none was sent", async () => {
    const res = await handleInstallCallback(params({ installation_id: "5", setup_action: "update" }), deps());
    expect(res.redirect).toBe("https://github.com/login/oauth/authorize?state=signed:5");
  });

  it("reports a missing installation id", async () => {
    const res = await handleInstallCallback(params({ code: "c" }), deps());
    expect(res.redirect).toBe("/onboarding?github=missing");
  });

  it("maps a failed code exchange to an error", async () => {
    const d = deps({ exchangeCode: vi.fn(async () => Promise.reject(new Error("bad_verification_code"))) });
    const res = await handleInstallCallback(params({ code: "c", installation_id: "5" }), d);
    expect(res.redirect).toBe("/onboarding?github=error");
  });
});

describe("handleInstalled", () => {
  it("sends a signed-out user to Buffer sign-in with the installation stashed", async () => {
    const res = await handleInstalled(params({ installation_id: "5" }), null, deps({ sessionUserId: async () => null }));
    expect(res).toEqual({ redirect: "/api/auth/buffer/start", installCookie: "signed:5" });
  });

  it("never links directly; it sends a signed-in user through GitHub authorization", async () => {
    const d = deps();
    const res = await handleInstalled(params({}), "signed:5", d);
    expect(res).toEqual({ redirect: "https://github.com/login/oauth/authorize?state=signed:5", installCookie: null });
    expect(d.link).not.toHaveBeenCalled();
  });

  it("reports a missing installation id", async () => {
    const res = await handleInstalled(params({}), "garbage", deps());
    expect(res.redirect).toBe("/onboarding?github=missing");
  });
});
