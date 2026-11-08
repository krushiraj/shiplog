import { describe, expect, it } from "vitest";
import { LIMITS, shouldBackOff, windowsFor } from "@/lib/budget";

describe("windowsFor", () => {
  it("returns UTC window keys for 15m, 24h and 30d", () => {
    expect(windowsFor(new Date("2026-11-08T12:22:00Z"))).toEqual([
      "15m:2026-11-08T12:15",
      "24h:2026-11-08",
      "30d:2026-11",
    ]);
  });

  it("pads single-digit fields", () => {
    expect(windowsFor(new Date("2026-01-02T03:04:00Z"))).toEqual([
      "15m:2026-01-02T03:00",
      "24h:2026-01-02",
      "30d:2026-01",
    ]);
  });
});

describe("shouldBackOff", () => {
  const usage = (o: Partial<Record<keyof typeof LIMITS, number>>) => ({ "15m": 0, "24h": 0, "30d": 0, ...o });

  it("is false below 80% of the 15m limit", () => {
    expect(shouldBackOff(usage({ "15m": 79 }))).toBe(false);
  });

  it("is true at 80% of the 15m limit", () => {
    expect(shouldBackOff(usage({ "15m": 80 }))).toBe(true);
  });

  it("is true at 80% of the 24h limit", () => {
    expect(shouldBackOff(usage({ "24h": 200 }))).toBe(true);
  });

  it("respects a custom ratio", () => {
    expect(shouldBackOff(usage({ "30d": 1500 }), 0.5)).toBe(true);
    expect(shouldBackOff(usage({ "30d": 1499 }), 0.5)).toBe(false);
  });
});
