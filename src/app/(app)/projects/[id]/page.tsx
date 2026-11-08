import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { RiGithubLine, RiSettings3Line } from "@remixicon/react";
import { db } from "@/db";
import { projectRepos, users } from "@/db/schema";
import { Chip } from "@/components/base/badges/chip";
import { ButtonLink } from "@/components/base/buttons/button";
import { BriefPanel } from "@/components/onboarding/BriefPanel";
import { Section } from "@/components/onboarding/Section";
import { PageHeader } from "@/components/shell/PageHeader";
import type { Brief } from "@/lib/ai/schemas";
import { resolveConfig, type PartialConfig } from "@/lib/config";
import { getOwnedProject } from "@/lib/projects";
import { getSessionUserId } from "@/lib/session";

const DIGEST_LABEL: Record<string, string> = { "1d": "Every day", "2d": "Every 2 days", off: "Off (releases only)" };
const REVIEW_LABEL = { inbox: "Inbox", draft: "Buffer draft", auto: "Auto" } as const;

const digestLabel = (every: string) => DIGEST_LABEL[every] ?? (every.startsWith("weekly:") ? `Weekly on ${every.slice(7)}` : every);

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ building?: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/api/auth/buffer/start");

  const project = await getOwnedProject(userId, (await params).id);
  if (!project) notFound();

  const [repos, [user]] = await Promise.all([
    db.select().from(projectRepos).where(eq(projectRepos.projectId, project.id)),
    db.select({ defaults: users.defaults, channels: users.channels }).from(users).where(eq(users.id, userId)).limit(1),
  ]);
  const config = resolveConfig((user?.defaults ?? {}) as PartialConfig, project.config as PartialConfig);
  const channels = config.channels.map((id) => user?.channels?.find((c) => c.id === id) ?? { id, name: id, displayName: null, service: "unknown", isDisconnected: true });
  const building = (await searchParams).building === "1";

  const summary: [string, string][] = [
    ["Digest", config.triggers.digest.every === "off" ? digestLabel("off") : `${digestLabel(config.triggers.digest.every)} at ${config.triggers.digest.at}`],
    ["Review", REVIEW_LABEL[config.review.mode]],
    ["Timezone", config.timezone],
    ["Posting", config.posting.when === "next_best_slot" ? "Next best slot" : config.posting.when],
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageHeader
        title={project.name}
        description={project.paused ? "Paused. Shiplog is not watching these repos." : "Watching for commits, merged PRs and releases."}
        actions={<ButtonLink href={`/settings?project=${project.id}`} variant="secondary" leadingIcon={RiSettings3Line}>Settings</ButtonLink>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <BriefPanel projectId={project.id} initialBrief={project.brief as Partial<Brief> | null} initiallyBuilding={building} />

        <div className="flex flex-col gap-4">
          <Section title="Repos">
            <ul className="flex flex-col gap-1.5">
              {repos.map((r) => (
                <li key={r.repoFullName} className="font-code flex items-center gap-1.5 text-caption-1-medium text-text-secondary">
                  <RiGithubLine className="size-4 text-foreground-icon-tertiary" aria-hidden />
                  <a href={`https://github.com/${r.repoFullName}`} className="hover:text-text-primary" target="_blank" rel="noreferrer">
                    {r.repoFullName}
                  </a>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Channels">
            {channels.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {channels.map((c) => (
                  <li key={c.id}>
                    <Chip variant="caption" color={c.isDisconnected ? "rose" : "soft"}>
                      {c.displayName ?? c.name} · {c.service}
                    </Chip>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-2-regular text-text-tertiary">No channels yet. Add some in settings.</p>
            )}
          </Section>

          <Section title="Schedule">
            <dl className="flex flex-col gap-2">
              {summary.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <dt className="text-body-2-regular text-text-tertiary">{label}</dt>
                  <dd className="text-body-2-medium text-text-primary">{value}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}
