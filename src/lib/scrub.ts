const R = "[REDACTED]";

// Formats that are secrets wherever they appear. UUIDs and git SHAs stay intact elsewhere:
// they are hex(-ish), so their entropy never exceeds 4.0.
const HARD_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----|$)/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]+/g,
  /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9_/-]+/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /\bwhsec_[A-Za-z0-9]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[\w-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36}/g,
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\bxox[a-z]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
];

// Greedy password so the match runs to the last "@" before the host (passwords may contain "@").
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@:]*:[^\s/?#]*@/gi;
const AWS_SECRET = /(aws_secret_access_key["']?\s*[:=]\s*["']?)[A-Za-z0-9/+=]{40}/gi;
const NAME =
  "[\\w.-]*(?:secret|token|passw(?:or)?d|pwd|auth(?!or)|credential|access[_-]?key|api[_-]?key|private[_-]?key|(?:\\b|[_.-])keys?(?![a-z0-9]))[\\w.-]*";
const ASSIGNMENT = new RegExp(
  `(${NAME}["'\`]?\\s*[:=]\\s*)(?:(["'\`])([^"'\`\\n]{8,})\\2|([^\\s"'\`,;)]{8,}))`,
  "gi",
);
const PLACEHOLDER =
  /^(?:string|number|boolean|undefined|null|true|false|none|nil)$|^(?:process\.env|import\.meta\.env|env)(?:[.[]|$)|^\$\{/i;
const CALL = /^[A-Za-z_$][\w$.]*\(/;
const IDENTIFIER = /^[A-Za-z_$][\w$.]*$/;
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

// Bare function calls and digit-free identifiers are expressions, not literal secrets.
function isNotASecret(value: string, quoted: boolean): boolean {
  if (value === R || PLACEHOLDER.test(value)) return true;
  return !quoted && (CALL.test(value) || (IDENTIFIER.test(value) && !/\d/.test(value)));
}

export function scrub(text: string): string {
  let out = text;
  for (const re of HARD_PATTERNS) out = out.replace(re, R);
  out = out.replace(URL_CREDENTIALS, `$1${R}@`);
  out = out.replace(AWS_SECRET, `$1${R}`);
  out = out.replace(
    ASSIGNMENT,
    (match, head: string, quote: string | undefined, quotedValue: string | undefined, bare: string | undefined) => {
      const value = quotedValue ?? bare ?? "";
      if (isNotASecret(value, quote !== undefined)) return match;
      return quote ? `${head}${quote}${R}${quote}` : `${head}${R}`;
    },
  );
  out = out.replace(QUOTED, (match, quote: string, value: string) =>
    /\d/.test(value) && /[A-Za-z]/.test(value) && entropy(value) > 4.0 ? `${quote}${R}${quote}` : match,
  );
  return out;
}

export function containsSecret(text: string): boolean {
  return scrub(text) !== text;
}

/** Only unambiguous secret formats: provider tokens, private keys, webhooks and URL credentials. */
export function containsHardSecret(text: string): boolean {
  return [...HARD_PATTERNS, URL_CREDENTIALS].some((re) => text.search(re) !== -1);
}
