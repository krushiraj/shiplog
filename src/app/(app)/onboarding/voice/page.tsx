import { redirect } from "next/navigation";
import { VoiceBootstrap } from "@/components/onboarding/VoiceBootstrap";
import { PageHeader } from "@/components/shell/PageHeader";
import { getSessionUserId } from "@/lib/session";
import { INTERVIEW_QUESTIONS, PRESETS, type PresetName } from "@/lib/voice/extract";

const PRESET_LABELS: Record<PresetName, string> = {
  plain: "Plain builder",
  storyteller: "Storyteller",
  technical: "Technical",
};

export default async function VoicePage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/api/auth/buffer/start");

  const presets = (Object.keys(PRESETS) as PresetName[]).map((id) => ({ id, label: PRESET_LABELS[id], tone: PRESETS[id].linkedin.tone }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader
        title="Teach Shiplog your voice"
        description="Drafts should sound like you wrote them. Give Shiplog a few real posts, a few answers, or a starting point."
      />
      <VoiceBootstrap questions={[...INTERVIEW_QUESTIONS]} presets={presets} />
    </div>
  );
}
