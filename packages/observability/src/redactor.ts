export interface Redactor {
  redact(s: string): string;
}

const SENSITIVE_KEY_PATTERN = /(?:password|passwd|pwd|secret|api[-_]?key|apikey|apiKey|token|auth(?:orization)?|credential|client[-_]?secret|clientSecret|private[-_]?key|privateKey|access[-_]?token|accessToken|refresh[-_]?token|refreshToken|authToken)/i;

/**
 * Default text sanitizer: removes high-confidence credential patterns from arbitrary strings.
 * Covers GitHub/OpenAI tokens, Bearer headers, and labeled credentials (password=..., api_key: ..., etc.).
 */
export function defaultSanitize(s: string): string {
  if (!s) return s;
  return s
    // High-confidence token patterns (GitHub, OpenAI, etc.)
    .replace(/(ghp|sgp|github_pat|sk-)[a-zA-Z0-9_-]{20,}/gi, '[REDACTED]')
    // Bearer/Authorization/token with value
    .replace(/(Bearer|Authorization|token)[\s=:]+(Bearer\s+)?['"]?[^\s'"]+['"]?/gi, '$1 [REDACTED]')
    // Labeled credentials: password=..., api_key: ..., client_secret is ..., etc.
    .replace(/(password|passwd|pwd|api[-_]?key|apikey|client[-_]?secret|private[-_]?key|access[-_]?token|refresh[-_]?token|secret)[\s]*[=:]\s*['"]?[^\s'"]+['"]?/gi, '$1=[REDACTED]');
}

export const defaultRedactor: Redactor = {
  redact: defaultSanitize
};

/**
 * Recursively sanitize a value. If a key matches SENSITIVE_KEY_PATTERN, the entire
 * value is replaced with '[REDACTED]'. Otherwise, string values are run through
 * the redactor and nested structures are traversed.
 */
export function sanitizeValue(val: unknown, redactor: Redactor = defaultRedactor): unknown {
  if (typeof val === 'string') return redactor.redact(val);
  if (Array.isArray(val)) return val.map(item => sanitizeValue(item, redactor));
  if (val !== null && typeof val === 'object') {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        res[k] = '[REDACTED]';
      } else {
        res[k] = sanitizeValue(v, redactor);
      }
    }
    return res;
  }
  return val;
}

/** @deprecated Use sanitizeValue instead */
export function deepRedact(obj: unknown, redactor: Redactor): unknown {
  return sanitizeValue(obj, redactor);
}
