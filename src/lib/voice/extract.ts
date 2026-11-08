import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb, type Db } from "@/db";
import { voiceProfiles } from "@/db/schema";
import { callJson as defaultCallJson } from "@/lib/ai/claude";
import { voiceExtractPrompt } from "@/lib/ai/prompts";
import { VoiceDnaSchema, type VoiceDna } from "@/lib/ai/schemas";
import { INTERVIEW_QUESTIONS, splitPastedPosts } from "./bootstrap";

export const REGISTERS = ["linkedin", "x-short"] as const;
export type Register = (typeof REGISTERS)[number];
export type VoiceProfiles = Record<Register, VoiceDna>;

export { INTERVIEW_QUESTIONS, splitPastedPosts };
const PASTED_POST_QUESTION = INTERVIEW_QUESTIONS[5];

const NEVER = ["delve", "game-changer", "excited to announce", "revolutionize", "leverage", "unlock"];

const preset = (linkedin: VoiceDna, short: Partial<VoiceDna>): VoiceProfiles => ({
  linkedin,
  "x-short": { ...linkedin, ...short, sentence: { ...linkedin.sentence, avg_len: Math.min(linkedin.sentence.avg_len, 10) } },
});

export const PRESETS = {
  plain: preset(
    {
      tone: "Plain and direct. Says what shipped and why it matters, with no hype.",
      openers: ["Shipped:", "New this week:", "Small one today:"],
      closers: ["More soon.", "Feedback welcome."],
      sentence: { avg_len: 12, fragments: false },
      vocab: { signature: ["shipped", "fixed", "now you can"], never: NEVER },
      format: { emoji: "none", line_breaks: "one idea per short paragraph", hashtags: "at most one, at the end" },
      examples: [],
    },
    { closers: [], format: { emoji: "none", line_breaks: "single paragraph", hashtags: "none" } },
  ),
  storyteller: preset(
    {
      tone: "Warm and personal. Starts from a moment or a problem, then shows what changed.",
      openers: ["Last week I hit a wall:", "A user asked me something that stuck:", "I almost didn't build this."],
      closers: ["What would you have done?", "That's the build log for today."],
      sentence: { avg_len: 14, fragments: true },
      vocab: { signature: ["turns out", "the fix", "here's what happened"], never: NEVER },
      format: { emoji: "sparingly, one at most", line_breaks: "short paragraphs with a pause line before the point", hashtags: "one at the end" },
      examples: [],
    },
    { openers: ["Turns out", "Tiny win:"], format: { emoji: "rarely", line_breaks: "two short lines", hashtags: "none" } },
  ),
  technical: preset(
    {
      tone: "Precise and technical. Names the mechanism, the trade-off and the numbers.",
      openers: ["How we", "Changed X to Y:", "Benchmark:"],
      closers: ["Code is in the repo.", "Happy to go deeper on the trade-offs."],
      sentence: { avg_len: 15, fragments: false },
      vocab: { signature: ["trade-off", "p95", "under the hood", "instead of"], never: NEVER },
      format: { emoji: "none", line_breaks: "short paragraphs, lists for steps", hashtags: "none or one technical tag" },
      examples: [],
    },
    { closers: [], format: { emoji: "none", line_breaks: "single paragraph", hashtags: "none" } },
  ),
} satisfies Record<string, VoiceProfiles>;
export type PresetName = keyof typeof PRESETS;

export const VoiceInputSchema = z.object({
  samples: z.array(z.string().max(5000)).max(20, "pick at most 20 posts").default([]),
  interview: z.array(z.object({ q: z.string().max(200), a: z.string().max(5000) })).max(INTERVIEW_QUESTIONS.length).optional(),
  preset: z.enum(Object.keys(PRESETS) as [PresetName, ...PresetName[]]).optional(),
  /** Only extract and save these registers (default: all). */
  registers: z.array(z.enum(REGISTERS)).min(1).optional(),
});
export type VoiceInput = z.input<typeof VoiceInputSchema>;

export class VoiceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceInputError";
  }
}

export type VoiceStore = { saveProfile(userId: string, register: Register, dna: VoiceDna): Promise<void> };

export type VoiceDeps = { callJson: typeof defaultCallJson; store: VoiceStore };

export function drizzleVoiceStore(database: Db = defaultDb): VoiceStore {
  return {
    async saveProfile(userId, register, dna) {
      const userLevel = and(eq(voiceProfiles.userId, userId), isNull(voiceProfiles.projectId), eq(voiceProfiles.register, register));
      await database.batch([
        database.delete(voiceProfiles).where(userLevel),
        database.insert(voiceProfiles).values({ userId, projectId: null, register, dna }),
      ]);
    },
  };
}

const defaultDeps = (): VoiceDeps => ({ callJson: defaultCallJson, store: drizzleVoiceStore() });

export async function extractVoice(userId: string, raw: VoiceInput, deps: VoiceDeps = defaultDeps()): Promise<Partial<VoiceProfiles>> {
  const parsed = VoiceInputSchema.safeParse(raw);
  if (!parsed.success) throw new VoiceInputError(parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;
  const registers = REGISTERS.filter((r) => !input.registers || input.registers.includes(r));

  let profiles: Partial<VoiceProfiles>;
  if (input.preset) {
    const preset = PRESETS[input.preset];
    profiles = Object.fromEntries(registers.map((r) => [r, preset[r]]));
  } else {
    const interview = (input.interview ?? []).map((x) => ({ q: x.q.trim(), a: x.a.trim() })).filter((x) => x.a);
    const pastedPost = interview.find((x) => x.q === PASTED_POST_QUESTION)?.a;
    const samples = [...input.samples.map((s) => s.trim()).filter(Boolean), ...(pastedPost ? [pastedPost] : [])];
    if (samples.length === 0 && interview.length === 0) throw new VoiceInputError("Add at least one post or answer a question");

    const entries = await Promise.all(
      registers.map(async (register) => {
        const prompt = voiceExtractPrompt({ samples, register, interview });
        const { data } = await deps.callJson(VoiceDnaSchema, { ...prompt, maxTokens: 2000 });
        return [register, data] as const;
      }),
    );
    profiles = Object.fromEntries(entries);
  }

  for (const register of registers) await deps.store.saveProfile(userId, register, profiles[register]!);
  return profiles;
}
