import { PageHeader } from "@/components/shell/PageHeader";
import { SettingsView } from "@/components/SettingsView";
import { mockProjects } from "@/lib/mock";

export default function SettingsPage() {
  const project = mockProjects[0];
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Settings" description={`Project settings for ${project.name}. Export them as YAML any time.`} />
      <SettingsView project={project} repos={project.repos} />
    </div>
  );
}
