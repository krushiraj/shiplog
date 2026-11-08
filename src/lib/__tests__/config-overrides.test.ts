import { describe, expect, it } from "vitest";
import { DEFAULTS } from "@/lib/config";
import { applyConfigPatch, diffOverrides } from "@/lib/config-overrides";

describe("diffOverrides", () => {
  it("keeps only leaves that differ from the base", () => {
    const next = structuredClone(DEFAULTS);
    next.review.mode = "auto";
    next.posting.hashtags = ["#shiplog"];
    expect(diffOverrides(DEFAULTS, next)).toEqual({ review: { mode: "auto" }, posting: { hashtags: ["#shiplog"] } });
  });

  it("returns an empty object when nothing changed", () => {
    expect(diffOverrides(DEFAULTS, structuredClone(DEFAULTS))).toEqual({});
  });
});

describe("applyConfigPatch", () => {
  it("merges a partial patch over the effective config and stores only overrides", () => {
    const res = applyConfigPatch({ user: { timezone: "Asia/Kolkata" }, project: { review: { mode: "draft" } } }, {
      triggers: { digest: { at: "09:00" } },
      timezone: "Asia/Kolkata",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.overrides).toEqual({ review: { mode: "draft" }, triggers: { digest: { at: "09:00" } } });
    expect(res.config.triggers.digest.at).toBe("09:00");
  });

  it("rejects invalid values with issues", () => {
    const res = applyConfigPatch({ user: {}, project: {} }, { triggers: { digest: { at: "25:99" } } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues.join(" ")).toContain("triggers.digest.at");
  });

  it("drops a project override that is set back to the inherited value", () => {
    const res = applyConfigPatch({ user: {}, project: { review: { mode: "auto" } } }, { review: { mode: "inbox" } });
    expect(res.ok && res.overrides).toEqual({});
  });
});
