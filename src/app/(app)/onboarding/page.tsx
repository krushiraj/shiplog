import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { RiArrowRightLine, RiCheckLine, RiGithubLine, RiQuillPenLine } from "@remixicon/react";
import { db } from "@/db";
import { githubInstallations, projects, users, voiceProfiles } from "@/db/schema";
import { Chip } from "@/components/base/badges/chip";
import { ButtonLink } from "@/components/base/buttons/button";
import { Section } from "@/components/onboarding/Section";
import { PageHeader } from "@/components/shell/PageHeader";
import { getSessionUserId } from "@/lib/session";
import { cx } from "@/utils/cx";

const GITHUB_NOTICE: Record<string, string> = {
  requested: "Your GitHub org owner needs to approve the install. Come back once they have.",
  missing: "GitHub did not send an installation id. Try installing again.",
  taken: "That installation is already linked to another Shiplog account.",
  unverified: "Your GitHub account cannot access that installation. Sign in to GitHub as someone who installed it.",
  error: "We could not reach GitHub to link the installation. Try again.",
};

function StepTitle({ n, done, children }: { n: number; done: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-3">
      <span
        className={cx(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-caption-1-semibold",
          done ? "bg-status-lime-background text-status-lime-text" : "bg-background-tertiary-default text-text-secondary",
        )}
      >
        {done ? <RiCheckLine className="size-4" aria-label="Done" /> : n}
      </span>
      {children}
    </span>
  );
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ github?: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/api/auth/buffer/start");

  const [[user], installs, userProjects, voice] = await Promise.all([
    db.select({ email: users.email, channels: users.channels }).from(users).where(eq(users.id, userId)).limit(1),
    db.select().from(githubInstallations).where(and(eq(githubInstallations.userId, userId), isNotNull(githubInstallations.verifiedAt))),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.userId, userId)),
    db
      .select({ id: voiceProfiles.id })
      .from(voiceProfiles)
      .where(and(eq(voiceProfiles.userId, userId), isNull(voiceProfiles.projectId)))
      .limit(1),
  ]);
  if (!user) redirect("/api/auth/buffer/start");

  const notice = GITHUB_NOTICE[(await searchParams).github ?? ""];
  const installUrl = `https://github.com/apps/${process.env.GITHUB_APP_SLUG ?? "shiplog"}/installations/new`;
  const channels = user.channels ?? [];
  const hasProject = userProjects.length > 0;
  const hasVoice = voice.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title="Set up Shiplog" description="Three steps, about five minutes. Shiplog only drafts; nothing posts without you." />

      <Section
        title={<StepTitle n={1} done>Buffer connected</StepTitle>}
        description={user.email ? <>Signed in as <bdi>{user.email}</bdi></> : "Signed in with Buffer"}
      >
        {channels.length ? (
          <ul className="flex flex-wrap gap-2">
            {channels.map((c) => (
              <li key={c.id}>
                <Chip variant="caption" color={c.isDisconnected ? "rose" : "soft"}>
                  {c.displayName ?? c.name} · {c.service}
                  {c.isDisconnected && " (disconnected)"}
                </Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-2-regular text-text-tertiary">No channels yet. Connect LinkedIn, X or Threads in Buffer, then sign in again.</p>
        )}
      </Section>

      <Section
        title={<StepTitle n={2} done={hasProject}>Install the GitHub App</StepTitle>}
        description="Pick the repos Shiplog may read. It never writes to them."
        aside={
          <ButtonLink href={installUrl} variant={installs.length ? "secondary" : "primary"} leadingIcon={RiGithubLine}>
            {installs.length ? "Add repos" : "Install"}
          </ButtonLink>
        }
      >
        {notice && <p className="rounded-xl bg-status-orange-background p-3 text-body-2-regular text-status-orange-text">{notice}</p>}
        {installs.length > 0 && (
          <ul className="flex flex-col divide-y divide-separator-border rounded-2xl border border-border-button-default">
            {installs.map((i) => (
              <li key={i.installationId} className="flex items-center justify-between gap-3 p-3">
                <span className="flex items-center gap-2 text-body-medium text-text-primary">
                  <RiGithubLine className="size-4 text-foreground-icon-tertiary" aria-hidden />
                  {i.accountLogin}
                  {i.suspended && <Chip variant="caption" color="rose">Suspended</Chip>}
                </span>
                {!i.suspended && (
                  <ButtonLink href={`/onboarding/project?installation=${i.installationId}`} size="small" variant="secondary" trailingIcon={RiArrowRightLine}>
                    Create a project
                  </ButtonLink>
                )}
              </li>
            ))}
          </ul>
        )}
        {hasProject && (
          <p className="text-body-2-regular text-text-secondary">
            Your projects:{" "}
            {userProjects.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                <Link className="text-text-primary underline underline-offset-2" href={`/projects/${p.id}`}>
                  {p.name}
                </Link>
              </span>
            ))}
          </p>
        )}
      </Section>

      <Section
        title={<StepTitle n={3} done={hasVoice}>Teach Shiplog your writing style</StepTitle>}
        description="Shiplog reads your recent posts through Buffer and learns how you write. If there aren't enough, paste a few or answer six questions."
        aside={
          <ButtonLink href="/onboarding/voice" variant={hasProject && !hasVoice ? "primary" : "secondary"} leadingIcon={RiQuillPenLine}>
            {hasVoice ? "Redo" : "Start"}
          </ButtonLink>
        }
      />

      {hasProject && hasVoice && (
        <div className="flex justify-end">
          <ButtonLink href="/inbox" trailingIcon={RiArrowRightLine}>
            Go to the inbox
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
