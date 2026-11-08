import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPkce, randomState } from "@/lib/pkce";

const base64url = /^[A-Za-z0-9_-]+$/;

describe("createPkce", () => {
  it("returns a base64url verifier of valid length", async () => {
    const { verifier, method } = await createPkce();
    expect(verifier).toMatch(base64url);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(method).toBe("S256");
  });

  it("derives the challenge as base64url(sha256(verifier))", async () => {
    const { verifier, challenge } = await createPkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
});

describe("randomState", () => {
  it("returns unique base64url strings", () => {
    const states = new Set(Array.from({ length: 50 }, randomState));
    expect(states.size).toBe(50);
    for (const s of states) expect(s).toMatch(base64url);
  });
});
