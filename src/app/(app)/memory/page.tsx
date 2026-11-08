import { RiBrainLine } from "@remixicon/react";
import { EmptyState } from "@/components/EmptyState";
import { MemoryView } from "@/components/MemoryView";
import { PageHeader } from "@/components/shell/PageHeader";
import { loadMemory, requireUserId } from "@/lib/views";

export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const userId = await requireUserId();
  const memory = await loadMemory(userId, (await searchParams).project);
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Memory"
        description={
          memory.project
            ? `What Shiplog knows about ${memory.project.name} and how you write. Everything here is editable.`
            : "What Shiplog knows about your projects and how you write."
        }
      />
      {memory.project ? (
        <MemoryView
          key={memory.project.id}
          projectId={memory.project.id}
          projects={memory.projects}
          brief={memory.brief}
          cards={memory.cards}
          rules={memory.rules}
          profiles={memory.profiles}
        />
      ) : (
        <EmptyState
          icon={RiBrainLine}
          title="No memory yet"
          description="Create a project and Shiplog builds a brief from your repo, then learns your voice from every edit."
          action={{ href: "/onboarding", label: "Set up a project" }}
        />
      )}
    </div>
  );
}
