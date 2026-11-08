import { RiHistoryLine } from "@remixicon/react";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/shell/PageHeader";
import { TimelineTable } from "@/components/TimelineTable";
import { loadTimeline, requireUserId } from "@/lib/views";

export default async function TimelinePage() {
  const rows = await loadTimeline(await requireUserId());
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Timeline" description="Everything posted or queued through Buffer, with the commits behind it." />
      {rows.length ? (
        <TimelineTable rows={rows} />
      ) : (
        <EmptyState
          icon={RiHistoryLine}
          title="Nothing posted yet"
          description="Approve a draft in your inbox and it shows up here with its Buffer link and the commits behind it."
          action={{ href: "/inbox", label: "Open the inbox" }}
        />
      )}
    </div>
  );
}
