import {
  RiGitCommitLine,
  RiGitMergeLine,
  RiPriceTag3Line,
  RiRocket2Line,
  RiCheckboxCircleLine,
  RiExternalLinkLine,
  RiQuestionLine,
} from "@remixicon/react";
import type { ComponentType } from "react";
import { Chip, type ChipColor } from "@/components/base/badges/chip";
import { SIGNIFICANCE_LABEL, type ChangeCardView, type Significance } from "@/lib/ui-types";
import { cx } from "@/utils/cx";

const KIND_ICON: Record<ChangeCardView["kind"], ComponentType<{ className?: string }>> = {
  commit: RiGitCommitLine,
  pr_merged: RiGitMergeLine,
  release: RiRocket2Line,
  tag: RiPriceTag3Line,
  issue_closed: RiCheckboxCircleLine,
};

const SIGNIFICANCE_COLOR: Record<Significance, ChipColor> = {
  0: "neutral",
  1: "cyan",
  2: "purple",
  3: "orange",
};

export function SignificancePill({ value }: { value: Significance }) {
  return (
    <Chip variant="caption" color={SIGNIFICANCE_COLOR[value]} className="gap-1">
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span key={n} className={cx("size-1 rounded-full bg-current", n > value && "opacity-25")} />
        ))}
      </span>
      {SIGNIFICANCE_LABEL[value]}
    </Chip>
  );
}

function Field({ label, children, inferred }: { label: string; children: string; inferred?: boolean }) {
  return (
    <div className="grid grid-cols-[64px_1fr] gap-2">
      <dt className="pt-px text-caption-1-medium uppercase tracking-wide text-text-tertiary">{label}</dt>
      <dd className="text-body-2-regular text-text-secondary">
        {children}
        {inferred && (
          <Chip variant="caption" color="yellow" className="ms-1.5 py-0 align-middle" title="Shiplog guessed this from the diff and context">
            inferred
          </Chip>
        )}
      </dd>
    </div>
  );
}

export type ChangeCardItemProps = {
  card: ChangeCardView;
  /** Highlights the card that has an open question. */
  hasQuestion?: boolean;
  className?: string;
};

export function ChangeCardItem({ card, hasQuestion, className }: ChangeCardItemProps) {
  const Icon = KIND_ICON[card.kind];
  return (
    <article
      className={cx(
        "flex flex-col gap-3 rounded-2xl border bg-background-primary-default p-4",
        hasQuestion ? "border-accent-300" : "border-border-button-default",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <a
          href={card.url}
          target="_blank"
          rel="noreferrer"
          className="group flex min-w-0 items-center gap-1.5 text-caption-1-medium text-text-tertiary hover:text-text-primary"
        >
          <Icon className="size-4 shrink-0" />
          <span className="font-code truncate">{card.ref}</span>
          <RiExternalLinkLine className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
        </a>
        <span className="flex items-center gap-1.5">
          {hasQuestion && <RiQuestionLine className="size-4 text-accent-600" aria-label="Has an open question" />}
          <SignificancePill value={card.significance} />
        </span>
      </header>
      <h4 className="text-body-semibold text-text-primary">{card.what}</h4>
      <dl className="flex flex-col gap-2">
        {card.why && <Field label="Why" inferred={card.whyInferred}>{card.why}</Field>}
        {card.how && <Field label="How">{card.how}</Field>}
        {card.impact && <Field label="Impact">{card.impact}</Field>}
      </dl>
    </article>
  );
}
