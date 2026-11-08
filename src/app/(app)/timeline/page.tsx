import { PageHeader } from "@/components/shell/PageHeader";
import { TimelineTable } from "@/components/TimelineTable";
import { mockPosts } from "@/lib/mock";

export default function TimelinePage() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Timeline" description="Everything posted or queued through Buffer, with the commits behind it." />
      <TimelineTable rows={mockPosts} />
    </div>
  );
}
