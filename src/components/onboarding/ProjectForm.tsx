"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RiGithubLine, RiLockLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { Section } from "@/components/onboarding/Section";
import type { RepoGroup } from "@/lib/projects";

type ChannelOption = { id: string; label: string; service: string; disconnected: boolean };
type DigestEvery = "1d" | "2d" | "weekly:Fri" | "off";
type ReviewMode = "inbox" | "draft" | "auto";

const repoKey = (installationId: number, fullName: string) => `${installationId}:${fullName}`;
const suggestName = (fullName: string) =>
  (fullName.split("/")[1] ?? fullName).replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

export function ProjectForm({
  groups,
  channels,
  defaults,
}: {
  groups: RepoGroup[];
  channels: ChannelOption[];
  defaults: { timezone: string; digestAt: string };
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [chosenChannels, setChosenChannels] = useState(() => channels.filter((c) => !c.disconnected).map((c) => c.id));
  const [timezone, setTimezone] = useState(defaults.timezone);
  const [digestEvery, setDigestEvery] = useState<DigestEvery>("1d");
  const [digestAt, setDigestAt] = useState(defaults.digestAt);
  const [reviewMode, setReviewMode] = useState<ReviewMode>("inbox");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleRepo = (key: string, on: boolean) => {
    const next = on ? [...selected, key] : selected.filter((k) => k !== key);
    setSelected(next);
    if (!nameTouched) {
      const first = next[0];
      setName(first ? suggestName(first.slice(first.indexOf(":") + 1)) : "");
    }
  };

  async function submit() {
    setSubmitting(true);
    setError(null);
    const repos = selected.map((k) => {
      const i = k.indexOf(":");
      return { installationId: Number(k.slice(0, i)), fullName: k.slice(i + 1) };
    });
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, repos, channels: chosenChannels, timezone, digestEvery, digestAt, reviewMode }),
      });
      const body = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (!res.ok || !body.redirect) throw new Error(body.error ?? "Could not create the project");
      router.push(body.redirect);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Repos" description="Pick one or more. Shiplog reads commits, PRs and releases from these.">
        {groups.map((g) => (
          <div key={g.installationId} className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-caption-1-semibold text-text-tertiary">
              <RiGithubLine className="size-4 text-foreground-icon-tertiary" aria-hidden />
              {g.accountLogin}
            </span>
            {g.error && <p className="text-body-2-regular text-text-error-primary">{g.error}</p>}
            {!g.error && g.repos.length === 0 && <p className="text-body-2-regular text-text-tertiary">No repos shared with Shiplog on this account.</p>}
            <ul className="grid gap-2 sm:grid-cols-2">
              {g.repos.map((r) => {
                const key = repoKey(g.installationId, r.fullName);
                return (
                  <li key={key} className="rounded-xl border border-border-button-default p-3">
                    <Checkbox isSelected={selected.includes(key)} onChange={(on) => toggleRepo(key, on)}>
                      <span className="font-code flex items-center gap-1.5 text-caption-1-medium">
                        {r.fullName}
                        {r.private && <RiLockLine className="size-3.5 text-foreground-icon-tertiary" aria-label="Private" />}
                      </span>
                    </Checkbox>
                    {r.description && <p className="mt-1 ps-7 text-caption-1-regular text-text-tertiary line-clamp-2">{r.description}</p>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Section>

      <Section title="Project" description="The name shows up in your inbox and timeline.">
        <Input
          label="Name"
          value={name}
          onChange={(v) => {
            setName(v);
            setNameTouched(true);
          }}
          placeholder="Pick a repo to get a suggestion"
        />
      </Section>

      <Section title="Channels" description="Where approved posts go, through Buffer.">
        {channels.length === 0 ? (
          <p className="text-body-2-regular text-text-tertiary">No Buffer channels found. You can add them later in settings.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {channels.map((c) => (
              <li key={c.id}>
                <Checkbox
                  isDisabled={c.disconnected}
                  isSelected={chosenChannels.includes(c.id)}
                  onChange={(on) => setChosenChannels((prev) => (on ? [...prev, c.id] : prev.filter((id) => id !== c.id)))}
                >
                  {c.label} · {c.service}
                  {c.disconnected && <span className="text-text-tertiary"> (reconnect in Buffer)</span>}
                </Checkbox>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Schedule and review" description="When Shiplog writes, and whether it waits for you.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Timezone" value={timezone} onChange={setTimezone} hint="IANA name, e.g. Asia/Kolkata" />
          <Select label="Digest" selectedKey={digestEvery} onSelectionChange={(k) => setDigestEvery(k as DigestEvery)}>
            <SelectItem id="1d">Every day</SelectItem>
            <SelectItem id="2d">Every 2 days</SelectItem>
            <SelectItem id="weekly:Fri">Weekly on Friday</SelectItem>
            <SelectItem id="off">Off (releases only)</SelectItem>
          </Select>
          <Input label="Digest time" value={digestAt} onChange={setDigestAt} hint="24h, HH:MM" isDisabled={digestEvery === "off"} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-body-medium text-text-primary">Review</span>
          <SegmentedControl
            aria-label="Review mode"
            selectedKeys={new Set([reviewMode])}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next) setReviewMode(next as ReviewMode);
            }}
          >
            <SegmentedControlItem id="inbox">Inbox</SegmentedControlItem>
            <SegmentedControlItem id="draft">Buffer draft</SegmentedControlItem>
            <SegmentedControlItem id="auto">Auto</SegmentedControlItem>
          </SegmentedControl>
          <p className="text-caption-1-regular text-text-tertiary">
            {reviewMode === "inbox" && "Drafts wait in your inbox until you approve them."}
            {reviewMode === "draft" && "Drafts go to Buffer as drafts; you publish from Buffer."}
            {reviewMode === "auto" && "Posts that pass the voice and rule checks go straight to your Buffer queue."}
          </p>
        </div>
      </Section>

      {error && <p className="text-body-2-regular text-text-error-primary" role="alert">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={submit} disabled={submitting || selected.length === 0 || !name.trim()}>
          {submitting ? "Creating…" : "Create project"}
        </Button>
      </div>
    </div>
  );
}
