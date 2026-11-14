import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { changeCards, projects } from "@/db/schema";

/** Records the user's answer on a card and adds it to the project brief as a fact. */
export async function answerCard(projectId: string, cardId: string, answer: string) {
  const [card] = await db
    .update(changeCards)
    .set({ answer, whyInferred: false })
    .where(eq(changeCards.id, cardId))
    .returning({ what: changeCards.what });
  const fact = `${card.what}: ${answer}`;
  await db
    .update(projects)
    .set({
      brief: sql`jsonb_set(coalesce(${projects.brief}, '{}'::jsonb), '{facts}', coalesce(${projects.brief}->'facts', '[]'::jsonb) || to_jsonb(${fact}::text))`,
    })
    .where(eq(projects.id, projectId));
}
