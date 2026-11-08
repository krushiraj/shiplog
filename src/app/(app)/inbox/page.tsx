import { RiInbox2Line } from "@remixicon/react";
import { EmptyState } from "@/components/EmptyState";
import { InboxView } from "@/components/InboxView";
import { PageHeader } from "@/components/shell/PageHeader";
import { loadInbox, loadProjects, requireUserId } from "@/lib/views";

export default async function InboxPage() {
  const userId = await requireUserId();
  const [drafts, projects] = await Promise.all([loadInbox(userId), loadProjects(userId)]);
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Inbox" description="Drafts waiting for you. Nothing posts until you approve it." />
      {drafts.length ? (
        <InboxView initialDrafts={drafts} />
      ) : projects.length ? (
        <EmptyState
          icon={RiInbox2Line}
          title="No drafts yet"
          description="Push some commits. Shiplog drops the next draft here when your digest is due or a release ships."
        />
      ) : (
        <EmptyState
          icon={RiInbox2Line}
          title="No drafts yet"
          description="Push some commits to a watched repo and Shiplog writes the post. Start by creating a project."
          action={{ href: "/onboarding", label: "Set up a project" }}
        />
      )}
    </div>
  );
}
