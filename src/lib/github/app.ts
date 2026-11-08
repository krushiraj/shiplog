import { readFileSync } from "node:fs";
import { App, type Octokit } from "octokit";
import { Webhooks } from "@octokit/webhooks";

export type GitHub = Octokit;

// Holds the installation id across a Buffer sign-in started from the GitHub install callback.
export const GITHUB_INSTALL_COOKIE = "shiplog_gh_install";

let app: App | undefined;
let webhooks: Webhooks | undefined;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function privateKey(): string {
  const inline = process.env.GITHUB_PRIVATE_KEY;
  if (inline) return inline.replace(/\\n/g, "\n");
  const path = process.env.GITHUB_PRIVATE_KEY_PATH;
  if (path) return readFileSync(path, "utf8");
  throw new Error("GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH is not set");
}

export function getApp(): App {
  return (app ??= new App({
    appId: env("GITHUB_APP_ID"),
    privateKey: privateKey(),
    webhooks: { secret: env("GITHUB_WEBHOOK_SECRET") },
  }));
}

export function installationOctokit(installationId: number): Promise<GitHub> {
  return getApp().getInstallationOctokit(installationId) as Promise<GitHub>;
}

// Verification only needs the secret, so it never loads the private key.
export async function verifyWebhook(body: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  webhooks ??= new Webhooks({ secret: env("GITHUB_WEBHOOK_SECRET") });
  try {
    return await webhooks.verify(body, signature);
  } catch {
    return false;
  }
}
