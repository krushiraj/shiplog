"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RiInbox2Line } from "@remixicon/react";
import { toast } from "@/components/base/toast/toast";
import { DraftCard, type ApproveWhen } from "@/components/DraftCard";
import { showLearnedToast } from "@/components/LearnedToast";
import { draftAction, ruleAction, type LearnedRuleDto } from "@/lib/client-api";
import type { ChannelKey, DraftView } from "@/lib/ui-types";

const EDIT_DEBOUNCE_MS = 800;

type ApproveResponse = { status: string; errors: string[]; proposals: LearnedRuleDto[]; simulated: boolean };

const lessonOf = (r: LearnedRuleDto) => (r.kind === "never" ? `avoid "${r.rule}"` : r.rule);

function offerRules(proposals: LearnedRuleDto[]) {
  proposals.slice(0, 2).forEach((r, i) =>
    setTimeout(
      () =>
        showLearnedToast({
          lesson: lessonOf(r),
          detail: r.active ? "You've made this edit before, so it's live now. Undo if that's wrong." : undefined,
          onAccept: () =>
            ruleAction(r.ruleId, { active: true })
              .then(() => toast.info("Rule is live for every future draft"))
              .catch((e: Error) => toast.error(e.message)),
          onUndo: () => ruleAction(r.ruleId, { undo: true }).catch((e: Error) => toast.error(e.message)),
        }),
      600 + i * 400,
    ),
  );
}

export function InboxView({ initialDrafts }: { initialDrafts: DraftView[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState(initialDrafts);
  const [busy, setBusy] = useState<string | null>(null);
  const editTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Server refreshes (router.refresh) bring a new list; adopt it during render.
  const [seen, setSeen] = useState(initialDrafts);
  if (seen !== initialDrafts) {
    setSeen(initialDrafts);
    setDrafts(initialDrafts);
  }

  const remove = (id: string) => setDrafts((d) => d.filter((x) => x.id !== id));
  const fail = (e: unknown) => {
    toast.error((e as Error).message);
    router.refresh();
  };

  const flushEdits = (draftId: string) => {
    for (const [key, timer] of editTimers.current) {
      if (key.startsWith(`${draftId}:`)) {
        clearTimeout(timer);
        editTimers.current.delete(key);
      }
    }
  };

  const onEdit = (draftId: string, channel: ChannelKey, text: string) => {
    const key = `${draftId}:${channel}`;
    clearTimeout(editTimers.current.get(key));
    editTimers.current.set(
      key,
      setTimeout(() => {
        editTimers.current.delete(key);
        draftAction(draftId, { action: "edit", channel, text }).catch((e: Error) => toast.error(`Couldn't save your edit: ${e.message}`));
      }, EDIT_DEBOUNCE_MS),
    );
  };

  const onApprove = async (id: string, when: ApproveWhen, texts: DraftView["variants"], channels?: ChannelKey[]) => {
    const draft = drafts.find((d) => d.id === id);
    flushEdits(id);
    remove(id);
    const body =
      when.kind === "now" ? "now" : when.kind === "at" ? { at: when.iso } : "next_best_slot";
    try {
      const res = await draftAction<ApproveResponse>(id, { action: "approve", when: body, texts, channels });
      if (res.simulated) {
        toast.success("Posted (simulated) — connect Buffer to post for real.");
      } else if (res.errors.length) {
        toast.error("Some channels failed", { description: res.errors.join(" · ") });
      } else {
        const label =
          when.kind === "now" ? "Posting now through Buffer" : when.kind === "at" ? `Scheduled for ${new Date(when.iso).toLocaleString()}` : `Queued for ${draft?.slot.label ?? "the next slot"}`;
        toast.success(label, { description: "You can find it in Timeline." });
      }
      offerRules(res.proposals);
      router.refresh();
    } catch (e) {
      fail(e);
    }
  };

  const onRegenerate = async (id: string, nudge: string) => {
    flushEdits(id);
    setBusy(id);
    try {
      await draftAction(id, { action: "regenerate", ...(nudge && { nudge }) });
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onReject = async (id: string, reason: string) => {
    flushEdits(id);
    remove(id);
    try {
      const res = await draftAction<{ proposals: LearnedRuleDto[] }>(id, { action: "reject", reason });
      const rule = res.proposals[0];
      toast("Draft rejected", {
        description: reason ? `Shiplog will remember: "${reason}"` : undefined,
        actions: rule ? [{ label: "Undo rule", variant: "secondary", onClick: () => void ruleAction(rule.ruleId, { undo: true }) }] : undefined,
      });
      router.refresh();
    } catch (e) {
      fail(e);
    }
  };

  const onSnooze = async (id: string) => {
    flushEdits(id);
    remove(id);
    try {
      await draftAction(id, { action: "snooze" });
      toast("Snoozed into the next digest");
      router.refresh();
    } catch (e) {
      fail(e);
    }
  };

  const onAnswerQuestion = async (id: string, cardId: string, answer: string) => {
    try {
      await draftAction(id, { action: "answer", cardId, answer });
      toast.success("Thanks. The change card and brief are updated.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onSuggestion = (id: string, suggestionId: string, action: "accept" | "dismiss") => {
    const [channel, index] = suggestionId.split(":");
    draftAction(id, { action: "suggestion", channel, index: Number(index), accept: action === "accept" }).catch((e: Error) =>
      toast.error(e.message),
    );
  };

  if (drafts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border-button-default px-6 py-20 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-background-secondary-default">
          <RiInbox2Line className="size-6 text-foreground-icon-secondary" aria-hidden />
        </span>
        <h2 className="text-title-3-semibold text-text-primary">Inbox zero</h2>
        <p className="max-w-sm text-body-regular text-text-secondary">
          Nothing waiting for review. Shiplog will drop the next draft here when your digest is due.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {drafts.map((d) => (
        <DraftCard
          key={d.id}
          draft={d}
          regenerating={busy === d.id}
          onEdit={onEdit}
          onApprove={onApprove}
          onRegenerate={onRegenerate}
          onReject={onReject}
          onSnooze={onSnooze}
          onAnswerQuestion={onAnswerQuestion}
          onSuggestion={onSuggestion}
        />
      ))}
    </div>
  );
}
