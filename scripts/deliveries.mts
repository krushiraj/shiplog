// Lists recent GitHub App webhook deliveries (event, status, response code) to check the webhook end to end.
// Usage: yarn tsx scripts/deliveries.mts [limit]            list deliveries
//        yarn tsx scripts/deliveries.mts redeliver <id>     ask GitHub to send a delivery again
// (reads .env.local)
import { readFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";

process.loadEnvFile(".env.local");

async function appJwt() {
  const pem = process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH!, "utf8");
  // GitHub issues PKCS#1 keys; jose wants PKCS#8.
  const pkcs8 = createPrivateKey(pem).export({ type: "pkcs8", format: "pem" }).toString();
  const key = await importPKCS8(pkcs8, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuer(process.env.GITHUB_APP_ID!).setIssuedAt(now - 60).setExpirationTime(now + 540).sign(key);
}

async function gh(path: string, method = "GET") {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { authorization: `Bearer ${await appJwt()}`, accept: "application/vnd.github+json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  // Delivery ids exceed 2^53; keep them as strings.
  return text ? JSON.parse(text.replace(/"id":(\d{16,})/g, '"id":"$1"')) : null;
}

async function main() {
  const [first = "30", id] = process.argv.slice(2);
  if (first === "redeliver") {
    await gh(`/app/hook/deliveries/${id}/attempts`, "POST");
    console.log(`redelivery of ${id} requested`);
    return;
  }
  const data = await gh(`/app/hook/deliveries?per_page=${first}`);
  for (const d of data) {
    console.log([d.delivered_at, d.event + (d.action ? `.${d.action}` : ""), d.status_code, d.status, d.redelivery ? "redelivery" : "", d.id].join("  "));
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
