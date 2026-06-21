// Pre-publish secret/PHI scanner. Runs BEFORE anything leaves the machine.
// `blocked` -> hard refuse to publish; `warned` -> prompt the user. Ports the spirit of
// A pre-publish PHI/secret scan that simply-html must not silently drop.

export interface ScanHit {
  pattern: string;
  sample: string;
  line: number;
}
export interface ScanResult {
  blocked: ScanHit[];
  warned: ScanHit[];
}

interface Rule {
  name: string;
  re: RegExp;
  level: "block" | "warn";
}

const RULES: Rule[] = [
  // Secrets -> hard block.
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/g, level: "block" },
  { name: "AWS secret access key", re: /\baws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+]{40}\b/gi, level: "block" },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g, level: "block" },
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, level: "block" },
  { name: "OpenAI API key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, level: "block" },
  { name: "Stripe secret key", re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g, level: "block" },
  { name: "GitHub token", re: /\bgh[posru]_[A-Za-z0-9]{36,}\b/g, level: "block" },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, level: "block" },
  { name: "Bearer token", re: /\bbearer\s+[A-Za-z0-9._-]{24,}\b/gi, level: "block" },
  { name: "Generic secret assignment", re: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[=:]\s*['"][^'"\s]{10,}['"]/gi, level: "warn" },
  // PHI -> warn (a human decides; simply-html is explicitly not-for-PHI).
  { name: "US SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g, level: "warn" },
  { name: "MRN-like", re: /\bMRN[:#\s]*\d{5,}\b/gi, level: "warn" },
  { name: "Date of birth", re: /\b(?:DOB|date of birth)\b[:\s]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/gi, level: "warn" },
];

function redact(s: string): string {
  if (s.length <= 8) return s[0] + "***";
  return s.slice(0, 4) + "…" + s.slice(-2);
}

export function scan(text: string): ScanResult {
  const blocked: ScanHit[] = [];
  const warned: ScanHit[] = [];
  const lines = text.split(/\r?\n/);
  for (const rule of RULES) {
    lines.forEach((line, i) => {
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.re.exec(line)) !== null) {
        const hit: ScanHit = { pattern: rule.name, sample: redact(m[0]), line: i + 1 };
        (rule.level === "block" ? blocked : warned).push(hit);
        if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
      }
    });
  }
  return { blocked, warned };
}
