// Replays real commits as a signed push webhook, to test webhook -> event -> change card without pushing again.
// Usage: yarn tsx scripts/replay-push.mts <owner/repo> <sha> [sha...]   (reads .env.local; BASE_URL overrides the target)
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { importPKCS8, SignJWT } from "jose";
import { createPrivateKey } from "node:crypto";

process.loadEnvFile(".env.local");

const base = process.env.BASE_URL ?? "https://getshiplog.vercel.app";
const [repo, ...shas] = process.argv.slice(2);
if (!repo || shas.length === 0) throw new Error("usage: replay-push.mts <owner/repo> <sha> [sha...]");

async function appJwt() {
  const pem = process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH!, "utf8");
  const pkcs8 = createPrivateKey(pem).export({ type: "pkcs8", format: "pem" }).toString();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuer(process.env.GITHUB_APP_ID!).setIssuedAt(now - 60).setExpirationTime(now + 540).sign(await importPKCS8(pkcs8, "RS256"));
}

async function gh(path: string, auth?: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { accept: "application/vnd.github+json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const installation = await gh(`/repos/${repo}/installation`, await appJwt());
const repository = await gh(`/repos/${repo}`);
const commits = [];
for (const sha of shas) {
  const c = await gh(`/repos/${repo}/commits/${sha}`);
  const files = (s: string) => (c.files as { status: string; filename: string }[]).filter((f) => f.status === s).map((f) => f.filename);
  commits.push({
    id: c.sha,
    message: c.commit.message,
    timestamp: c.commit.committer.date,
    url: c.html_url,
    author: { name: c.commit.author.name, username: c.author?.login },
    added: files("added"),
    modified: [...files("modified"), ...files("renamed")],
    removed: files("removed"),
  });
}

const body = JSON.stringify({
  ref: `refs/heads/${repository.default_branch}`,
  forced: false,
  deleted: false,
  commits,
  repository: { full_name: repository.full_name, default_branch: repository.default_branch },
  installation: { id: installation.id },
});
const signature = "sha256=" + createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET!).update(body).digest("hex");
const res = await fetch(`${base}/api/github/webhook`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-github-event": "push", "x-github-delivery": `replay-${Date.now()}`, "x-hub-signature-256": signature },
  body,
});
console.log(`installation ${installation.id}, ${commits.length} commit(s) -> ${res.status} ${await res.text()}`);
