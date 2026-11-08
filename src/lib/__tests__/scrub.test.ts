import { describe, expect, it } from "vitest";
import { containsSecret, scrub } from "../scrub";

const R = "[REDACTED]";

describe("scrub", () => {
  it("redacts Anthropic keys", () => {
    const out = scrub(`key = sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz012345`);
    expect(out).not.toContain("sk-ant-api03");
    expect(out).toContain(R);
  });

  it("redacts OpenAI-style keys of 20+ chars", () => {
    const out = scrub(`client({ k: sk-proj-Ab12Cd34Ef56Gh78Ij90Kl })`);
    expect(out).not.toContain("Ab12Cd34Ef56Gh78Ij90Kl");
  });

  it("redacts GitHub tokens", () => {
    for (const t of [
      "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
      "gho_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
      "ghs_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
      "ghu_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
      "github_pat_" + "11ABCDEFG0123456789_abcdefghijklmnop",
    ]) {
      expect(scrub(`auth ${t} end`)).toBe(`auth ${R} end`);
    }
  });

  it("redacts Slack tokens", () => {
    expect(scrub("xoxb-1234567890-abcdefghijkl")).toBe(R);
  });

  it("redacts AWS access key ids", () => {
    expect(scrub("id AKIAIOSFODNN7EXAMPLE x")).toBe(`id ${R} x`);
  });

  it("redacts AWS secret access keys", () => {
    const out = scrub("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(out).toBe(`AWS_SECRET_ACCESS_KEY=${R}`);
    const lower = scrub("aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(lower).toBe(`aws_secret_access_key = ${R}`);
  });

  it("redacts generic assignments, keeping the name", () => {
    expect(scrub("DB_PASSWORD=hunter2hunter2")).toBe(`DB_PASSWORD=${R}`);
    expect(scrub("stripeApiKey: abcd1234efgh")).toBe(`stripeApiKey: ${R}`);
    expect(scrub(`const authToken = "abc123def456";`)).toBe(`const authToken = "${R}";`);
    expect(scrub(`{"client_secret": "zyx987wvu654"}`)).toBe(`{"client_secret": "${R}"}`);
    expect(scrub(`PRIVATE_KEY='xyzxyzxyz123'`)).toBe(`PRIVATE_KEY='${R}'`);
  });

  it("does not redact env lookups or type annotations", () => {
    const code = "const apiKey = process.env.API_KEY;\nfunction f(token: string) {}";
    expect(scrub(code)).toBe(code);
  });

  it("redacts PEM private key blocks", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEAx1y2z3",
      "abcDEF==",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    expect(scrub(`before\n${pem}\nafter`)).toBe(`before\n${R}\nafter`);
  });

  it("redacts URL credentials but keeps scheme and host", () => {
    expect(scrub("postgres://admin:s3cr3t@db.example.com:5432/app")).toBe(
      `postgres://${R}@db.example.com:5432/app`,
    );
  });

  it("redacts JWTs", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(scrub(`Bearer ${jwt}`)).toBe(`Bearer ${R}`);
  });

  it("redacts quoted high-entropy strings", () => {
    const out = scrub(`const k = "q8Zr4Lp2Xv9Nw1Ty7Bm3Hc6Jd0Fg5Ks8Ea2Wu4R";`);
    expect(out).toBe(`const k = "${R}";`);
  });

  describe("negatives", () => {
    it("leaves normal code alone", () => {
      const code = [
        `import { db } from "@/lib/db";`,
        `import Button from "../components/navigation/sidebar-item-list";`,
        "const total = a + b;",
        "if (user.password.length < 8) throw new Error('too short');",
      ].join("\n");
      expect(scrub(code)).toBe(code);
      expect(containsSecret(code)).toBe(false);
    });

    it("does not redact git SHAs", () => {
      const sha = "9fceb02d0ae598e95dc970b74767f19372d61af8";
      expect(scrub(`commit ${sha}`)).toBe(`commit ${sha}`);
      expect(scrub(`const sha = "${sha}";`)).toBe(`const sha = "${sha}";`);
    });

    it("does not redact short token values", () => {
      expect(scrub("token = 'abc'")).toBe("token = 'abc'");
    });
  });
});

describe("containsSecret", () => {
  it("detects secrets", () => {
    expect(containsSecret("ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8")).toBe(true);
    expect(containsSecret("hello world")).toBe(false);
  });
});
