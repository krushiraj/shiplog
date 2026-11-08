"use client";

import { useEffect, useState } from "react";
import { RiCheckLine, RiRefreshLine } from "@remixicon/react";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Section } from "@/components/onboarding/Section";
import type { Brief } from "@/lib/ai/schemas";
import { cx } from "@/utils/cx";

const STEPS = ["Reading README", "Mapping modules", "Building glossary", "Done"] as const;
const POLL_MS = 3000;
const GIVE_UP_MS = 5 * 60_000;
// Rough per-step pace for when the server cannot report progress (another instance is building).
const STEP_GUESS_MS = 20_000;

type BriefResponse = { brief: Partial<Brief> | null; building: boolean; step: string | null; failed: boolean };

export function BriefPanel({ projectId, initialBrief, initiallyBuilding }: { projectId: string; initialBrief: Partial<Brief> | null; initiallyBuilding: boolean }) {
  const [brief, setBrief] = useState(initialBrief);
  const [building, setBuilding] = useState(initiallyBuilding || initialBrief === null);
  const [step, setStep] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!building) return;
    let stop = false;
    const tick = async () => {
      setNow(Date.now());
      try {
        const res = await fetch(`/api/projects/${projectId}/brief`, { cache: "no-store" });
        if (!res.ok || stop) return;
        const body = (await res.json()) as BriefResponse;
        setStep(body.step);
        if (body.failed) {
          setFailed(true);
          setBuilding(false);
        } else if (!body.building && body.brief) {
          setBrief(body.brief);
          setBuilding(false);
        }
      } catch {}
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setFailed(true);
        setBuilding(false);
      }
    };
    const id = setInterval(tick, POLL_MS);
    void tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [building, projectId, startedAt]);

  async function rebuild() {
    setFailed(false);
    setStep(null);
    setStartedAt(Date.now());
    setBuilding(true);
    await fetch(`/api/projects/${projectId}/brief`, { method: "POST" }).catch(() => setFailed(true));
  }

  const guessed = Math.min(STEPS.length - 2, Math.floor((now - startedAt) / STEP_GUESS_MS));
  const current = step && (STEPS as readonly string[]).includes(step) ? STEPS.indexOf(step as (typeof STEPS)[number]) : guessed;

  if (building || (failed && !brief)) {
    return (
      <Section title="Project brief" description="Shiplog reads your repos once so every post explains changes in context.">
        <ol className="flex flex-col gap-2">
          {STEPS.slice(0, -1).map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              {i < current ? (
                <RiCheckLine className="size-4 text-status-lime-text" aria-label="Done" />
              ) : (
                <span className={cx("size-1.5 rounded-full mx-[5px]", i === current && !failed ? "bg-accent-500" : "bg-background-tertiary-default")} aria-hidden />
              )}
              {i === current && building ? (
                <AgentThinking label={label} variant="wave" />
              ) : (
                <span className={cx("text-body-2-regular", i < current ? "text-text-secondary" : "text-text-tertiary")}>{label}</span>
              )}
            </li>
          ))}
        </ol>
        {failed && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-body-2-regular text-text-error-primary">The brief did not finish. It can take a minute on big repos.</p>
            <Button size="small" variant="secondary" leadingIcon={RiRefreshLine} onClick={rebuild}>Retry</Button>
          </div>
        )}
      </Section>
    );
  }

  if (!brief) return null;
  return (
    <Section
      title="Project brief"
      description={brief.pitch}
      aside={<Button size="small" variant="secondary" className="shrink-0" leadingIcon={RiRefreshLine} onClick={rebuild}>Rebuild</Button>}
    >
      <dl className="grid gap-4 sm:grid-cols-2">
        {brief.audience && (
          <div className="flex flex-col gap-1">
            <dt className="text-caption-1-semibold text-text-tertiary">Audience</dt>
            <dd className="text-body-2-regular text-text-primary">{brief.audience}</dd>
          </div>
        )}
        {brief.problem && (
          <div className="flex flex-col gap-1">
            <dt className="text-caption-1-semibold text-text-tertiary">Problem</dt>
            <dd className="text-body-2-regular text-text-primary">{brief.problem}</dd>
          </div>
        )}
      </dl>
      {!!brief.stack?.length && (
        <div className="flex flex-wrap gap-1.5">
          {brief.stack.map((s) => <Chip key={s} variant="caption" color="soft">{s}</Chip>)}
        </div>
      )}
      {!!brief.architecture?.length && (
        <div className="flex flex-col gap-2">
          <h3 className="text-caption-1-semibold text-text-tertiary">Architecture</h3>
          <ul className="flex flex-col divide-y divide-separator-border rounded-2xl border border-border-button-default">
            {brief.architecture.map((a) => (
              <li key={a.module} className="flex flex-col gap-0.5 p-3 sm:flex-row sm:gap-3">
                <span className="font-code shrink-0 text-caption-1-medium text-text-primary sm:w-48">{a.module}</span>
                <span className="text-body-2-regular text-text-secondary">{a.purpose}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!brief.glossary?.length && (
        <div className="flex flex-col gap-2">
          <h3 className="text-caption-1-semibold text-text-tertiary">Glossary</h3>
          <dl className="grid gap-2 sm:grid-cols-2">
            {brief.glossary.map((g) => (
              <div key={g.term} className="rounded-xl bg-background-secondary-default p-3">
                <dt className="text-body-medium text-text-primary">{g.term}</dt>
                <dd className="text-caption-1-regular text-text-secondary">{g.plain}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Section>
  );
}
