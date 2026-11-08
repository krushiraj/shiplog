import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema>;

let instance: Db | undefined;

export function getDb(): Db {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Add it to .env.local (Neon connection string).");
    instance = drizzle(neon(url), { schema });
  }
  return instance;
}

// Lazy proxy so importing `db` never touches the env var until a query runs (keeps `next build` working).
export const db = new Proxy({} as Db, {
  get: (_t, prop) => Reflect.get(getDb(), prop),
});

export { schema };
