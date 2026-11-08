"use client";

import { useState } from "react";
import { RiArrowGoBackLine, RiBookOpenLine, RiStackLine, RiQuillPenLine } from "@remixicon/react";
import { Chip, type ChipColor } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Switch } from "@/components/base/switch/switch";
import { Tab, TabList, TabPanel, Tabs } from "@/components/base/tabs/tabs";
import { Textarea } from "@/components/base/textarea/textarea";
import { toast } from "@/components/base/toast/toast";
import { ChangeCardItem } from "@/components/ChangeCardItem";
import type { BriefView, ChangeCardView, VoiceRuleView } from "@/lib/ui-types";

const KIND_COLOR: Record<VoiceRuleView["kind"], ChipColor> = { never: "rose", prefer: "lime", format: "cyan" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-border-button-default bg-background-primary-default p-4">
      <h3 className="text-caption-1-semibold uppercase tracking-wide text-text-tertiary">{title}</h3>
      {children}
    </section>
  );
}

export type MemoryViewProps = {
  brief: BriefView;
  cards: ChangeCardView[];
  rules: VoiceRuleView[];
  onSaveBrief?: (pitch: string) => void;
  onToggleRule?: (id: string, active: boolean) => void;
  onUndoRule?: (id: string) => void;
};

export function MemoryView({ brief, cards, rules: initialRules, onSaveBrief, onToggleRule, onUndoRule }: MemoryViewProps) {
  const [pitch, setPitch] = useState(brief.pitch);
  const [rules, setRules] = useState(initialRules);

  return (
    <Tabs defaultSelectedKey="brief">
      <TabList aria-label="Memory">
        <Tab id="brief" icon={RiBookOpenLine}>Brief</Tab>
        <Tab id="cards" icon={RiStackLine} count={cards.length}>Change cards</Tab>
        <Tab id="rules" icon={RiQuillPenLine} count={rules.filter((r) => r.active).length}>Voice rules</Tab>
      </TabList>

      <TabPanel id="brief" className="outline-none">
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Pitch">
            <Textarea aria-label="Pitch" value={pitch} onChange={setPitch} autoResize rows={2} />
            <div className="flex justify-end">
              <Button size="small" variant="secondary" disabled={pitch === brief.pitch} onClick={() => { onSaveBrief?.(pitch); toast.success("Brief updated"); }}>
                Save
              </Button>
            </div>
          </Section>
          <Section title="Audience and problem">
            <p className="text-body-regular text-text-primary">{brief.audience}</p>
            <p className="text-body-regular text-text-secondary">{brief.problem}</p>
          </Section>
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
        </div>
      </TabPanel>

      <TabPanel id="cards" className="outline-none">
        <div className="grid gap-3 lg:grid-cols-2">
          {cards.map((c) => <ChangeCardItem key={c.id} card={c} />)}
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
                onClick={() => {
                  setRules((all) => all.filter((x) => x.id !== r.id));
                  onUndoRule?.(r.id);
                  toast("Rule removed", { description: r.rule });
                }}
              >
                Undo
              </Button>
              <Switch
                aria-label={`${r.active ? "Disable" : "Enable"} rule`}
                isSelected={r.active}
                onChange={(active) => {
                  setRules((all) => all.map((x) => (x.id === r.id ? { ...x, active } : x)));
                  onToggleRule?.(r.id, active);
                }}
              />
            </li>
          ))}
        </ul>
      </TabPanel>
    </Tabs>
  );
}
