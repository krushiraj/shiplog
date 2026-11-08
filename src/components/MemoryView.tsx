"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RiArrowGoBackLine, RiBookOpenLine, RiQuestionLine, RiStackLine, RiQuillPenLine } from "@remixicon/react";
import { Chip, type ChipColor } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Switch } from "@/components/base/switch/switch";
import { Tab, TabList, TabPanel, Tabs } from "@/components/base/tabs/tabs";
import { Textarea } from "@/components/base/textarea/textarea";
import { toast } from "@/components/base/toast/toast";
import { ChangeCardItem } from "@/components/ChangeCardItem";
import { ruleAction, sendJson } from "@/lib/client-api";
import type { BriefView, ChangeCardView, VoiceRuleView } from "@/lib/ui-types";
import { cx } from "@/utils/cx";

const KIND_COLOR: Record<VoiceRuleView["kind"], ChipColor> = { never: "rose", prefer: "lime", format: "cyan" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-border-button-default bg-background-primary-default p-4">
      <h3 className="text-caption-1-semibold uppercase tracking-wide text-text-tertiary">{title}</h3>
      {children}
    </section>
  );
}

export type MemoryCard = ChangeCardView & { openQuestion?: string | null };
export type MemoryProfile = { id: string; register: string; scope: "you" | "project"; dna: Record<string, unknown> };

export type MemoryViewProps = {
  projectId: string;
  projects?: { id: string; name: string }[];
  brief: BriefView;
  cards: MemoryCard[];
  rules: VoiceRuleView[];
  profiles?: MemoryProfile[];
};

type BriefText = Pick<BriefView, "pitch" | "audience" | "problem">;

export function MemoryView({ projectId, projects = [], brief, cards, rules: initialRules, profiles = [] }: MemoryViewProps) {
  const router = useRouter();
  const [saved, setSaved] = useState<BriefText>({ pitch: brief.pitch, audience: brief.audience, problem: brief.problem });
  const [text, setText] = useState<BriefText>(saved);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState(initialRules);
  const dirty = (Object.keys(text) as (keyof BriefText)[]).some((k) => text[k] !== saved[k]);

  const saveBrief = async () => {
    setSaving(true);
    try {
      await sendJson(`/api/brief/${projectId}`, "PUT", text);
      setSaved(text);
      toast.success("Brief updated", { description: "Future drafts use it." });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = (r: VoiceRuleView, active: boolean) => {
    setRules((all) => all.map((x) => (x.id === r.id ? { ...x, active } : x)));
    ruleAction(r.id, { active }).catch((e: Error) => {
      setRules((all) => all.map((x) => (x.id === r.id ? { ...x, active: r.active } : x)));
      toast.error(e.message);
    });
  };

  const removeRule = (r: VoiceRuleView) => {
    setRules((all) => all.filter((x) => x.id !== r.id));
    sendJson(`/api/rules/${r.id}`, "DELETE")
      .then(() => {
        toast("Rule removed", { description: r.rule });
        router.refresh();
      })
      .catch((e: Error) => {
        setRules(initialRules);
        toast.error(e.message);
      });
  };

  return (
    <div className="flex flex-col gap-4">
    {projects.length > 1 && (
      <nav aria-label="Project" className="flex flex-wrap gap-1.5">
        {projects.map((p) => (
          <Link
            key={p.id}
            href={`/memory?project=${p.id}`}
            aria-current={p.id === projectId ? "page" : undefined}
            className={cx(
              "rounded-full border px-3 py-1 text-body-2-medium",
              p.id === projectId ? "border-transparent bg-accent-50 text-accent-800 dark:bg-accent-950 dark:text-accent-200" : "border-border-button-default text-text-secondary hover:text-text-primary",
            )}
          >
            {p.name}
          </Link>
        ))}
      </nav>
    )}
    <Tabs defaultSelectedKey="brief">
      <TabList aria-label="Memory">
        <Tab id="brief" icon={RiBookOpenLine}>Brief</Tab>
        <Tab id="cards" icon={RiStackLine} count={cards.length}>Change cards</Tab>
        <Tab id="rules" icon={RiQuillPenLine} count={rules.filter((r) => r.active).length}>Voice rules</Tab>
      </TabList>

      <TabPanel id="brief" className="outline-none">
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Pitch">
            <Textarea aria-label="Pitch" value={text.pitch} onChange={(v) => setText((t) => ({ ...t, pitch: v }))} autoResize rows={2} />
          </Section>
          <Section title="Audience and problem">
            <Textarea aria-label="Audience" value={text.audience} onChange={(v) => setText((t) => ({ ...t, audience: v }))} autoResize rows={2} />
            <Textarea aria-label="Problem" value={text.problem} onChange={(v) => setText((t) => ({ ...t, problem: v }))} autoResize rows={2} />
          </Section>
          <div className="flex items-center justify-end gap-2 lg:col-span-2">
            {dirty && (
              <Button size="small" variant="ghost" onClick={() => setText(saved)}>
                Discard
              </Button>
            )}
            <Button size="small" variant="secondary" disabled={!dirty || saving} onClick={saveBrief}>
              {saving ? "Saving…" : "Save brief"}
            </Button>
          </div>
          <Section title="Architecture">
            <ul className="flex flex-col divide-y divide-separator-border">
              {brief.architecture.map((a) => (
                <li key={a.module} className="flex items-baseline justify-between gap-4 py-2">
                  <span className="font-code text-caption-1-medium text-text-primary">{a.module}</span>
                  <span className="text-end text-body-2-regular text-text-secondary">{a.purpose}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Glossary">
            <ul className="flex flex-col gap-2">
              {brief.glossary.map((g) => (
                <li key={g.term} className="text-body-2-regular text-text-secondary">
                  <span className="text-body-2-semibold text-text-primary">{g.term}</span>: {g.plain}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Stack">
            <div className="flex flex-wrap gap-1.5">
              {brief.stack.map((s) => <Chip key={s} variant="caption" color="neutral">{s}</Chip>)}
            </div>
          </Section>
          <Section title="Milestones">
            <ol className="flex flex-col gap-1.5">
              {brief.milestones.map((m, i) => (
                <li key={m} className="flex items-center gap-2 text-body-2-regular text-text-secondary">
                  <span className="flex size-5 items-center justify-center rounded-full bg-accent-500 text-caption-2-semibold text-white">{i + 1}</span>
                  {m}
                </li>
              ))}
            </ol>
          </Section>
          {(brief.facts?.length ?? 0) > 0 && (
            <Section title="Facts from your answers">
              <ul className="flex flex-col gap-1.5">
                {brief.facts!.map((f) => (
                  <li key={f} className="text-body-2-regular text-text-secondary">{f}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </TabPanel>

      <TabPanel id="cards" className="outline-none">
        <div className="grid gap-3 lg:grid-cols-2">
          {cards.length === 0 && <p className="text-body-regular text-text-secondary">No change cards yet. Push a commit to a watched repo.</p>}
          {cards.map((c) => (
            <div key={c.id} className="flex flex-col gap-1.5">
              <ChangeCardItem card={c} hasQuestion={!!c.openQuestion} />
              {c.openQuestion && (
                <p className="flex items-center gap-1.5 px-1 text-caption-1-regular text-text-tertiary">
                  <RiQuestionLine className="size-3.5 shrink-0" aria-hidden /> {c.openQuestion} Answer it on the draft in your inbox.
                </p>
              )}
            </div>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="rules" className="outline-none">
        <ul className="flex flex-col divide-y divide-separator-border overflow-hidden rounded-3xl border border-border-button-default bg-background-primary-default">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:flex-nowrap">
              <Chip variant="caption" color={KIND_COLOR[r.kind]} className="w-16 justify-center">{r.kind}</Chip>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-medium text-text-primary">{r.rule}</span>
                <span className="text-caption-1-regular text-text-tertiary">
                  {r.source} · seen {r.sightings}×{r.register ? ` · ${r.register}` : ""}
                </span>
              </div>
              <Button
                size="small"
                variant="ghost"
                leadingIcon={RiArrowGoBackLine}
                onClick={() => removeRule(r)}
              >
                Remove
              </Button>
              <Switch
                aria-label={`${r.active ? "Disable" : "Enable"} rule`}
                isSelected={r.active}
                onChange={(active) => toggleRule(r, active)}
              />
            </li>
          ))}
        </ul>
        {rules.length === 0 && (
          <p className="mt-3 text-body-regular text-text-secondary">No rules yet. Edit a draft before approving and Shiplog learns from the diff.</p>
        )}
        {profiles.length > 0 && (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {profiles.map((p) => (
              <Section key={p.id} title={`Voice DNA · ${p.register}${p.scope === "project" ? " · this project" : ""}`}>
                <pre className="font-code max-h-80 overflow-auto rounded-xl bg-background-secondary-default p-3 text-caption-1-regular text-text-primary">
                  {JSON.stringify(p.dna, null, 2)}
                </pre>
              </Section>
            ))}
          </div>
        )}
      </TabPanel>
    </Tabs>
    </div>
  );
}
