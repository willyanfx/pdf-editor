/**
 * Text matchers for "Search & redact": a literal query plus built-in patterns
 * for common sensitive data. Pure functions over a single line of text — the
 * caller runs them per text block (so a match can't span lines; see report).
 *
 * Matching errs on the side of recall for the structured patterns but keeps
 * validity checks (Luhn, SSN area/group/serial rules) so ordinary numbers in a
 * document don't flood the results list.
 */

export type PatternId = "email" | "phone" | "ssn" | "creditCard" | "date";

export type PatternInfo = { id: PatternId; label: string; example: string };

/** Patterns offered in the dialog, in display order. */
export const PATTERNS: PatternInfo[] = [
  { id: "email", label: "Email addresses", example: "name@example.com" },
  { id: "phone", label: "Phone numbers", example: "(555) 123-4567, +1 555 123 4567" },
  { id: "ssn", label: "US Social Security numbers", example: "123-45-6789" },
  { id: "creditCard", label: "Credit card numbers", example: "4111 1111 1111 1111 (Luhn-checked)" },
  { id: "date", label: "Dates", example: "2024-01-15, 01/15/2024, January 15, 2024" },
];

export type RedactQuery = {
  /** Literal text, matched case-insensitively (internal whitespace is flexible). */
  literal?: string;
  /** Only match the literal at word boundaries. */
  wholeWord?: boolean;
  patterns?: PatternId[];
};

export type TextMatch = {
  /** Character range [start, end) in the searched text. */
  start: number;
  end: number;
  kind: "literal" | PatternId;
};

/** Luhn checksum for a digit string (card numbers). */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** SSA issuance rules: area not 000/666/900–999, group not 00, serial not 0000. */
export function isPlausibleSsn(area: string, group: string, serial: string): boolean {
  const a = Number.parseInt(area, 10);
  if (a === 0 || a === 666 || a >= 900) return false;
  if (group === "00") return false;
  if (serial === "0000") return false;
  return true;
}

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/** Each pattern as a global regex plus an optional validator over the match. */
const PATTERN_REGEX: Record<PatternId, { re: RegExp; valid?: (m: RegExpExecArray) => boolean }> = {
  email: { re: /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi },
  phone: {
    // Optional country code, 3-3-4 digit groups with (), spaces, dots or dashes.
    // Digit look-arounds stop it eating a slice of a longer number.
    re: /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g,
  },
  ssn: {
    re: /(?<!\d)(\d{3})[- ](\d{2})[- ](\d{4})(?!\d)/g,
    valid: (m) => isPlausibleSsn(m[1], m[2], m[3]),
  },
  creditCard: {
    // 13–19 digits, optionally grouped by single spaces or dashes.
    re: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g,
    valid: (m) => {
      const digits = m[0].replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
    },
  },
  date: {
    re: new RegExp(
      [
        String.raw`\b\d{4}-\d{2}-\d{2}\b`, // ISO 2024-01-15
        String.raw`\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b`, // 01/15/2024, 15.01.2024
        String.raw`\b${MONTH}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b`, // January 15, 2024
        String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}\.?,?\s+\d{4}\b`, // 15 January 2024
      ].join("|"),
      "gi",
    ),
  },
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the literal-text regex, or null when the query has no literal. */
function literalRegex(literal: string | undefined, wholeWord: boolean): RegExp | null {
  const trimmed = literal?.trim() ?? "";
  if (!trimmed) return null;
  // Flexible internal whitespace: extracted PDF text often collapses or splits
  // spaces differently from the way the user types the query.
  const body = trimmed.split(/\s+/).map(escapeRegex).join("\\s+");
  const src = wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
  return new RegExp(src, "giu");
}

/**
 * Find every match of the query in `text`. Results are sorted by position with
 * overlaps removed (earlier start wins; on a tie the longer match wins).
 */
export function findMatches(text: string, query: RedactQuery): TextMatch[] {
  const found: TextMatch[] = [];
  const lit = literalRegex(query.literal, query.wholeWord ?? false);
  if (lit) {
    for (const m of text.matchAll(lit)) {
      if (m[0].length === 0) continue;
      found.push({ start: m.index, end: m.index + m[0].length, kind: "literal" });
    }
  }
  for (const id of query.patterns ?? []) {
    const spec = PATTERN_REGEX[id];
    if (!spec) continue;
    spec.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = spec.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        spec.re.lastIndex++;
        continue;
      }
      if (spec.valid && !spec.valid(m)) {
        // Rescan from the next character: a valid number can overlap the
        // rejected match (e.g. an order number run into a card number).
        spec.re.lastIndex = m.index + 1;
        continue;
      }
      found.push({ start: m.index, end: m.index + m[0].length, kind: id });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: TextMatch[] = [];
  let lastEnd = -1;
  for (const m of found) {
    if (m.start < lastEnd) continue;
    out.push(m);
    lastEnd = m.end;
  }
  return out;
}
