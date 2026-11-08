// Prints the production pipeline status (projects, events, change cards, drafts, recent AI calls).
// Usage: yarn tsx scripts/status.mts [baseUrl]   (reads CRON_SECRET from .env.local)
process.loadEnvFile(".env.local");

const base = process.argv[2] ?? "https://getshiplog.vercel.app";
const res = await fetch(`${base}/api/cron/status`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
console.log(res.status, JSON.stringify(await res.json(), null, 2));
