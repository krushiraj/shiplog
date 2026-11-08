"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RiArrowRightLine, RiRefreshLine } from "@remixicon/react";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Textarea } from "@/components/base/textarea/textarea";
import { Section } from "@/components/onboarding/Section";
import type { VoiceDna } from "@/lib/ai/schemas";
import { splitPastedPosts } from "@/lib/voice/bootstrap";
import { cx } from "@/utils/cx";

type Mode = "buffer" | "paste" | "interview" | "preset";
type SentPost = { id: string; text: string; sentAt: string | null; service: string };
type Preset = { id: string; label: string; tone: string };

const MIN_PICK = 5;
const MAX_PICK = 10;
const REGISTER_LABEL: Record<string, string> = { linkedin: "Long posts (LinkedIn)", "x-short": "Short posts (X, Threads)" };

export function VoiceBootstrap({ questions, presets }: { questions: string[]; presets: Preset[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("buffer");
  const [sent, setSent] = useState<SentPost[] | null>(null);
  const [sentError, setSentError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pasted, setPasted] = useState("");
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [preset, setPreset] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, VoiceDna> | null>(null);

  const wantSent = mode === "buffer" && !sent && !sentError;
  useEffect(() => {
    if (!wantSent) return;
    let cancelled = false;
    fetch("/api/voice")
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { posts?: SentPost[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? "Could not load your Buffer posts");
        return body.posts ?? [];
      })
      .then(
        (posts) => {
          if (cancelled) return;
          setSent(posts);
          setPicked(posts.slice(0, MIN_PICK).map((p) => p.id));
        },
        (e: Error) => !cancelled && setSentError(e.message),
      );
    return () => {
      cancelled = true;
    };
  }, [wantSent]);

  const pastedPosts = splitPastedPosts(pasted);
  const answered = answers.filter((a) => a.trim()).length;
  const minPick = Math.min(MIN_PICK, sent?.length ?? MIN_PICK);

  const payload = (): Record<string, unknown> | null => {
    if (mode === "buffer") return sent && picked.length >= Math.max(1, minPick) ? { samples: sent.filter((p) => picked.includes(p.id)).map((p) => p.text) } : null;
    if (mode === "paste") return pastedPosts.length ? { samples: pastedPosts.slice(0, 20) } : null;
    if (mode === "interview") return answered >= 3 ? { samples: [], interview: questions.map((q, i) => ({ q, a: answers[i] })) } : null;
    return preset ? { preset } : null;
  };
  const ready = payload() !== null;

  async function save() {
    const body = payload();
    if (!body) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { profiles?: Record<string, VoiceDna>; error?: string };
      if (!res.ok || !json.profiles) throw new Error(json.error ?? "Could not save your voice");
      setProfiles(json.profiles);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (profiles) {
    return (
      <div className="flex flex-col gap-4">
        {Object.entries(profiles).map(([register, dna]) => (
          <Section key={register} title={REGISTER_LABEL[register] ?? register} description={dna.tone}>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <dt className="text-caption-1-semibold text-text-tertiary">How you open</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {dna.openers.length ? dna.openers.map((o) => <Chip key={o} variant="caption" color="soft">{o}</Chip>) : <span className="text-body-2-regular text-text-tertiary">No pattern yet</span>}
                </dd>
              </div>
              <div className="flex flex-col gap-1.5">
                <dt className="text-caption-1-semibold text-text-tertiary">Never say</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {dna.vocab.never.map((w) => <Chip key={w} variant="caption" color="rose">{w}</Chip>)}
                </dd>
              </div>
            </dl>
          </Section>
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" leadingIcon={RiRefreshLine} onClick={() => setProfiles(null)}>Try again</Button>
          <Button trailingIcon={RiArrowRightLine} onClick={() => router.push("/inbox")}>Looks right</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        aria-label="How to learn your voice"
        selectedKeys={new Set([mode])}
        onSelectionChange={(keys) => {
          const next = [...keys][0];
          if (next) setMode(next as Mode);
        }}
      >
        <SegmentedControlItem id="buffer">My Buffer posts</SegmentedControlItem>
        <SegmentedControlItem id="paste">Paste posts</SegmentedControlItem>
        <SegmentedControlItem id="interview">6 questions</SegmentedControlItem>
        <SegmentedControlItem id="preset">Preset</SegmentedControlItem>
      </SegmentedControl>

      {mode === "buffer" && (
        <Section
          title="Use my recent Buffer posts"
          description={`Pick ${MIN_PICK}–${MAX_PICK} posts that sound most like you.`}
          aside={sent && <span className="text-caption-1-medium text-text-tertiary tabular-nums">{picked.length}/{MAX_PICK}</span>}
        >
          {!sent && !sentError && <AgentThinking label="Loading your sent posts" showTimer={false} />}
          {sentError && <p className="text-body-2-regular text-text-error-primary">{sentError}</p>}
          {sent?.length === 0 && <p className="text-body-2-regular text-text-tertiary">No sent posts yet. Paste a few or answer the questions instead.</p>}
          {sent && sent.length > 0 && (
            <ul className="flex flex-col gap-2">
              {sent.map((p) => {
                const on = picked.includes(p.id);
                return (
                  <li key={p.id} className={cx("rounded-xl border p-3", on ? "border-accent-500" : "border-border-button-default")}>
                    <Checkbox
                      isSelected={on}
                      isDisabled={!on && picked.length >= MAX_PICK}
                      onChange={(v) => setPicked((prev) => (v ? [...prev, p.id] : prev.filter((id) => id !== p.id)))}
                      className="items-start"
                    >
                      <span className="flex flex-col gap-1">
                        <span className="line-clamp-4 whitespace-pre-line text-body-2-regular">{p.text}</span>
                        <span className="text-caption-1-medium text-text-tertiary">
                          {p.service}
                          {p.sentAt && ` · ${new Date(p.sentAt).toLocaleDateString()}`}
                        </span>
                      </span>
                    </Checkbox>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}

      {mode === "paste" && (
        <Section title="Paste posts" description="Separate posts with a line containing --- (or a blank line if your posts are one paragraph).">
          <Textarea aria-label="Your posts" value={pasted} onChange={setPasted} rows={12} placeholder={"First post…\n---\nSecond post…"} />
          <span className="text-caption-1-medium text-text-tertiary">{pastedPosts.length} post{pastedPosts.length === 1 ? "" : "s"} found</span>
        </Section>
      )}

      {mode === "interview" && (
        <Section title="Answer 6 questions" description="Answer at least three. Short answers are fine.">
          {questions.map((q, i) => (
            <Textarea
              key={q}
              label={q}
              value={answers[i]}
              onChange={(v) => setAnswers((prev) => prev.map((a, j) => (j === i ? v : a)))}
              rows={i === questions.length - 1 ? 6 : 2}
            />
          ))}
        </Section>
      )}

      {mode === "preset" && (
        <Section title="Start from a preset" description="No AI call. Shiplog refines it as you edit drafts.">
          <div className="grid gap-2 sm:grid-cols-3">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                aria-pressed={preset === p.id}
                className={cx(
                  "flex flex-col gap-1 rounded-2xl border p-4 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                  preset === p.id ? "border-accent-500 bg-background-secondary-default" : "border-border-button-default hover:border-border-button-hover",
                )}
              >
                <span className="text-body-medium text-text-primary">{p.label}</span>
                <span className="text-caption-1-regular text-text-secondary">{p.tone}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {error && <p className="text-body-2-regular text-text-error-primary" role="alert">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        {saving && <AgentThinking label="Reading your voice" />}
        <Button onClick={save} disabled={!ready || saving}>
          {mode === "preset" ? "Use this preset" : "Learn my voice"}
        </Button>
      </div>
    </div>
  );
}
