"use client";

import { useState } from "react";
import { RiInbox2Line } from "@remixicon/react";
import { toast } from "@/components/base/toast/toast";
import { DraftCard, type ApproveWhen } from "@/components/DraftCard";
import { showLearnedToast } from "@/components/LearnedToast";
import type { DraftView } from "@/lib/ui-types";

/** Demo wiring for the inbox: local state + toasts. Swap the handlers for API calls later. */
export function InboxView({ initialDrafts }: { initialDrafts: DraftView[] }) {
  const [drafts, setDrafts] = useState(initialDrafts);
  const [busy, setBusy] = useState<string | null>(null);

  const remove = (id: string) => setDrafts((d) => d.filter((x) => x.id !== id));

  const onApprove = (id: string, when: ApproveWhen, texts: DraftView["variants"]) => {
    const draft = drafts.find((d) => d.id === id);
    const edited = draft && Object.keys(texts).some((k) => texts[k as keyof typeof texts] !== draft.variants[k as keyof typeof texts]);
    remove(id);
    const label = when.kind === "now" ? "Posting now through Buffer" : when.kind === "at" ? `Scheduled for ${new Date(when.iso).toLocaleString()}` : `Queued for ${draft?.slot.label}`;
    toast.success(label, { description: "You can find it in Timeline." });
    if (edited) {
      setTimeout(() => showLearnedToast({ lesson: "you cut \"super\"", onAccept: () => toast.info("Rule is live for every future draft") }), 600);
    }
  };

  const onRegenerate = (id: string, nudge: string) => {
    setBusy(id);
    setTimeout(() => {
      setDrafts((all) =>
        all.map((d) =>
          d.id === id
            ? { ...d, variants: Object.fromEntries(Object.entries(d.variants).map(([k, v]) => [k, nudge === "shorter" ? v!.split("\n\n").slice(0, 2).join("\n\n") : v])) }
            : d,
        ),
      );
      setBusy(null);
    }, 2400);
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
          onApprove={onApprove}
          onRegenerate={onRegenerate}
          onReject={(id, reason) => {
            remove(id);
            toast("Draft rejected", { description: reason ? `Shiplog will remember: "${reason}"` : undefined });
          }}
          onSnooze={(id) => {
            remove(id);
            toast("Snoozed into the next digest");
          }}
          onAnswerQuestion={() => toast.success("Thanks. The change card and brief are updated.")}
        />
      ))}
    </div>
  );
}
