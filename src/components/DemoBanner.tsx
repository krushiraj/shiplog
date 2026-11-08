import { RiFlaskLine } from "@remixicon/react";
import { ButtonLink } from "@/components/base/buttons/button";
import { isDemoUser } from "@/lib/demo";
import { getSessionUserId } from "@/lib/session";

export const DEMO_BANNER_TEXT = "You're in the demo — posts are simulated. Connect Buffer to post for real.";

/** True when the signed-in user is a /demo user. Server-only (reads the session cookie). */
export async function isDemoSession(): Promise<boolean> {
  const userId = await getSessionUserId();
  return userId ? isDemoUser(userId) : false;
}

/** Server component: renders nothing unless the current session is a demo. */
export async function DemoBanner() {
  if (!(await isDemoSession())) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-border-button-default bg-background-secondary-default px-4 py-2.5"
    >
      <p className="flex items-center gap-2 text-body-medium text-text-primary">
        <RiFlaskLine className="size-5 shrink-0 text-text-secondary" aria-hidden />
        {DEMO_BANNER_TEXT}
      </p>
      <ButtonLink href="/api/auth/buffer/start" size="small">
        Sign in with Buffer
      </ButtonLink>
    </div>
  );
}
