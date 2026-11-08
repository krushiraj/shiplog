"use client";

import { useEffect, useState } from "react";
import { RiCheckLine, RiGitCommitLine, RiLinkedinFill, RiTimeLine } from "@remixicon/react";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { Chip } from "@/components/base/badges/chip";
import { cx } from "@/utils/cx";

const COMMITS = [
  { sha: "a3f9c21", msg: "scrub secrets before analysis" },
  { sha: "41be0d2", msg: "voice gate: rule check + drift score" },
  { sha: "9be21d0", msg: "fix budget reset timezone" },
];

const POST =
  "Day 6 of building Shiplog.\n\nMy drafts kept using words I never use, so every draft now passes a voice gate first. Edits per post went from ~6 to 2.\n\n#BuildInPublic";

type Phase = "commits" | "thinking" | "typing" | "done";

/** Looping hero animation: commits land, Shiplog reads them, a post types itself out. */
export function WritingDemo({ className }: { className?: string }) {
  const [phase, setPhase] = useState<Phase>("commits");
  const [shown, setShown] = useState(0);
  const [chars, setChars] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(COMMITS.length);
      setChars(POST.length);
      setPhase("done");
      return;
    }
    let t: ReturnType<typeof setTimeout>;
    if (phase === "commits") {
      t = shown < COMMITS.length ? setTimeout(() => setShown((n) => n + 1), 550) : setTimeout(() => setPhase("thinking"), 400);
    } else if (phase === "thinking") {
      t = setTimeout(() => setPhase("typing"), 1800);
    } else if (phase === "typing") {
      t = chars < POST.length ? setTimeout(() => setChars((n) => n + 2), 22) : setTimeout(() => setPhase("done"), 200);
    } else {
      t = setTimeout(() => {
        setShown(0);
        setChars(0);
        setPhase("commits");
      }, 4200);
    }
    return () => clearTimeout(t);
  }, [phase, shown, chars]);

  return (
    <div className={cx("relative flex flex-col gap-3", className)} aria-label="Example: three commits become a LinkedIn post" role="img">
      <div className="flex flex-col gap-1.5 rounded-2xl border border-border-button-default bg-background-primary-default/80 p-3 shadow-xs backdrop-blur">
        <span className="px-1 text-caption-1-medium text-text-tertiary">krushiraj/shiplog · main</span>
        {COMMITS.map((c, i) => (
          <div
            key={c.sha}
            className={cx(
              "flex items-center gap-2 rounded-lg px-1 py-1 transition-all duration-500",
              i < shown ? "translate-y-0 opacity-100 blur-0" : "translate-y-1 opacity-0 blur-[2px]",
            )}
          >
            <RiGitCommitLine className="size-4 shrink-0 text-accent-500" aria-hidden />
            <span className="font-code text-caption-1-medium text-text-tertiary">{c.sha}</span>
            <span className="truncate text-body-2-regular text-text-primary">{c.msg}</span>
          </div>
        ))}
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-border-button-default bg-background-primary-default p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-[#0a66c2] text-white">
              <RiLinkedinFill className="size-4" aria-hidden />
            </span>
            <span className="flex flex-col">
              <span className="text-body-2-semibold text-text-primary">Your LinkedIn</span>
              <span className="text-caption-1-regular text-text-tertiary">Draft · in your voice</span>
            </span>
          </span>
          {phase === "done" ? (
            <Chip variant="caption" color="lime" className="gap-1 shiplog-rise">
              <RiCheckLine className="size-3.5" aria-hidden /> Ready to approve
            </Chip>
          ) : (
            <Chip variant="caption" color="neutral" className="gap-1">
              <RiTimeLine className="size-3.5" aria-hidden /> 18:30
            </Chip>
          )}
        </div>

        <div className="min-h-[156px] whitespace-pre-line text-body-regular text-text-primary">
          {phase === "commits" && <span className="text-text-tertiary">Waiting for today&apos;s changes…</span>}
          {phase === "thinking" && <AgentThinking variant="wave" label="Reading what changed: what, why, how, impact" showTimer={false} />}
          {(phase === "typing" || phase === "done") && (
            <>
              {POST.slice(0, chars)}
              {phase === "typing" && <span className="shiplog-caret" aria-hidden />}
            </>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-separator-border pt-3">
          <span className="text-caption-1-medium text-text-tertiary">Voice drift 0.12</span>
          <span className="font-code text-caption-1-medium text-text-tertiary tabular-nums">{Math.min(chars, POST.length)}/3000</span>
        </div>
      </div>
    </div>
  );
}
