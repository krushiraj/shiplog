import { analyseEvents } from "@/lib/analyse";
import { cleanupOldDemos } from "@/lib/demo";
import { pendingEvents } from "@/lib/events";
import { runTick } from "@/lib/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runTick({
    analyse: async (limit) => analyseEvents((await pendingEvents(limit)).map((e) => e.id)),
  });
  const demosCleaned = await cleanupOldDemos().catch(() => 0);
  return Response.json({ ...summary, demosCleaned });
}
