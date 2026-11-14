"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RiQuestionLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { toast } from "@/components/base/toast/toast";

/** Answers a change card's open question; the answer becomes a fact in the project brief. */
export function AnswerQuestionForm({ projectId, cardId, question }: { projectId: string; cardId: string; question: string }) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/cards/${cardId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, answer: answer.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save the answer");
      toast.success("Saved to the project brief");
      setAnswer("");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-2xl bg-background-secondary-default p-3">
      <p className="flex items-start gap-1.5 text-body-2-medium text-text-secondary">
        <RiQuestionLine className="mt-0.5 size-4 shrink-0" aria-hidden /> {question}
      </p>
      <div className="flex items-center gap-2">
        <InputBase aria-label="Your answer" placeholder="Answer in a sentence" value={answer} onChange={(e) => setAnswer(e.target.value)} fieldClassName="flex-1" size="small" />
        <Button type="submit" size="small" disabled={busy || !answer.trim()} aria-busy={busy}>
          {busy ? "Saving…" : "Answer"}
        </Button>
      </div>
    </form>
  );
}
