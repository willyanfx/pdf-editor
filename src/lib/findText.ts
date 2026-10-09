/** Options for find-in-page, mirroring the toggles in the find bar. */
export type FindOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
};

export const DEFAULT_FIND_OPTIONS: FindOptions = { caseSensitive: false, wholeWord: false };

/** A word character: letters, digits, underscore (same notion as the redaction search). */
const WORD_CHAR = "[\\p{L}\\p{N}_]";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the matcher for `query`, or null for an empty query. Whole-word wraps
 * the query in lookarounds rather than `\b`, so queries that start or end with
 * punctuation ("C++", "$5") still anchor sensibly. */
export function buildFindRegExp(query: string, options: FindOptions): RegExp | null {
  const q = query.trim();
  if (!q) return null;
  const body = escapeRegExp(q);
  const source = options.wholeWord ? `(?<!${WORD_CHAR})${body}(?!${WORD_CHAR})` : body;
  return new RegExp(source, options.caseSensitive ? "u" : "iu");
}

/** True when `text` contains `query` under `options`. */
export function textMatches(text: string, query: string, options: FindOptions): boolean {
  const re = buildFindRegExp(query, options);
  return re ? re.test(text) : false;
}
