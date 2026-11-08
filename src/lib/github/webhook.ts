import { and, eq, inArray } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db";
import { githubInstallations, projectRepos, projects } from "@/db/schema";
import { normalise, type NormalisedEvent } from "./normalise";

export type InstallationStore = {
  upsert(installationId: number, accountLogin: string): Promise<void>;
  setSuspended(installationId: number, suspended: boolean): Promise<void>;
  remove(installationId: number): Promise<void>;
  // null pauses every Project that uses the installation.
  pauseRepos(installationId: number, repoFullNames: string[] | null): Promise<void>;
};

export type WebhookDeps = {
  verify(body: string, signature: string | null): Promise<boolean>;
  storeEvents(deliveryId: string, evs: NormalisedEvent[]): Promise<string[]>;
  installations: InstallationStore;
  analyse(ids: string[]): Promise<unknown>;
  schedule(fn: () => Promise<unknown>): void;
};

export function drizzleInstallationStore(database: Db = defaultDb): InstallationStore {
  return {
    async upsert(installationId, accountLogin) {
      await database
        .insert(githubInstallations)
        .values({ installationId, accountLogin })
        .onConflictDoUpdate({ target: githubInstallations.installationId, set: { accountLogin, suspended: false } });
    },
    async setSuspended(installationId, suspended) {
      await database.update(githubInstallations).set({ suspended }).where(eq(githubInstallations.installationId, installationId));
    },
    async remove(installationId) {
      await database.delete(githubInstallations).where(eq(githubInstallations.installationId, installationId));
    },
    async pauseRepos(installationId, repoFullNames) {
      if (repoFullNames?.length === 0) return;
      const repoFilter = repoFullNames ? inArray(projectRepos.repoFullName, repoFullNames) : undefined;
      const affected = database
        .select({ id: projectRepos.projectId })
        .from(projectRepos)
        .where(and(eq(projectRepos.installationId, installationId), repoFilter));
      await database.update(projects).set({ paused: true }).where(inArray(projects.id, affected));
    },
  };
}

type InstallationPayload = {
  action?: string;
  installation?: { id: number; account?: { login?: string } | null };
  repositories_removed?: { full_name: string }[];
};

async function handleInstallation(event: string, p: InstallationPayload, store: InstallationStore) {
  const inst = p.installation;
  if (!inst) return;
  const login = inst.account?.login ?? "unknown";
  if (event === "installation_repositories") {
    if (p.action === "removed") await store.pauseRepos(inst.id, (p.repositories_removed ?? []).map((r) => r.full_name));
    return;
  }
  switch (p.action) {
    case "created":
    case "new_permissions_accepted":
      return store.upsert(inst.id, login);
    case "suspend":
      return store.setSuspended(inst.id, true);
    case "unsuspend":
      return store.setSuspended(inst.id, false);
    case "deleted":
      await store.pauseRepos(inst.id, null);
      return store.remove(inst.id);
  }
}

export async function handleWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const body = await req.text();
  if (!(await deps.verify(body, req.headers.get("x-hub-signature-256")))) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event") ?? "";
  const deliveryId = req.headers.get("x-github-delivery") ?? "";
  let payload: Record<string, unknown> & InstallationPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (event === "installation" || event === "installation_repositories") {
    await handleInstallation(event, payload, deps.installations);
    return Response.json({ ok: true });
  }

  const installationId = payload.installation?.id;
  const evs = normalise(event, payload).map((e) => ({ ...e, payload: { ...e.payload, installationId } }));
  const ids = await deps.storeEvents(deliveryId, evs);
  if (ids.length > 0) deps.schedule(() => deps.analyse(ids));
  return Response.json({ ok: true, stored: ids.length });
}
