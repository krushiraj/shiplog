const R = "[REDACTED]";

// UUIDs and git SHAs stay intact: they are hex(-ish), so their entropy never exceeds 4.0.
const TOKEN_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;
const AWS_SECRET = /(aws_secret_access_key["']?\s*[:=]\s*["']?)[A-Za-z0-9/+=]{40}/gi;
const ASSIGNMENT =
  /([\w.-]*(?:secret|token|password|passwd|api[_-]?key|private[_-]?key)[\w.-]*["']?\s*[:=]\s*)(["'`]?)([^\s"'`,;)]{8,})\2/gi;
const NOT_A_VALUE = /^(?:process\.env|import\.meta|env\.|\$\{|string|number|boolean|undefined|null|true|false)/;
const QUOTED = /(["'`])([A-Za-z0-9+/_=-]{32,})\1/g;

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function scrub(text: string): string {
  let out = text;
  for (const re of TOKEN_PATTERNS) out = out.replace(re, R);
  out = out.replace(URL_CREDENTIALS, `$1${R}@`);
  out = out.replace(AWS_SECRET, `$1${R}`);
  out = out.replace(ASSIGNMENT, (match, head: string, quote: string, value: string) =>
    value === R || NOT_A_VALUE.test(value) ? match : `${head}${quote}${R}${quote}`,
  );
  out = out.replace(QUOTED, (match, quote: string, value: string) =>
    /\d/.test(value) && /[A-Za-z]/.test(value) && entropy(value) > 4.0 ? `${quote}${R}${quote}` : match,
  );
  return out;
}

export function containsSecret(text: string): boolean {
  return scrub(text) !== text;
}
