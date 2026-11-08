import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";

const key = randomBytes(32).toString("base64");

describe("crypto", () => {
  it("round-trips plaintext", () => {
    expect(decrypt(encrypt("secret token", key), key)).toBe("secret token");
  });

  it("produces different blobs for the same plaintext", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("throws on tampered ciphertext", () => {
    const [iv, tag, ct] = encrypt("secret token", key).split(".");
    const bytes = Buffer.from(ct, "base64");
    bytes[0] ^= 1;
    expect(() => decrypt([iv, tag, bytes.toString("base64")].join("."), key)).toThrow();
  });

  it("throws a clear error when the key is missing", () => {
    expect(() => encrypt("x", undefined)).toThrow(/TOKEN_ENC_KEY/);
  });

  it("throws a clear error when the key is not 32 bytes", () => {
    expect(() => encrypt("x", randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("uses TOKEN_ENC_KEY by default", () => {
    const prev = process.env.TOKEN_ENC_KEY;
    process.env.TOKEN_ENC_KEY = key;
    try {
      expect(decrypt(encrypt("env"))).toBe("env");
    } finally {
      process.env.TOKEN_ENC_KEY = prev;
    }
  });
});
