import { InboxView } from "@/components/InboxView";
import { PageHeader } from "@/components/shell/PageHeader";
import { mockDrafts } from "@/lib/mock";

export default function InboxPage() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Inbox"
        description="Drafts waiting for you. Nothing posts until you approve it."
      />
      <InboxView initialDrafts={mockDrafts} />
    </div>
  );
}
