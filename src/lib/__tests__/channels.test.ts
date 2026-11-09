import { describe, it, expect } from "vitest";
import type { CachedChannel } from "@/db/schema";
import { channelLimit, hasXSubscription, X_LONG_POST_LIMIT } from "@/lib/channels";
import { gate } from "@/lib/gate";

const x = (subscriptionType?: string | null): CachedChannel => ({
  id: "c1", name: "kr", displayName: null, service: "twitter", avatar: "", isDisconnected: false, isLocked: false,
  isQueuePaused: false, timezone: null, type: null, descriptor: null,
  ...(subscriptionType === undefined ? {} : { metadata: { subscriptionType } }),
});

describe("channelLimit", () => {
  it("raises X to long posts for any paid subscription", () => {
    for (const tier of ["Premium", "PremiumPlus", "Basic", "premium"]) expect(channelLimit("x", x(tier))).toBe(X_LONG_POST_LIMIT);
  });

  it("keeps 280 without a subscription or when Buffer doesn't say", () => {
    for (const tier of [undefined, null, "None", "", "free"]) {
      expect(hasXSubscription(x(tier))).toBe(false);
      expect(channelLimit("x", x(tier))).toBe(280);
    }
    expect(channelLimit("x", null)).toBe(280);
  });

  it("leaves other services alone", () => {
    expect(channelLimit("linkedin", x("Premium"))).toBe(3000);
  });
});

describe("gate limit override", () => {
  const long = "Shipped a scheduler fix. ".repeat(20).trim();

  it("flags a long X post at the default limit and passes it at the Premium limit", () => {
    expect(gate(long, { channel: "x", rules: [], hashtags: [] }).violations.some((v) => v.kind === "length")).toBe(true);
    expect(gate(long, { channel: "x", rules: [], hashtags: [], limit: X_LONG_POST_LIMIT }).violations.some((v) => v.kind === "length")).toBe(false);
  });
});
