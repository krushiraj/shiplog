import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  ProjectConfigSchema,
  parseDuration,
  repoReadsDiffs,
  resolveConfig,
  resolveConfigWithSources,
} from "@/lib/config";

describe("DEFAULTS", () => {
  it("is a valid config", () => {
    expect(ProjectConfigSchema.parse(DEFAULTS)).toEqual(DEFAULTS);
    expect(DEFAULTS.triggers.digest).toEqual({ every: "1d", at: "18:30", min_significance_sum: 3, max_age: "7d" });
    expect(DEFAULTS.ai.register_map.mastodon).toBe("x-short");
  });
});

describe("resolveConfig", () => {
  it("applies DEFAULTS <- user <- project <- repo precedence", () => {
    const config = resolveConfig(
      { timezone: "Asia/Kolkata", posting: { per_channel_daily_cap: 5 } },
      { posting: { per_channel_daily_cap: 3 }, triggers: { digest: { at: "09:00" } } },
      { posting: { per_channel_daily_cap: 1 } },
    );
    expect(config.timezone).toBe("Asia/Kolkata");
    expect(config.posting.per_channel_daily_cap).toBe(1);
    expect(config.triggers.digest.at).toBe("09:00");
    expect(config.triggers.digest.every).toBe("1d");
    expect(config.posting.link).toBe("repo");
  });

  it("merges records but replaces arrays", () => {
    const config = resolveConfig(
      { posting: { hashtags: ["#a", "#b"] }, ai: { register_map: { x: "x-long" } } },
      { posting: { hashtags: ["#c"] }, triggers: { instant: [{ tag: "v*" }] } },
    );
    expect(config.posting.hashtags).toEqual(["#c"]);
    expect(config.triggers.instant).toEqual([{ tag: "v*" }]);
    expect(config.ai.register_map).toEqual({ ...DEFAULTS.ai.register_map, x: "x-long" });
  });

  it("does not mutate DEFAULTS", () => {
    resolveConfig({ ai: { register_map: { x: "zzz" } } }, {});
    expect(DEFAULTS.ai.register_map.x).toBe("x-short");
  });

  it("accepts every instant rule shape and digest cadence", () => {
    const config = resolveConfig({}, {
      triggers: {
        digest: { every: "weekly:Fri" },
        instant: ["release.published", { tag: "v*" }, { "pr.merged": { label: "ship-it" } }, { significance: 3 }],
      },
    });
    expect(config.triggers.instant).toHaveLength(4);
    expect(config.triggers.digest.every).toBe("weekly:Fri");
  });

  it("rejects unknown timezones", () => {
    expect(() => resolveConfig({ timezone: "Mars/Base" }, {})).toThrow();
    expect(resolveConfig({ timezone: "America/New_York" }, {}).timezone).toBe("America/New_York");
  });

  it("treats null in a layer as inherit", () => {
    const { config, sources } = resolveConfigWithSources(
      { timezone: "Asia/Kolkata", posting: { hashtags: ["#a"] } },
      { timezone: null, posting: { hashtags: null, link: "none" } } as never,
      { review: null } as never,
    );
    expect(config.timezone).toBe("Asia/Kolkata");
    expect(config.posting.hashtags).toEqual(["#a"]);
    expect(config.posting.link).toBe("none");
    expect(config.review).toEqual(DEFAULTS.review);
    expect(sources["timezone"]).toBe("user");
    expect(sources["posting.hashtags"]).toBe("user");
  });

  it("rejects invalid values", () => {
    expect(() => resolveConfig({}, { review: { mode: "yolo" } } as never)).toThrow();
    expect(() => resolveConfig({}, { triggers: { digest: { at: "25:00" } } })).toThrow();
    expect(() => resolveConfig({}, { triggers: { digest: { every: "weekly:Fun" } } } as never)).toThrow();
    expect(() => resolveConfig({}, { review: { auto_requires: { voice_score: 1.5 } } })).toThrow();
    expect(() => resolveConfig({}, { triggers: { instant: [{ significance: 4 }] } } as never)).toThrow();
    expect(() => resolveConfig({}, { triggers: { digest: { max_age: "7 days" } } })).toThrow();
  });
});

describe("resolveConfigWithSources", () => {
  it("reports the source of every leaf", () => {
    const { config, sources } = resolveConfigWithSources(
      { timezone: "Asia/Kolkata", ai: { register_map: { x: "x-long" } } },
      { posting: { hashtags: ["#c"] } },
      { ai: { read_diffs: false } },
    );
    expect(config.ai.read_diffs).toBe(false);
    expect(sources["timezone"]).toBe("user");
    expect(sources["posting.hashtags"]).toBe("project");
    expect(sources["ai.read_diffs"]).toBe("repo");
    expect(sources["ai.register_map.x"]).toBe("user");
    expect(sources["ai.register_map.linkedin"]).toBe("default");
    expect(sources["triggers.digest.at"]).toBe("default");
    expect(sources["channels"]).toBe("default");
    expect(sources["posting"]).toBeUndefined();
    expect(Object.keys(sources)).toContain("review.auto_requires.voice_score");
  });
});

describe("repoReadsDiffs", () => {
  it("is false if any config disables diffs", () => {
    const on = resolveConfig({}, {});
    const off = resolveConfig({}, { ai: { read_diffs: false } });
    expect(repoReadsDiffs([on, on])).toBe(true);
    expect(repoReadsDiffs([on, off])).toBe(false);
    expect(repoReadsDiffs([])).toBe(true);
  });
});

describe("parseDuration", () => {
  it("parses d/h/m", () => {
    expect(parseDuration("7d")).toBe(7 * 24 * 3600_000);
    expect(parseDuration("48h")).toBe(48 * 3600_000);
    expect(parseDuration("30m")).toBe(30 * 60_000);
  });
  it("throws on garbage", () => {
    expect(() => parseDuration("7 days")).toThrow();
  });
});
