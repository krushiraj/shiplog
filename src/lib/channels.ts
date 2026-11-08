import type { CachedChannel } from "@/db/schema";
import type { ProjectConfig } from "@/lib/config";
import { DEFAULT_LIMIT, LIMITS } from "@/lib/gate";

const SERVICE_KEYS: Record<string, string> = {
  twitter: "x",
  x: "x",
  linkedin: "linkedin",
  threads: "threads",
  bluesky: "bluesky",
  mastodon: "mastodon",
  facebook: "facebook",
  instagram: "instagram",
  pinterest: "pinterest",
  tiktok: "tiktok",
  youtube: "youtube",
  googlebusiness: "googlebusiness",
  substack: "substack",
};

export type ChannelTarget = {
  channelId: string;
  key: string;
  service: string;
  register: string;
  limit: number;
  channel: CachedChannel | null;
};

export const channelKey = (service: string): string => SERVICE_KEYS[service.toLowerCase()] ?? service.toLowerCase();

export const registerFor = (key: string, config: ProjectConfig): string =>
  config.ai.register_map[key] ?? (charLimit(key) <= 500 ? "x-short" : "linkedin");

export const charLimit = (key: string): number => LIMITS[key] ?? DEFAULT_LIMIT;

/**
 * config.channels holds Buffer channel ids. An id missing from the cached Buffer channel list is
 * kept only when it is itself a channel key (demo projects configure e.g. ["linkedin", "x"]).
 */
export function resolveTargets(channelIds: string[], cached: CachedChannel[], config: ProjectConfig): ChannelTarget[] {
  return channelIds.flatMap((id) => {
    const channel = cached.find((c) => c.id === id) ?? null;
    const service = channel?.service ?? (id in LIMITS ? id : null);
    if (!service) return [];
    const key = channelKey(service);
    return [{ channelId: id, key, service, register: registerFor(key, config), limit: charLimit(key), channel }];
  });
}

/** Metadata Buffer requires for some services (docs/buffer-api.md §3.3). */
export function postMetadata(service: string): Record<string, unknown> | undefined {
  switch (service) {
    case "facebook":
      return { facebook: { type: "post" } };
    case "instagram":
      return { instagram: { type: "post", shouldShareToFeed: true } };
    case "googlebusiness":
      return { google: { type: "whats_new" } };
    default:
      return undefined;
  }
}
