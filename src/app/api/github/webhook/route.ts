import { after } from "next/server";
import { analyseEvents } from "@/lib/analyse";
import { storeEvents } from "@/lib/events";
import { verifyWebhook } from "@/lib/github/app";
import { drizzleInstallationStore, handleWebhook } from "@/lib/github/webhook";
import { tickForEvents } from "@/lib/tick";

// Analysis and the follow-up tick run after the response (see `after`), within this limit.
export const maxDuration = 300;

export async function POST(req: Request) {
  return handleWebhook(req, {
    verify: verifyWebhook,
    storeEvents: (deliveryId, evs) => storeEvents(deliveryId, evs),
    installations: drizzleInstallationStore(),
    analyse: async (ids) => {
      await analyseEvents(ids);
      const summary = await tickForEvents(ids);
      if (summary?.errors.length) console.error("Event tick errors", summary.errors);
    },
    schedule: (fn) =>
      after(() =>
        fn().catch((e) => {
          console.error("Event analysis failed", e);
        }),
      ),
  });
}
