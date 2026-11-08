import { RiSettings4Line } from "@remixicon/react";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/shell/PageHeader";
import { SettingsView } from "@/components/SettingsView";
import { loadSettings, requireUserId } from "@/lib/views";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const userId = await requireUserId();
  const data = await loadSettings(userId, (await searchParams).project);
  if (!data) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <PageHeader title="Settings" />
        <EmptyState
          icon={RiSettings4Line}
          title="No project to configure"
          description="Settings belong to a project. Create one first."
          action={{ href: "/onboarding", label: "Set up a project" }}
        />
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Settings" description={`Project settings for ${data.project.name}. Export them as YAML any time.`} />
      <SettingsView key={data.project.id} project={data.project} repos={data.project.repos} config={data.config} availableChannels={data.availableChannels} />
    </div>
  );
}
