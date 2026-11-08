import { DemoBanner } from "@/components/DemoBanner";
import { AppShell } from "@/components/shell/AppSidebar";
import { getSessionUserId } from "@/lib/session";
import { inboxCount, loadAccount, loadProjects } from "@/lib/views";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // No redirect here: onboarding lives in this group too. Pages that need a user call requireUserId().
  const userId = await getSessionUserId();
  const [count, projects, account] = userId
    ? await Promise.all([inboxCount(userId), loadProjects(userId), loadAccount(userId)])
    : [0, [], { name: "Guest", email: "", initials: "?" }];

  return (
    <AppShell
      inboxCount={count}
      projects={projects.map((p) => ({ id: p.id, name: p.name, repoCount: p.repos.length, paused: p.paused }))}
      currentProjectId={projects[0]?.id ?? ""}
      account={account}
    >
      <DemoBanner />
      {children}
    </AppShell>
  );
}
