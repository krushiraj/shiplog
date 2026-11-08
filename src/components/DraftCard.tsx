"use client";

import { useState } from "react";
import {
  RiArrowDownSLine,
  RiCalendarScheduleLine,
  RiCheckLine,
  RiCloseLine,
  RiFlashlightLine,
  RiLinkedinFill,
  RiMagicLine,
  RiQuestionLine,
  RiRefreshLine,
  RiSendPlaneLine,
  RiShieldCheckLine,
  RiSparkling2Line,
  RiThreadsFill,
  RiTimeLine,
  RiTwitterXFill,
  RiZzzLine,
  RiThumbDownLine,
  RiGitBranchLine,
} from "@remixicon/react";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { ComposerLoader } from "@/components/application/composer-loader/composer-loader";
import { Chip } from "@/components/base/badges/chip";
import { Button, buttonStyles } from "@/components/base/buttons/button";
import { Dropdown, DropdownGroup, DropdownItem, DropdownPopover, DropdownTrigger } from "@/components/base/dropdown/dropdown";
import { InputBase } from "@/components/base/input/input";
import { Tab, TabList, TabPanel, Tabs } from "@/components/base/tabs/tabs";
import { Textarea } from "@/components/base/textarea/textarea";
import { ChangeCardItem } from "@/components/ChangeCardItem";
import { CHANNELS, REJECT_REASONS, type ChannelKey, type DraftView } from "@/lib/ui-types";
import { cx } from "@/utils/cx";

export type ApproveWhen = { kind: "next_best" } | { kind: "now" } | { kind: "at"; iso: string };

export type DraftCardProps = {
  draft: DraftView;
  /** Set while a regenerate request is in flight. */
  regenerating?: boolean;
  onEdit?: (draftId: string, channel: ChannelKey, text: string) => void;
  onApprove?: (draftId: string, when: ApproveWhen, texts: Partial<Record<ChannelKey, string>>) => void;
  onRegenerate?: (draftId: string, nudge: string) => void;
  onReject?: (draftId: string, reason: string) => void;
  onSnooze?: (draftId: string) => void;
  onAnswerQuestion?: (draftId: string, cardId: string, answer: string) => void;
  onSuggestion?: (draftId: string, suggestionId: string, action: "accept" | "dismiss") => void;
};

const CHANNEL_ICON = { linkedin: RiLinkedinFill, x: RiTwitterXFill, threads: RiThreadsFill } as const;
const QUICK_NUDGES = ["shorter", "more technical", "lead with the number", "more casual"];

function driftTone(drift: number) {
  if (drift < 0.3) return { color: "lime" as const, label: "On voice" };
  if (drift < 0.6) return { color: "yellow" as const, label: "Slight drift" };
  return { color: "rose" as const, label: "Off voice" };
}

function CharMeter({ count, limit }: { count: number; limit: number }) {
  const ratio = Math.min(count / limit, 1);
  const over = count > limit;
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-background-tertiary-default">
        <div
          className={cx("h-full rounded-full transition-[width] duration-200", over ? "bg-text-error-primary" : ratio > 0.9 ? "bg-status-yellow-text" : "bg-accent-500")}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <span className={cx("font-code text-caption-1-medium tabular-nums", over ? "text-text-error-primary" : "text-text-tertiary")}>
        {count.toLocaleString()}/{limit.toLocaleString()}
      </span>
    </div>
  );
}

export function DraftCard({
  draft,
  regenerating = false,
  onEdit,
  onApprove,
  onRegenerate,
  onReject,
  onSnooze,
  onAnswerQuestion,
  onSuggestion,
}: DraftCardProps) {
  const channels = (Object.keys(CHANNELS) as ChannelKey[]).filter((c) => draft.variants[c] !== undefined);
  const [channel, setChannel] = useState<ChannelKey>(channels[0] ?? "linkedin");
  const [texts, setTexts] = useState<Partial<Record<ChannelKey, string>>>(draft.variants);
  const [panel, setPanel] = useState<"none" | "regenerate" | "reject" | "schedule">("none");
  const [nudge, setNudge] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [pickAt, setPickAt] = useState("");
  const [answer, setAnswer] = useState("");
  const [answered, setAnswered] = useState<string | null>(null);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [suggestionState, setSuggestionState] = useState<Record<string, "accept" | "dismiss">>({});

  // Re-sync when a regenerate brings new variants (adjusting state during render, not in an effect).
  const [seenVariants, setSeenVariants] = useState(draft.variants);
  if (seenVariants !== draft.variants) {
    setSeenVariants(draft.variants);
    setTexts(draft.variants);
  }

  const tone = driftTone(draft.gate.drift);
  const overLimit = channels.some((c) => (texts[c] ?? "").length > CHANNELS[c].limit);
  const edited = channels.some((c) => texts[c] !== draft.variants[c]);

  const approve = (when: ApproveWhen) => onApprove?.(draft.id, when, texts);
  const sendNudge = (value: string) => {
    if (!value.trim()) return;
    onRegenerate?.(draft.id, value.trim());
    setNudge("");
  };
  const reactToSuggestion = (id: string, action: "accept" | "dismiss") => {
    setSuggestionState((s) => ({ ...s, [id]: action }));
    onSuggestion?.(draft.id, id, action);
  };

  return (
    <section className="shiplog-rise overflow-hidden rounded-3xl border border-border-button-default bg-background-primary-default shadow-card">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-separator-border px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700 dark:bg-accent-950 dark:text-accent-300">
            {draft.trigger.kind === "release" ? <RiFlashlightLine className="size-5" /> : <RiGitBranchLine className="size-5" />}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-caption-1-medium text-text-tertiary">{draft.project.name}</span>
            <h3 className="truncate text-headline-semibold text-text-primary">{draft.trigger.label}</h3>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {edited && <Chip variant="caption" color="blue">Edited</Chip>}
          <Chip variant="subtle" color="soft" className="gap-1.5">
            <RiTimeLine className="size-4" aria-hidden />
            {draft.slot.label}
          </Chip>
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        {/* Editor column */}
        <div className="flex min-w-0 flex-col gap-4 p-5">
          <Tabs selectedKey={channel} onSelectionChange={(k) => setChannel(k as ChannelKey)}>
            <TabList aria-label="Channels">
              {channels.map((c) => {
                const len = (texts[c] ?? "").length;
                const over = len > CHANNELS[c].limit;
                return (
                  <Tab key={c} id={c} icon={CHANNEL_ICON[c]} count={<span className={cx("tabular-nums", over && "text-text-error-primary")}>{len}/{CHANNELS[c].limit}</span>}>
                    {CHANNELS[c].label}
                  </Tab>
                );
              })}
            </TabList>
            {channels.map((c) => (
              <TabPanel key={c} id={c} className="outline-none">
                <ComposerLoader active={regenerating} radius={20} surface={false} bloom={22}>
                  <div className="relative">
                    <Textarea
                      aria-label={`${CHANNELS[c].label} post`}
                      value={texts[c] ?? ""}
                      onChange={(value) => {
                        setTexts((t) => ({ ...t, [c]: value }));
                        onEdit?.(draft.id, c, value);
                      }}
                      isDisabled={regenerating}
                      autoResize
                      rows={7}
                      maxRows={18}
                      fieldClassName={cx("rounded-[20px] transition-[filter,opacity] duration-300", regenerating && "opacity-40 blur-[1.5px]")}
                    />
                    {regenerating && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <span className="rounded-full border border-border-button-default bg-background-primary-default px-4 py-2 shadow-md">
                          <AgentThinking variant="infinity" label="Rewriting in your voice" tone="primary" />
                        </span>
                      </div>
                    )}
                  </div>
                </ComposerLoader>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-caption-1-regular text-text-tertiary">Edits teach Shiplog your voice.</span>
                  <CharMeter count={(texts[c] ?? "").length} limit={CHANNELS[c].limit} />
                </div>
              </TabPanel>
            ))}
          </Tabs>

          {/* Voice gate */}
          <div className="flex flex-col gap-2.5 rounded-2xl bg-background-secondary-default p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-caption-1-semibold text-text-secondary">
                <RiShieldCheckLine className="size-4" aria-hidden /> Voice gate
              </span>
              <Chip variant="caption" color={tone.color} title="0 is exactly your voice, 1 is not you at all">
                {tone.label} · drift {draft.gate.drift.toFixed(2)}
              </Chip>
              {draft.gate.fixed.map((f) => (
                <Chip key={f} variant="caption" color="neutral" className="gap-1">
                  <RiCheckLine className="size-3.5" aria-hidden /> {f}
                </Chip>
              ))}
            </div>
            {draft.gate.suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {draft.gate.suggestions.map((s) => {
                  const state = suggestionState[s.id];
                  if (state === "dismiss") return null;
                  return (
                    <span
                      key={s.id}
                      className={cx(
                        "inline-flex items-center gap-1.5 rounded-full border py-1 pe-1 ps-3 text-body-2-medium transition-colors",
                        state === "accept"
                          ? "border-transparent bg-status-lime-background text-status-lime-text"
                          : "border-border-button-default bg-background-primary-default text-text-primary",
                      )}
                    >
                      <RiSparkling2Line className="size-3.5 shrink-0 text-accent-500" aria-hidden />
                      {s.text}
                      {state === "accept" ? (
                        <RiCheckLine className="me-1.5 size-4" aria-label="Accepted" />
                      ) : (
                        <span className="flex items-center">
                          <button type="button" aria-label="Accept suggestion" onClick={() => reactToSuggestion(s.id, "accept")} className="flex size-6 cursor-pointer items-center justify-center rounded-full text-foreground-icon-secondary hover:bg-status-lime-background hover:text-status-lime-text">
                            <RiCheckLine className="size-4" />
                          </button>
                          <button type="button" aria-label="Dismiss suggestion" onClick={() => reactToSuggestion(s.id, "dismiss")} className="flex size-6 cursor-pointer items-center justify-center rounded-full text-foreground-icon-secondary hover:bg-background-tertiary-hover">
                            <RiCloseLine className="size-4" />
                          </button>
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Open question */}
          {draft.openQuestion && (
            <div className="flex flex-col gap-2">
              {answered ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Chip variant="subtle" color="lime" className="w-fit gap-1.5">
                    <RiCheckLine className="size-4" aria-hidden /> Answered: {answered}
                  </Chip>
                  <Button
                    size="small"
                    variant="secondary"
                    leadingIcon={RiRefreshLine}
                    disabled={regenerating}
                    onClick={() => onRegenerate?.(draft.id, "Work in my answer about why this changed.")}
                  >
                    Rewrite with your answer
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setQuestionOpen((o) => !o)}
                  aria-expanded={questionOpen}
                  className="flex w-fit cursor-pointer items-center gap-2 rounded-full border border-accent-200 bg-accent-50 py-1.5 pe-3 ps-2 text-start text-body-2-medium text-accent-800 hover:border-accent-300 dark:border-accent-800 dark:bg-accent-950 dark:text-accent-200"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-500 text-white">
                    <RiQuestionLine className="size-3.5" aria-hidden />
                  </span>
                  {draft.openQuestion.question}
                </button>
              )}
              {questionOpen && !answered && (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!answer.trim() || !draft.openQuestion) return;
                    onAnswerQuestion?.(draft.id, draft.openQuestion.cardId, answer.trim());
                    setAnswered(answer.trim());
                    setQuestionOpen(false);
                  }}
                >
                  <InputBase
                    aria-label="Your answer"
                    placeholder="A sentence is plenty. It updates the change card and the brief."
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    fieldClassName="flex-1"
                    autoFocus
                  />
                  <Button type="submit" variant="secondary" disabled={!answer.trim()}>Save</Button>
                </form>
              )}
            </div>
          )}

          {/* Inline panels */}
          {panel === "regenerate" && (
            <div className="flex flex-col gap-2.5 shiplog-rise">
              <ComposerLoader active={regenerating} radius={16} bloom={14}>
                <form
                  className="flex items-center gap-2 p-1.5 ps-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendNudge(nudge);
                  }}
                >
                  <RiMagicLine className="size-5 shrink-0 text-accent-500" aria-hidden />
                  <input
                    aria-label="Nudge for the rewrite"
                    placeholder="Tell Shiplog what to change…"
                    value={nudge}
                    onChange={(e) => setNudge(e.target.value)}
                    disabled={regenerating}
                    className="min-w-0 flex-1 bg-transparent text-body-medium text-text-primary outline-none placeholder:text-text-placeholder"
                    autoFocus
                  />
                  <Button type="submit" size="small" leadingIcon={RiSendPlaneLine} disabled={!nudge.trim() || regenerating}>
                    Rewrite
                  </Button>
                </form>
              </ComposerLoader>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_NUDGES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={regenerating}
                    onClick={() => sendNudge(q)}
                    className="cursor-pointer rounded-full border border-border-button-default px-3 py-1 text-body-2-medium text-text-secondary hover:border-border-button-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {panel === "reject" && (
            <form
              className="flex flex-col gap-2.5 rounded-2xl border border-border-error-default/40 p-3 shiplog-rise"
              onSubmit={(e) => {
                e.preventDefault();
                onReject?.(draft.id, rejectReason.trim());
                setPanel("none");
              }}
            >
              <span className="text-body-2-medium text-text-secondary">Why skip it? Shiplog turns the reason into a rule.</span>
              <div className="flex flex-wrap gap-1.5">
                {REJECT_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRejectReason(r)}
                    className={cx(
                      "cursor-pointer rounded-full border px-3 py-1 text-body-2-medium",
                      rejectReason === r ? "border-transparent bg-status-rose-background text-status-rose-text" : "border-border-button-default text-text-secondary hover:text-text-primary",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <InputBase aria-label="Reject reason" placeholder="Or say it in your words" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} fieldClassName="flex-1" />
                <Button type="submit" variant="danger">Reject</Button>
              </div>
            </form>
          )}

          {panel === "schedule" && (
            <form
              className="flex flex-wrap items-center gap-2 rounded-2xl bg-background-secondary-default p-3 shiplog-rise"
              onSubmit={(e) => {
                e.preventDefault();
                if (pickAt) approve({ kind: "at", iso: new Date(pickAt).toISOString() });
                setPanel("none");
              }}
            >
              <RiCalendarScheduleLine className="size-5 text-foreground-icon-secondary" aria-hidden />
              <label className="text-body-2-medium text-text-secondary" htmlFor={`pick-${draft.id}`}>Post at</label>
              <input
                id={`pick-${draft.id}`}
                type="datetime-local"
                value={pickAt}
                onChange={(e) => setPickAt(e.target.value)}
                className="h-9 rounded-xl border border-border-button-default bg-background-primary-default px-3 text-body-medium text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
              />
              <Button type="submit" size="small" disabled={!pickAt}>Schedule</Button>
            </form>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-separator-border pt-4">
            <div className="flex items-center">
              <Button
                leadingIcon={RiCheckLine}
                className="rounded-e-none"
                disabled={overLimit || regenerating}
                onClick={() => approve({ kind: "next_best" })}
                title={overLimit ? "One of the channels is over its character limit" : `Queue for ${draft.slot.label}`}
              >
                Approve
              </Button>
              <Dropdown>
                <DropdownTrigger
                  aria-label="More approve options"
                  isDisabled={overLimit || regenerating}
                  className={cx(buttonStyles.base, buttonStyles.size.medium, buttonStyles.variant.primary, "rounded-s-none border-s border-white/25 px-1.5")}
                >
                  <RiArrowDownSLine className="size-5" aria-hidden />
                </DropdownTrigger>
                <DropdownPopover aria-label="Approve options" placement="bottom start" className="w-[248px]">
                  <DropdownGroup>
                    <DropdownItem onSelect={() => approve({ kind: "next_best" })}>
                      <RiTimeLine className="size-5 text-foreground-icon-secondary" aria-hidden />
                      <span className="flex flex-col items-start">
                        <span className="text-body-medium text-text-primary">Next best slot</span>
                        <span className="text-caption-1-regular text-text-tertiary">{draft.slot.label}</span>
                      </span>
                    </DropdownItem>
                    <DropdownItem onSelect={() => approve({ kind: "now" })}>
                      <RiSendPlaneLine className="size-5 text-foreground-icon-secondary" aria-hidden />
                      <span className="text-body-medium text-text-primary">Post now</span>
                    </DropdownItem>
                    <DropdownItem onSelect={() => setPanel("schedule")}>
                      <RiCalendarScheduleLine className="size-5 text-foreground-icon-secondary" aria-hidden />
                      <span className="text-body-medium text-text-primary">Pick a time…</span>
                    </DropdownItem>
                  </DropdownGroup>
                </DropdownPopover>
              </Dropdown>
            </div>
            <Button
              variant="secondary"
              leadingIcon={RiRefreshLine}
              aria-expanded={panel === "regenerate"}
              onClick={() => setPanel(panel === "regenerate" ? "none" : "regenerate")}
            >
              Regenerate
            </Button>
            <div className="ms-auto flex items-center gap-1">
              <Button variant="ghost" leadingIcon={RiZzzLine} onClick={() => onSnooze?.(draft.id)} title="Fold these changes into the next digest">
                Snooze
              </Button>
              <Button
                variant="ghost"
                leadingIcon={RiThumbDownLine}
                aria-expanded={panel === "reject"}
                onClick={() => setPanel(panel === "reject" ? "none" : "reject")}
              >
                Reject
              </Button>
            </div>
          </div>
        </div>

        {/* What changed */}
        <aside className="flex flex-col gap-3 border-t border-separator-border bg-background-secondary-default/60 p-5 lg:border-s lg:border-t-0">
          <div className="flex items-center justify-between">
            <h4 className="text-body-semibold text-text-primary">What changed</h4>
            <span className="text-caption-1-medium text-text-tertiary">
              {draft.cards.length} change{draft.cards.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex max-h-[640px] flex-col gap-2.5 overflow-y-auto pe-0.5 [scrollbar-width:thin]">
            {draft.cards.map((card) => (
              <ChangeCardItem key={card.id} card={card} hasQuestion={draft.openQuestion?.cardId === card.id && !answered} />
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
