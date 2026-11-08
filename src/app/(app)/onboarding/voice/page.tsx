import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { VoiceBootstrap } from "@/components/onboarding/VoiceBootstrap";
import { PageHeader } from "@/components/shell/PageHeader";
import { getSessionUserId } from "@/lib/session";
import { INTERVIEW_QUESTIONS, PRESETS, type PresetName } from "@/lib/voice/extract";

const PRESET_LABELS: Record<PresetName, string> = {
  plain: "Plain builder",
  storyteller: "Storyteller",
  technical: "Technical",
};

const SERVICE_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  twitter: "X",
  threads: "Threads",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  instagram: "Instagram",
};

export default async function VoicePage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/api/auth/buffer/start");

  const [user] = await db.select({ channels: users.channels }).from(users).where(eq(users.id, userId)).limit(1);
  const sources = [...new Set((user?.channels ?? []).map((c) => SERVICE_LABELS[c.service]).filter(Boolean))];
  const presets = (Object.keys(PRESETS) as PresetName[]).map((id) => ({ id, label: PRESET_LABELS[id], tone: PRESETS[id].linkedin.tone }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader
        title="Teach Shiplog your writing style"
        description="Drafts should read like you wrote them. Shiplog learns your writing voice from the posts you've already sent through Buffer."
      />
      <VoiceBootstrap questions={[...INTERVIEW_QUESTIONS]} presets={presets} sources={sources} />
    </div>
  );
}
