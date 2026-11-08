import { after } from "next/server";
import { analyseEvents } from "@/lib/analyse";
import { storeEvents } from "@/lib/events";
import { verifyWebhook } from "@/lib/github/app";
import { drizzleInstallationStore, handleWebhook } from "@/lib/github/webhook";

export async function POST(req: Request) {
  return handleWebhook(req, {
    verify: verifyWebhook,
    storeEvents: (deliveryId, evs) => storeEvents(deliveryId, evs),
    installations: drizzleInstallationStore(),
    analyse: (ids) => analyseEvents(ids),
    schedule: (fn) =>
      after(() =>
        fn().catch((e) => {
          console.error("Event analysis failed", e);
        }),
      ),
  });
}
