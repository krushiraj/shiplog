import { asc, isNull } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db";
import { events } from "@/db/schema";
import type { NormalisedEvent } from "./github/normalise";

// Duplicate deliveries and re-pushed SHAs hit the (repo, kind, ref) unique index and are dropped.
export async function storeEvents(deliveryId: string, evs: NormalisedEvent[], database: Db = defaultDb): Promise<string[]> {
  if (evs.length === 0) return [];
  const rows = await database
    .insert(events)
    .values(evs.map((e) => ({ deliveryId, ...e })))
    .onConflictDoNothing({ target: [events.repoFullName, events.kind, events.ref] })
    .returning({ id: events.id });
  return rows.map((r) => r.id);
}

export async function pendingEvents(limit: number, database: Db = defaultDb) {
  return database.select().from(events).where(isNull(events.processedAt)).orderBy(asc(events.occurredAt)).limit(limit);
}
