import { AppShell } from "@/components/shell/AppSidebar";
import { inboxCount, mockProjects, mockUser } from "@/lib/mock";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      inboxCount={inboxCount}
      projects={mockProjects.map((p) => ({ id: p.id, name: p.name, repoCount: p.repos.length, paused: p.paused }))}
      currentProjectId={mockProjects[0].id}
      account={{ name: mockUser.name, email: mockUser.email, initials: mockUser.initials }}
    >
      {children}
    </AppShell>
  );
}
