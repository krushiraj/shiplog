"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { stringify } from "yaml";
import {
  RiCodeLine,
  RiDownload2Line,
  RiEyeLine,
  RiLinkedinFill,
  RiShieldKeyholeLine,
  RiThreadsFill,
  RiTwitterXFill,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { SwitchCard } from "@/components/base/switch/switch-card";
import { toast } from "@/components/base/toast/toast";
import { sendJson } from "@/lib/client-api";
import type { ProjectConfig } from "@/lib/config";
import type { ChannelKey, ProjectView } from "@/lib/ui-types";

export type ProjectSettings = {
  project: string;
  channels: ChannelKey[];
  timezone: string;
  digestEvery: ProjectConfig["triggers"]["digest"]["every"];
  digestAt: string;
  reviewMode: "inbox" | "draft" | "auto";
  postingWhen: "now" | "next_best_slot" | "fixed";
  postingAt: string;
  readDiffs: boolean;
  quoteCode: boolean;
  hashtags: string;
};

function Card({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-border-button-default bg-background-primary-default p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-headline-semibold text-text-primary">{title}</h2>
        <p className="text-body-2-regular text-text-secondary">{description}</p>
      </div>
      {children}
    </section>
  );
}

const CHANNEL_META: { key: ChannelKey; label: string; icon: typeof RiLinkedinFill }[] = [
  { key: "linkedin", label: "LinkedIn", icon: RiLinkedinFill },
  { key: "x", label: "X", icon: RiTwitterXFill },
  { key: "threads", label: "Threads", icon: RiThreadsFill },
];

export type AvailableChannel = { id: string; key: ChannelKey; name: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function SettingsView({
  project,
  repos,
  config,
  availableChannels,
}: {
  project: ProjectView;
  repos: string[];
  config: ProjectConfig;
  availableChannels: AvailableChannel[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const fixedAt = config.posting.when !== "now" && config.posting.when !== "next_best_slot" ? config.posting.when : null;
  const [s, setS] = useState<ProjectSettings>({
    project: project.name,
    channels: project.channels,
    timezone: config.timezone,
    digestEvery: config.triggers.digest.every,
    digestAt: config.triggers.digest.at,
    reviewMode: config.review.mode,
    postingWhen: fixedAt ? "fixed" : (config.posting.when as "now" | "next_best_slot"),
    postingAt: fixedAt ?? "09:00",
    readDiffs: config.ai.read_diffs,
    quoteCode: config.ai.quote_code,
    hashtags: config.posting.hashtags.join(" "),
  });
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => setS((prev) => ({ ...prev, [k]: v }));

  /** Buffer channel ids for the chosen keys: keep ids already configured, else take the first channel of that kind. */
  const channelIds = () =>
    s.channels.flatMap((key) => {
      const ofKind = availableChannels.filter((c) => c.key === key);
      const kept = ofKind.filter((c) => config.channels.includes(c.id)).map((c) => c.id);
      return kept.length ? kept : ofKind.slice(0, 1).map((c) => c.id);
    });

  const save = async () => {
    if (!TIME.test(s.digestAt) || (s.postingWhen === "fixed" && !TIME.test(s.postingAt))) {
      toast.error("Times use 24-hour HH:MM, like 18:30");
      return;
    }
    setSaving(true);
    try {
      await sendJson(`/api/projects/${project.id}/config`, "PUT", {
        name: s.project,
        config: {
          timezone: s.timezone,
          channels: channelIds(),
          triggers: { digest: { every: s.digestEvery, at: s.digestAt } },
          review: { mode: s.reviewMode },
          posting: { when: s.postingWhen === "fixed" ? s.postingAt : s.postingWhen, hashtags: s.hashtags.split(/[\s,]+/).filter(Boolean) },
          ai: { read_diffs: s.readDiffs, quote_code: s.quoteCode },
        },
      });
      toast.success("Settings saved");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const yamlText = useMemo(
    () =>
      stringify({
        project: s.project,
        repos,
        channels: s.channels.map((c) => `${c}:me`),
        timezone: s.timezone,
        triggers: { digest: { every: s.digestEvery, at: s.digestAt } },
        review: { mode: s.reviewMode },
        posting: { when: s.postingWhen === "fixed" ? s.postingAt : s.postingWhen, hashtags: s.hashtags.split(/[\s,]+/).filter(Boolean) },
        ai: { read_diffs: s.readDiffs, quote_code: s.quoteCode },
      }),
    [s, repos],
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-5">
        <Card title="Project" description="The name shows up in your inbox and timeline.">
          <Input label="Name" value={s.project} onChange={(v) => set("project", v)} />
          <Input label="Timezone" value={s.timezone} onChange={(v) => set("timezone", v)} hint="Used for digests, slots and quiet days." />
        </Card>

        <Card title="Channels" description="Where approved posts go, through Buffer.">
          <div className="grid gap-2 sm:grid-cols-3">
            {CHANNEL_META.map(({ key, label, icon }) => (
              <SwitchCard
                key={key}
                title={label}
                description={availableChannels.some((c) => c.key === key) ? undefined : "Connect it in Buffer first"}
                isDisabled={!availableChannels.some((c) => c.key === key)}
                icon={icon}
                isSelected={s.channels.includes(key)}
                onChange={(on) => set("channels", on ? [...s.channels, key] : s.channels.filter((c) => c !== key))}
              />
            ))}
          </div>
          <Input label="Hashtags" value={s.hashtags} onChange={(v) => set("hashtags", v)} />
        </Card>

        <Card title="Schedule and review" description="When Shiplog writes, and whether it waits for you.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Digest" selectedKey={s.digestEvery} onSelectionChange={(k) => set("digestEvery", k as ProjectSettings["digestEvery"])}>
              <SelectItem id="1d">Every day</SelectItem>
              <SelectItem id="2d">Every 2 days</SelectItem>
              <SelectItem id="weekly:Fri">Weekly on Friday</SelectItem>
              {s.digestEvery.startsWith("weekly:") && s.digestEvery !== "weekly:Fri" ? (
                <SelectItem id={s.digestEvery}>Weekly on {s.digestEvery.slice(7)}</SelectItem>
              ) : null}
              <SelectItem id="off">Off (releases only)</SelectItem>
            </Select>
            <Input label="Digest time" value={s.digestAt} onChange={(v) => set("digestAt", v)} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-body-medium text-text-primary">Review</span>
            <SegmentedControl
              aria-label="Review mode"
              selectedKeys={new Set([s.reviewMode])}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (next) set("reviewMode", next as ProjectSettings["reviewMode"]);
              }}
            >
              <SegmentedControlItem id="inbox">Inbox</SegmentedControlItem>
              <SegmentedControlItem id="draft">Buffer draft</SegmentedControlItem>
              <SegmentedControlItem id="auto">Auto</SegmentedControlItem>
            </SegmentedControl>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-body-medium text-text-primary">Post</span>
            <SegmentedControl
              aria-label="Posting time"
              selectedKeys={new Set([s.postingWhen])}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (next) set("postingWhen", next as ProjectSettings["postingWhen"]);
              }}
            >
              <SegmentedControlItem id="next_best_slot">Next best slot</SegmentedControlItem>
              <SegmentedControlItem id="now">Right away</SegmentedControlItem>
              <SegmentedControlItem id="fixed">Fixed time</SegmentedControlItem>
            </SegmentedControl>
            {s.postingWhen === "fixed" && <Input label="Post at" value={s.postingAt} onChange={(v) => set("postingAt", v)} hint="24-hour HH:MM in the project timezone." />}
          </div>
        </Card>

        <Card title="Privacy" description="What the model is allowed to see and say.">
          <SwitchCard
            title="Read diffs"
            description="Better posts. Secrets are scrubbed first."
            icon={RiEyeLine}
            isSelected={s.readDiffs}
            onChange={(v) => set("readDiffs", v)}
          />
          <SwitchCard
            title="Quote code in posts"
            description="Off: code is never quoted."
            icon={RiCodeLine}
            isSelected={s.quoteCode}
            onChange={(v) => set("quoteCode", v)}
          />
          <p className="flex items-center gap-1.5 text-caption-1-regular text-text-tertiary">
            <RiShieldKeyholeLine className="size-4" aria-hidden /> Buffer tokens are encrypted at rest.
          </p>
        </Card>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </div>

      <aside className="flex h-fit flex-col gap-3 rounded-3xl border border-border-button-default bg-background-secondary-default p-4 xl:sticky xl:top-8">
        <div className="flex items-center justify-between">
          <span className="font-code text-caption-1-medium text-text-secondary">shiplog.yml</span>
          <Button
            size="small"
            variant="secondary"
            leadingIcon={RiDownload2Line}
            onClick={() => {
              const url = URL.createObjectURL(new Blob([yamlText], { type: "text/yaml" }));
              const a = Object.assign(document.createElement("a"), { href: url, download: "shiplog.yml" });
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export
          </Button>
        </div>
        <pre className="font-code overflow-x-auto rounded-2xl bg-background-primary-default p-4 text-caption-1-regular leading-5 text-text-primary">{yamlText}</pre>
      </aside>
    </div>
  );
}
