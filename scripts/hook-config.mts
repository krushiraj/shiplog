// Prints the GitHub App's webhook config (url, content type, TLS check; GitHub masks the secret).
// Usage: yarn tsx scripts/hook-config.mts   (reads .env.local)
import { readFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";

process.loadEnvFile(".env.local");

const pem = process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH!, "utf8");
const pkcs8 = createPrivateKey(pem).export({ type: "pkcs8", format: "pem" }).toString();
const now = Math.floor(Date.now() / 1000);
const jwt = await new SignJWT({})
  .setProtectedHeader({ alg: "RS256" })
  .setIssuer(process.env.GITHUB_APP_ID!)
  .setIssuedAt(now - 60)
  .setExpirationTime(now + 540)
  .sign(await importPKCS8(pkcs8, "RS256"));
const res = await fetch("https://api.github.com/app/hook/config", {
  headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json" },
});
console.log(res.status, await res.text());
