// Lists recent GitHub App webhook deliveries (event, status, response code) to check the webhook end to end.
// Usage: yarn tsx scripts/deliveries.mts [limit] [deliveryId]   (reads .env.local; a deliveryId prints that delivery's response)
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

async function gh(path: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${await appJwt()}`, accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const [limit = "30", id] = process.argv.slice(2);
  if (id) {
    const d = await gh(`/app/hook/deliveries/${id}`);
    console.log(d.event, d.action ?? "", d.status_code, d.status);
    console.log("response:", d.response?.payload);
    return;
  }
  const data = await gh(`/app/hook/deliveries?per_page=${limit}`);
  for (const d of data) {
    console.log([d.delivered_at, d.event + (d.action ? `.${d.action}` : ""), d.status_code, d.status, d.redelivery ? "redelivery" : "", d.id].join("  "));
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
