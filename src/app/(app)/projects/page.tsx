import Link from "next/link";
import { RiAddLine, RiFireLine, RiGithubLine, RiLinkedinFill, RiThreadsFill, RiTwitterXFill } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { ButtonLink } from "@/components/base/buttons/button";
import { PageHeader } from "@/components/shell/PageHeader";
import { mockProjects } from "@/lib/mock";

const CHANNEL_ICON = { linkedin: RiLinkedinFill, x: RiTwitterXFill, threads: RiThreadsFill } as const;

export default function ProjectsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Projects"
        description="A project groups repos that tell one story, with its own channels and schedule."
        actions={<ButtonLink href="/projects" leadingIcon={RiAddLine}>New project</ButtonLink>}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {mockProjects.map((p) => (
          <Link
            key={p.id}
            href="/settings"
            className="group flex flex-col gap-5 rounded-3xl border border-border-button-default bg-background-primary-default p-5 shadow-xs transition-[border-color,box-shadow] hover:border-border-button-hover hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-headline-semibold text-text-primary">{p.name}</h2>
                <span className="text-body-2-regular text-text-tertiary">{p.cadence}</span>
              </div>
              {p.paused ? <Chip variant="caption" color="neutral">Paused</Chip> : <Chip variant="caption" color="lime">Watching</Chip>}
            </div>

            <ul className="flex flex-col gap-1.5">
              {p.repos.map((r) => (
                <li key={r} className="font-code flex items-center gap-1.5 text-caption-1-medium text-text-secondary">
                  <RiGithubLine className="size-4 text-foreground-icon-tertiary" aria-hidden />
                  {r}
                </li>
              ))}
            </ul>

            <dl className="grid grid-cols-3 gap-2 rounded-2xl bg-background-secondary-default p-3">
              {[
                ["Changes", p.stats.changesThisWeek],
                ["Posts", p.stats.postsThisWeek],
                ["Streak", `${p.stats.streakDays}d`],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  <dt className="text-caption-1-medium text-text-tertiary">{label}</dt>
                  <dd className="flex items-center gap-1 text-title-3-semibold text-text-primary tabular-nums">
                    {value}
                    {label === "Streak" && Number(p.stats.streakDays) > 0 && <RiFireLine className="size-4 text-status-orange-text" aria-hidden />}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="flex items-center gap-2 text-foreground-icon-secondary">
              {p.channels.map((c) => {
                const Icon = CHANNEL_ICON[c];
                return <Icon key={c} className="size-4" aria-label={c} />;
              })}
              <span className="ms-auto text-caption-1-medium text-text-tertiary">this week</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
