import { analyseEvents } from "@/lib/analyse";
import { pendingEvents } from "@/lib/events";
import { runTick } from "@/lib/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runTick({
    analyse: async (limit) => analyseEvents((await pendingEvents(limit)).map((e) => e.id)),
  });
  return Response.json(summary);
}
