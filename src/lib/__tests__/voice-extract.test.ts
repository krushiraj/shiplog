import { describe, it, expect, vi } from "vitest";
import {
  extractVoice,
  splitPastedPosts,
  PRESETS,
  INTERVIEW_QUESTIONS,
  VoiceInputError,
  type VoiceDeps,
  type VoiceInput,
} from "@/lib/voice/extract";
import { VoiceDnaSchema, type VoiceDna } from "@/lib/ai/schemas";

const dna = (tone: string): VoiceDna => ({
  tone,
  openers: ["Shipped:"],
  closers: [],
  sentence: { avg_len: 10, fragments: true },
  vocab: { signature: ["ship"], never: ["delve"] },
  format: { emoji: "none", line_breaks: "short paragraphs", hashtags: "one at the end" },
  examples: [],
});

function fakeDeps() {
  const saved: { userId: string; register: string; dna: VoiceDna }[] = [];
  const callJson = vi.fn(async (_schema: unknown, args: { user: string }) => ({
    data: dna(args.user.includes("x-short") ? "short" : "long"),
    usage: {},
  }));
  const deps: VoiceDeps = {
    callJson: callJson as unknown as VoiceDeps["callJson"],
    store: { saveProfile: async (userId, register, d) => void saved.push({ userId, register, dna: d }) },
  };
  return { deps, saved, callJson };
}

describe("splitPastedPosts", () => {
  it("splits on --- lines when present, keeping blank lines inside posts", () => {
    expect(splitPastedPosts("First post\n\nstill first\n---\nSecond post\n ---- \n\nThird")).toEqual([
      "First post\n\nstill first",
      "Second post",
      "Third",
    ]);
  });

  it("splits on blank lines otherwise", () => {
    expect(splitPastedPosts("one\nline two\n\n\ntwo\n  \nthree  ")).toEqual(["one\nline two", "two", "three"]);
  });

  it("returns nothing for empty text", () => {
    expect(splitPastedPosts("  \n\n ")).toEqual([]);
  });
});

describe("extractVoice", () => {
  it("extracts one DNA per register from samples and saves them user-level", async () => {
    const { deps, saved, callJson } = fakeDeps();
    const result = await extractVoice("u1", { samples: ["post one", "post two"] }, deps);
    expect(callJson).toHaveBeenCalledTimes(2);
    expect(callJson.mock.calls[0][0]).toBe(VoiceDnaSchema);
    expect(result).toEqual({ linkedin: dna("long"), "x-short": dna("short") });
    expect(saved.map((s) => [s.userId, s.register])).toEqual([
      ["u1", "linkedin"],
      ["u1", "x-short"],
    ]);
  });

  it("passes interview answers and treats the pasted post answer as a sample", async () => {
    const { deps, callJson } = fakeDeps();
    const interview = INTERVIEW_QUESTIONS.map((q, i) => ({ q, a: i === 5 ? "My favourite post" : `answer ${i}` }));
    await extractVoice("u1", { samples: [], interview }, deps);
    const user = (callJson.mock.calls[0][1] as { user: string }).user;
    expect(user).toContain("answer 0");
    expect(user).toContain("My favourite post");
  });

  it("writes the preset DNA without calling the model", async () => {
    const { deps, saved, callJson } = fakeDeps();
    const result = await extractVoice("u1", { preset: "technical" }, deps);
    expect(callJson).not.toHaveBeenCalled();
    expect(result.linkedin).toEqual(PRESETS.technical.linkedin);
    expect(saved).toHaveLength(2);
  });

  it("ships presets that satisfy the DNA schema", () => {
    for (const preset of Object.values(PRESETS)) {
      for (const d of Object.values(preset)) expect(VoiceDnaSchema.safeParse(d).success).toBe(true);
    }
  });

  it("rejects input with no samples, answers or preset", async () => {
    const { deps, callJson } = fakeDeps();
    await expect(extractVoice("u1", { samples: ["  "] }, deps)).rejects.toBeInstanceOf(VoiceInputError);
    await expect(extractVoice("u1", { interview: [{ q: "x", a: " " }] }, deps)).rejects.toBeInstanceOf(VoiceInputError);
    await expect(extractVoice("u1", { preset: "pirate" } as unknown as VoiceInput, deps)).rejects.toBeInstanceOf(VoiceInputError);
    expect(callJson).not.toHaveBeenCalled();
  });

  it("caps samples at 20", async () => {
    const { deps } = fakeDeps();
    const samples = Array.from({ length: 21 }, (_, i) => `post ${i}`);
    await expect(extractVoice("u1", { samples }, deps)).rejects.toBeInstanceOf(VoiceInputError);
  });
});
