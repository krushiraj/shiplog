"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RiArrowRightLine, RiRefreshLine } from "@remixicon/react";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Textarea } from "@/components/base/textarea/textarea";
import { Section } from "@/components/onboarding/Section";
import type { VoiceDna } from "@/lib/ai/schemas";
import { splitPastedPosts } from "@/lib/voice/bootstrap";
import type { Register } from "@/lib/voice/extract";
import type { AutoLearnResult, NeedsMore, WritingSample } from "@/lib/voice/history";
import { cx } from "@/utils/cx";

type Mode = "paste" | "interview" | "preset";
type Preset = { id: string; label: string; tone: string };
type Profiles = Partial<Record<Register, VoiceDna>>;

const REGISTER_TITLE: Record<Register, string> = { linkedin: "Long posts (LinkedIn)", "x-short": "Short posts (X, Threads, Bluesky, Instagram)" };
const REGISTER_NAME: Record<Register, string> = { linkedin: "LinkedIn", "x-short": "short-form" };
const SERVICE_LABEL: Record<string, string> = { linkedin: "LinkedIn", twitter: "X", threads: "Threads", bluesky: "Bluesky", mastodon: "Mastodon", instagram: "Instagram" };

const listOf = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function askFor({ register, have, channels }: NeedsMore) {
  const name = REGISTER_NAME[register];
  if (channels === 0) return `No ${name} channel is connected in Buffer, so I have no ${name} posts to learn from.`;
  return have === 0 ? `I couldn't find any ${name} posts you've written.` : `I only found ${plural(have, `${name} post`)}.`;
}

function Chips({ items, color = "soft", empty }: { items: string[]; color?: "soft" | "rose"; empty: string }) {
  if (!items.length) return <span className="text-body-2-regular text-text-tertiary">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((x) => (
        <Chip key={x} variant="caption" color={color}>{x}</Chip>
      ))}
    </span>
  );
}

function DnaCard({ register, dna, used }: { register: Register; dna: VoiceDna; used: WritingSample[] }) {
  const rows: [string, ReactNode][] = [
    ["How you open", <Chips key="o" items={dna.openers} empty="No pattern yet" />],
    ["How you close", <Chips key="c" items={dna.closers} empty="No pattern yet" />],
    ["Never say", <Chips key="n" items={dna.vocab.never} color="rose" empty="Nothing yet" />],
  ];
  return (
    <Section
      title={REGISTER_TITLE[register]}
      description={dna.tone}
      aside={used.length > 0 && <span className="shrink-0 text-caption-1-medium text-text-tertiary tabular-nums">from {plural(used.length, "post")}</span>}
    >
      <dl className="grid gap-3 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1.5">
            <dt className="text-caption-1-semibold text-text-tertiary">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {used.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption-1-semibold text-text-tertiary">Posts it learned from</span>
          <ul className="flex flex-col gap-2">
            {used.slice(0, 3).map((p) => (
              <li key={`${p.channelId}-${p.sentAt}-${p.kind}`} className="rounded-xl border border-border-button-default p-3">
                <p className="line-clamp-3 whitespace-pre-line text-body-2-regular text-text-secondary">{p.text}</p>
                <span className="text-caption-1-medium text-text-tertiary">
                  {SERVICE_LABEL[p.service] ?? p.service}
                  {p.kind === "first_comment" && " · first comment"}
                  {p.sentAt && ` · ${new Date(p.sentAt).toLocaleDateString()}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

export function VoiceBootstrap({ questions, presets, sources }: { questions: string[]; presets: Preset[]; sources: string[] }) {
  const router = useRouter();
  const [run, setRun] = useState(0);
  const [auto, setAuto] = useState<AutoLearnResult | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profiles>({});
  const [mode, setMode] = useState<Mode>("paste");
  const [pasted, setPasted] = useState("");
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [preset, setPreset] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reading = !auto && !autoError;
  useEffect(() => {
    let cancelled = false;
    fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "auto" }) })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as Partial<AutoLearnResult> & { error?: string };
        if (!res.ok || !body.profiles) throw new Error(body.error ?? "Could not read your Buffer posts");
        return body as AutoLearnResult;
      })
      .then(
        (result) => {
          if (cancelled) return;
          setAuto(result);
          setProfiles(result.profiles);
        },
        (e: Error) => !cancelled && setAutoError(e.message),
      );
    return () => {
      cancelled = true;
    };
  }, [run]);

  function reread() {
    setAuto(null);
    setAutoError(null);
    setProfiles({});
    setError(null);
    setRun((n) => n + 1);
  }

  const missing = (auto?.needsMore ?? []).filter((n) => !profiles[n.register]);
  const fallbackRegisters: Register[] | undefined = autoError ? undefined : missing.map((n) => n.register);
  const showFallback = Boolean(autoError) || missing.length > 0;

  const pastedPosts = splitPastedPosts(pasted);
  const answered = answers.filter((a) => a.trim()).length;
  const payload = (): Record<string, unknown> | null => {
    const registers = fallbackRegisters?.length ? { registers: fallbackRegisters } : {};
    if (mode === "paste") return pastedPosts.length ? { samples: pastedPosts.slice(0, 20), ...registers } : null;
    if (mode === "interview") return answered >= 3 ? { samples: [], interview: questions.map((q, i) => ({ q, a: answers[i] })), ...registers } : null;
    return preset ? { preset, ...registers } : null;
  };
  const ready = payload() !== null;

  async function save() {
    const body = payload();
    if (!body) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { profiles?: Profiles; error?: string };
      if (!res.ok || !json.profiles) throw new Error(json.error ?? "Could not save your writing style");
      setProfiles((prev) => ({ ...prev, ...json.profiles }));
      setAutoError(null);
      if (!auto) setAuto({ profiles: json.profiles, used: { linkedin: [], "x-short": [] }, needsMore: [], perChannel: [] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (reading) {
    const from = sources.length ? listOf(sources) : "Buffer";
    return (
      <Section title="Reading your writing" description="Shiplog looks at the posts you've already sent, so you don't have to pick any.">
        <AgentThinking label={`Reading your recent posts from ${from}…`} />
      </Section>
    );
  }

  const learned = (Object.keys(profiles) as Register[]).filter((r) => profiles[r]);
  const counted = (auto?.perChannel ?? []).filter((c) => c.posts > 0);

  return (
    <div className="flex flex-col gap-4">
      {counted.length > 0 && (
        <p className="text-body-2-regular text-text-secondary">
          Read {listOf(counted.map((c) => `${plural(c.posts, "post")} from ${SERVICE_LABEL[c.service] ?? c.service} (${c.name})`))}.
        </p>
      )}

      {learned.map((r) => (
        <DnaCard key={r} register={r} dna={profiles[r]!} used={auto?.used[r] ?? []} />
      ))}

      {showFallback && (
        <Section
          title={autoError ? "Couldn't read your posts" : "I need a few more posts"}
          description={
            autoError ? (
              `${autoError} Paste 3–5 posts you've written, or answer a few questions.`
            ) : (
              <>
                {missing.map((n) => (
                  <span key={n.register} className="block">{askFor(n)}</span>
                ))}
                <span className="block">Paste 3–5 posts you&apos;ve written, or answer a few questions.</span>
              </>
            )
          }
        >
          <SegmentedControl
            aria-label="How to teach your writing style"
            selectedKeys={new Set([mode])}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next) setMode(next as Mode);
            }}
          >
            <SegmentedControlItem id="paste">Paste posts</SegmentedControlItem>
            <SegmentedControlItem id="interview">{questions.length} questions</SegmentedControlItem>
            <SegmentedControlItem id="preset">Preset</SegmentedControlItem>
          </SegmentedControl>

          {mode === "paste" && (
            <div className="flex flex-col gap-1.5">
              <Textarea aria-label="Your posts" value={pasted} onChange={setPasted} rows={10} placeholder={"First post…\n---\nSecond post…"} />
              <span className="text-caption-1-medium text-text-tertiary">
                {plural(pastedPosts.length, "post")} found. Separate posts with a line containing --- (or a blank line if your posts are one paragraph).
              </span>
            </div>
          )}

          {mode === "interview" && (
            <div className="flex flex-col gap-3">
              <span className="text-body-2-regular text-text-secondary">Answer at least three. Short answers are fine.</span>
              {questions.map((q, i) => (
                <Textarea
                  key={q}
                  label={q}
                  value={answers[i]}
                  onChange={(v) => setAnswers((prev) => prev.map((a, j) => (j === i ? v : a)))}
                  rows={i === questions.length - 1 ? 6 : 2}
                />
              ))}
            </div>
          )}

          {mode === "preset" && (
            <div className="flex flex-col gap-2">
              <span className="text-body-2-regular text-text-secondary">Last resort: no AI call. Shiplog refines it as you edit drafts.</span>
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
            </div>
          )}

          {error && <p className="text-body-2-regular text-text-error-primary" role="alert">{error}</p>}
          <div className="flex items-center justify-end gap-3">
            {saving && <AgentThinking label="Learning your writing style" />}
            <Button onClick={save} disabled={!ready || saving}>
              {mode === "preset" ? "Use this preset" : "Learn my writing style"}
            </Button>
          </div>
        </Section>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" leadingIcon={RiRefreshLine} onClick={reread} disabled={saving}>
          Re-read my posts
        </Button>
        {learned.length > 0 && (
          <Button trailingIcon={RiArrowRightLine} onClick={() => router.push("/inbox")}>
            Looks right
          </Button>
        )}
      </div>
    </div>
  );
}
