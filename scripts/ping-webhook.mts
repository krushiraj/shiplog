// Sends a ping to the webhook, unsigned and then signed with the local secret, to tell a secret mismatch from a blocked route.
// Usage: yarn tsx scripts/ping-webhook.mts [baseUrl]   (reads .env.local)
import { createHmac } from "node:crypto";

process.loadEnvFile(".env.local");

const base = process.argv[2] ?? "https://getshiplog.vercel.app";
const body = JSON.stringify({ zen: "Shiplog ping", hook_id: 0 });
const sig = "sha256=" + createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET!).update(body).digest("hex");

for (const [label, signature] of [["unsigned", null], ["signed with local secret", sig]] as const) {
  const res = await fetch(`${base}/api/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "ping",
      "x-github-delivery": `local-ping-${Date.now()}`,
      ...(signature ? { "x-hub-signature-256": signature } : {}),
    },
    body,
  });
  console.log(`${label}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
