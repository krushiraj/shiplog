// Runs the production scheduler tick once and prints its summary (claimed projects, drafts made, errors, AI spend today).
// Usage: yarn tsx scripts/tick.mts [baseUrl]   (reads CRON_SECRET from .env.local)
process.loadEnvFile(".env.local");

const base = process.argv[2] ?? "https://getshiplog.vercel.app";
const res = await fetch(`${base}/api/cron/tick`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
console.log(res.status, JSON.stringify(await res.json(), null, 2));
