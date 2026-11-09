"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RiQuillPenLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";

/** Writes a draft from the changes no draft covers yet, then opens the Inbox. */
export function DraftNowButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function draft() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/draft`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't write the draft. Try again in a minute.");
      router.push("/inbox");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="primary" leadingIcon={RiQuillPenLine} onClick={draft} disabled={busy} aria-busy={busy}>
        {busy ? "Writing…" : "Draft now"}
      </Button>
      {error && (
        <p role="alert" className="max-w-xs text-right text-caption-1-medium text-text-error-primary">
          {error}
        </p>
      )}
    </div>
  );
}
