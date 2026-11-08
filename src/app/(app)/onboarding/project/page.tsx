import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ButtonLink } from "@/components/base/buttons/button";
import { ProjectForm } from "@/components/onboarding/ProjectForm";
import { Section } from "@/components/onboarding/Section";
import { PageHeader } from "@/components/shell/PageHeader";
import { DEFAULTS } from "@/lib/config";
import { listUserRepos } from "@/lib/projects";
import { getSessionUserId } from "@/lib/session";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ installation?: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/api/auth/buffer/start");

  const [[user], groups] = await Promise.all([
    db.select({ timezone: users.timezone, channels: users.channels }).from(users).where(eq(users.id, userId)).limit(1),
    listUserRepos(userId),
  ]);
  if (!user) redirect("/api/auth/buffer/start");

  const focus = Number((await searchParams).installation);
  const ordered = [...groups].sort((a, b) => Number(b.installationId === focus) - Number(a.installationId === focus));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title="Create a project" description="A project groups repos that tell one story, with its own channels and schedule." />
      {ordered.length === 0 ? (
        <Section title="No GitHub installation yet" description="Install the Shiplog GitHub App on at least one repo first.">
          <div>
            <ButtonLink href="/onboarding">Back to setup</ButtonLink>
          </div>
        </Section>
      ) : (
        <ProjectForm
          groups={ordered}
          channels={(user.channels ?? []).map((c) => ({
            id: c.id,
            label: c.displayName ?? c.name,
            service: c.service,
            disconnected: c.isDisconnected,
          }))}
          defaults={{ timezone: user.timezone, digestAt: DEFAULTS.triggers.digest.at }}
        />
      )}
    </div>
  );
}
