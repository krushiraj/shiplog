import { z } from "zod";

export const ChangeCardSchema = z.object({
  what: z.string().max(280),
  why: z.string().max(400).nullable(),
  why_inferred: z.boolean(),
  how: z.string().max(400).nullable(),
  impact: z.string().max(300).nullable(),
  significance: z.number().int().min(0).max(3),
  open_question: z.string().max(160).nullable(),
});
export type ChangeCard = z.infer<typeof ChangeCardSchema>;

export const BriefSchema = z.object({
  pitch: z.string(),
  audience: z.string(),
  problem: z.string(),
  architecture: z.array(z.object({ module: z.string(), purpose: z.string() })),
  glossary: z.array(z.object({ term: z.string(), plain: z.string() })),
  stack: z.array(z.string()),
  milestones: z.array(z.string()),
  facts: z.array(z.string()),
});
export type Brief = z.infer<typeof BriefSchema>;

export const FileSummarySchema = z.object({
  summaries: z.array(z.object({ path: z.string(), summary: z.string().max(200) })),
});
export type FileSummaries = z.infer<typeof FileSummarySchema>;

export const ComposeSchema = z.object({
  variants: z.record(z.string(), z.string()),
  themes: z.array(z.string()),
});
export type ComposeOutput = z.infer<typeof ComposeSchema>;

export const VoiceCheckSchema = z.object({
  scores: z.record(z.string(), z.number().min(0).max(1)),
  suggestions: z.record(z.string(), z.array(z.string()).max(3)),
});
export type VoiceCheck = z.infer<typeof VoiceCheckSchema>;

export const VoiceDnaSchema = z.object({
  tone: z.string(),
  openers: z.array(z.string()),
  closers: z.array(z.string()),
  sentence: z.object({ avg_len: z.number().min(0), fragments: z.boolean() }),
  vocab: z.object({ signature: z.array(z.string()), never: z.array(z.string()) }),
  format: z.object({ emoji: z.string(), line_breaks: z.string(), hashtags: z.string() }),
  examples: z.array(z.string()).max(3),
});
export type VoiceDna = z.infer<typeof VoiceDnaSchema>;

export const RuleProposalSchema = z.object({
  kind: z.enum(["never", "prefer", "format"]),
  rule: z.string().max(160),
  pattern: z.string().nullable(),
});
export const RuleProposalsSchema = z.object({ proposals: z.array(RuleProposalSchema).max(2) });
export type RuleProposals = z.infer<typeof RuleProposalsSchema>;
