import { z } from "zod";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Day = (typeof DAYS)[number];

const Duration = z.string().regex(/^\d+[dhm]$/, "duration like 7d, 48h or 30m");
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time as HH:MM");
const DayEnum = z.enum(DAYS);

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const DigestEvery = z.union([
  z.enum(["1d", "2d", "off"]),
  z.templateLiteral(["weekly:", DayEnum]),
]);

const InstantRule = z.union([
  z.literal("release.published"),
  z.strictObject({ tag: z.string().min(1) }),
  z.strictObject({ "pr.merged": z.strictObject({ label: z.string().min(1) }) }),
  z.strictObject({ significance: z.number().int().min(0).max(3) }),
]);

export const ProjectConfigSchema = z.object({
  triggers: z.object({
    digest: z.object({
      every: DigestEvery,
      at: Time,
      min_significance_sum: z.number().min(0),
      max_age: Duration,
    }),
    instant: z.array(InstantRule),
  }),
  review: z.object({
    mode: z.enum(["inbox", "draft", "auto"]),
    auto_requires: z.object({
      voice_score: z.number().min(0).max(1),
      rules_passed: z.boolean(),
    }),
    expire_after: Duration,
  }),
  posting: z.object({
    when: z.union([z.enum(["now", "next_best_slot"]), Time]),
    per_channel_daily_cap: z.number().int().min(0),
    quiet_days: z.array(DayEnum),
    hashtags: z.array(z.string()),
    link: z.enum(["repo", "release", "none"]),
  }),
  ai: z.object({
    read_diffs: z.boolean(),
    quote_code: z.boolean(),
    register_map: z.record(z.string(), z.string()),
    daily_token_budget: z.number().int().min(0),
  }),
  channels: z.array(z.string()),
  timezone: z.string().min(1).refine(isValidTimeZone, "unknown IANA timezone"),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type DigestConfig = ProjectConfig["triggers"]["digest"];
export type InstantRule = z.infer<typeof InstantRule>;

type DeepPartial<T> = T extends unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
export type PartialConfig = DeepPartial<ProjectConfig>;

export const DEFAULTS: ProjectConfig = {
  triggers: {
    digest: { every: "1d", at: "18:30", min_significance_sum: 3, max_age: "7d" },
    instant: ["release.published", { significance: 3 }],
  },
  review: {
    mode: "inbox",
    auto_requires: { voice_score: 0.8, rules_passed: true },
    expire_after: "48h",
  },
  posting: {
    when: "next_best_slot",
    per_channel_daily_cap: 2,
    quiet_days: [],
    hashtags: ["#BuildInPublic"],
    link: "repo",
  },
  ai: {
    read_diffs: true,
    quote_code: false,
    register_map: { linkedin: "linkedin", x: "x-short", threads: "x-short", bluesky: "x-short", mastodon: "x-short" },
    daily_token_budget: 200000,
  },
  channels: [],
  timezone: "UTC",
};

export type ConfigSource = "default" | "user" | "project" | "repo";

type Plain = Record<string, unknown>;
const isPlainObject = (v: unknown): v is Plain =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function merge(base: unknown, override: unknown): unknown {
  if (override === undefined || override === null) return base;
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Plain = { ...base };
    for (const [key, value] of Object.entries(override)) out[key] = merge(base[key], value);
    return out;
  }
  return structuredClone(override);
}

function lookup(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function collectLeaves(obj: Plain, prefix: string[] = []): string[][] {
  return Object.entries(obj).flatMap(([key, value]) =>
    isPlainObject(value) ? collectLeaves(value, [...prefix, key]) : [[...prefix, key]],
  );
}

export function resolveConfigWithSources(
  user: PartialConfig,
  project: PartialConfig,
  repo?: PartialConfig,
): { config: ProjectConfig; sources: Record<string, ConfigSource> } {
  const layers: [ConfigSource, unknown][] = [
    ["default", DEFAULTS],
    ["user", user],
    ["project", project],
    ["repo", repo ?? {}],
  ];
  const merged = layers.reduce<unknown>((acc, [, layer]) => merge(acc, layer), {});
  const config = ProjectConfigSchema.parse(merged);

  const sources: Record<string, ConfigSource> = {};
  for (const path of collectLeaves(config)) {
    const winner = layers.findLast(([, layer]) => lookup(layer, path) != null);
    sources[path.join(".")] = winner?.[0] ?? "default";
  }
  return { config, sources };
}

export function resolveConfig(user: PartialConfig, project: PartialConfig, repo?: PartialConfig): ProjectConfig {
  return resolveConfigWithSources(user, project, repo).config;
}

export function repoReadsDiffs(configs: ProjectConfig[]): boolean {
  return configs.every((c) => c.ai.read_diffs);
}

const UNIT_MS = { d: 86_400_000, h: 3_600_000, m: 60_000 } as const;

export function parseDuration(s: string): number {
  const match = /^(\d+)([dhm])$/.exec(s.trim());
  if (!match) throw new Error(`Invalid duration: ${s}`);
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}
