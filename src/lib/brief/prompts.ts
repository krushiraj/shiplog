import { z } from "zod";
import { scrub } from "../scrub";

export const ModuleSummarySchema = z.object({
  modules: z.array(z.object({ module: z.string(), summary: z.string().max(400) })),
});

export function moduleSummariesPrompt(modules: { module: string; files: { path: string; summary: string }[] }[]) {
  const system = `You summarise the modules of a large codebase for a project overview.
For each module write 1-2 plain sentences (≤400 chars) on what it is responsible for, based on its file summaries. Purpose, not implementation. Never quote code or secrets.
Return JSON: {"modules": [{"module": string, "summary": string}]} with one entry per module, same names as given.`;
  const user = modules
    .map((m) => `<module>\nname: ${m.module}\n${m.files.map((f) => `${f.path}: ${f.summary}`).join("\n")}\n</module>`)
    .join("\n\n");
  return { system: scrub(system), user: scrub(user) };
}
