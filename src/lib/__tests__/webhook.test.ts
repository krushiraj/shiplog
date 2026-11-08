import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { handleWebhook, type WebhookDeps, type InstallationStore } from "@/lib/github/webhook";
import { verifyWebhook } from "@/lib/github/app";
import { storeEvents } from "@/lib/events";
import type { NormalisedEvent } from "@/lib/github/normalise";
import push from "../../../fixtures/github/push.json";

const SECRET = "test-secret";
process.env.GITHUB_WEBHOOK_SECRET = SECRET;

const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

function request(event: string, payload: unknown, opts: { signature?: string; delivery?: string } = {}) {
  const body = JSON.stringify(payload);
  return new Request("http://x/api/github/webhook", {
    method: "POST",
    body,
    headers: {
      "x-github-event": event,
      "x-github-delivery": opts.delivery ?? "d1",
      "x-hub-signature-256": opts.signature ?? sign(body),
    },
  });
}

function fakeInstallations(): InstallationStore & { log: unknown[][] } {
  const log: unknown[][] = [];
  return {
    log,
    upsert: async (...a) => void log.push(["upsert", ...a]),
    setSuspended: async (...a) => void log.push(["suspended", ...a]),
    remove: async (...a) => void log.push(["remove", ...a]),
    pauseRepos: async (...a) => void log.push(["pause", ...a]),
  };
}

function setup() {
  const seen = new Set<string>();
  const stored: NormalisedEvent[] = [];
  const store = vi.fn(async (_d: string, evs: NormalisedEvent[]) => {
    const ids: string[] = [];
    for (const e of evs) {
      const key = `${e.repoFullName}|${e.kind}|${e.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stored.push(e);
      ids.push(`id-${stored.length}`);
    }
    return ids;
  });
  const tasks: (() => Promise<unknown>)[] = [];
  const analyse = vi.fn(async (_ids: string[]) => []);
  const installations = fakeInstallations();
  const deps: WebhookDeps = {
    verify: verifyWebhook,
    storeEvents: store,
    installations,
    analyse,
    schedule: (fn) => void tasks.push(fn),
  };
  return { deps, stored, store, tasks, analyse, installations };
}

describe("handleWebhook", () => {
  it("rejects a bad signature with 401 and stores nothing", async () => {
    const { deps, store } = setup();
    const res = await handleWebhook(request("push", push, { signature: "sha256=deadbeef" }), deps);
    expect(res.status).toBe(401);
    expect(store).not.toHaveBeenCalled();
  });

  it("rejects a missing signature", async () => {
    const { deps } = setup();
    const req = new Request("http://x", { method: "POST", body: "{}", headers: { "x-github-event": "push" } });
    expect((await handleWebhook(req, deps)).status).toBe(401);
  });

  it("stores normalised events with the installation id, schedules analysis, and dedupes redeliveries", async () => {
    const { deps, stored, tasks, analyse } = setup();
    const payload = { ...push, installation: { id: 42 } };
    const res1 = await handleWebhook(request("push", payload, { delivery: "d1" }), deps);
    expect(res1.status).toBe(200);
    const count = stored.length;
    expect(count).toBeGreaterThan(0);
    expect(stored.every((e) => e.payload.installationId === 42)).toBe(true);
    expect(analyse).not.toHaveBeenCalled(); // runs after the response
    expect(tasks).toHaveLength(1);
    await tasks[0]();
    expect(analyse).toHaveBeenCalledWith(stored.map((_, i) => `id-${i + 1}`));

    const res2 = await handleWebhook(request("push", payload, { delivery: "d2" }), deps);
    expect(res2.status).toBe(200);
    expect(stored).toHaveLength(count);
    expect(tasks).toHaveLength(1);
  });

  it("handles installation lifecycle events", async () => {
    const { deps, installations } = setup();
    const inst = { id: 7, account: { login: "octo" } };
    await handleWebhook(request("installation", { action: "created", installation: inst }), deps);
    await handleWebhook(request("installation", { action: "suspend", installation: inst }), deps);
    await handleWebhook(request("installation", { action: "deleted", installation: inst }), deps);
    expect(installations.log).toEqual([
      ["upsert", 7, "octo"],
      ["suspended", 7, true],
      ["pause", 7, null],
      ["remove", 7],
    ]);
  });

  it("pauses projects when repos are removed from the installation", async () => {
    const { deps, installations } = setup();
    await handleWebhook(
      request("installation_repositories", {
        action: "removed",
        installation: { id: 7, account: { login: "octo" } },
        repositories_removed: [{ full_name: "octo/a" }],
      }),
      deps,
    );
    expect(installations.log).toContainEqual(["pause", 7, ["octo/a"]]);
  });
});

describe("storeEvents", () => {
  it("inserts with on-conflict-do-nothing on (repo, kind, ref) and returns inserted ids", async () => {
    const calls: Record<string, unknown> = {};
    const chain = {
      values: (v: unknown) => ((calls.values = v), chain),
      onConflictDoNothing: (o: unknown) => ((calls.conflict = o), chain),
      returning: async () => [{ id: "a" }],
    };
    const fakeDb = { insert: () => chain } as never;
    const ev: NormalisedEvent = { repoFullName: "o/r", kind: "commit", ref: "abc", occurredAt: new Date(), payload: {} };
    expect(await storeEvents("d1", [ev], fakeDb)).toEqual(["a"]);
    expect(calls.values).toEqual([{ deliveryId: "d1", ...ev }]);
    expect((calls.conflict as { target: unknown[] }).target).toHaveLength(3);
    expect(await storeEvents("d1", [], fakeDb)).toEqual([]);
  });
});
