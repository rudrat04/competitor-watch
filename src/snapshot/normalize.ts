/**
 * Noise-stripping rules (PLAN.md §7.2). One function per rule; each is a pure
 * string -> string transform with its own unit test. Goal: two fetches of an
 * unchanged page produce identical text.
 */

/** Smart quotes, dashes, ellipsis and non-breaking spaces -> plain ASCII. */
export function normalizeQuotesAndDashes(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\u00A0\u2007\u202F\u200B]/g, ' ');
}

/** "3 hours ago", "an hour ago", "just now" -> removed. */
export function stripRelativeTimestamps(text: string): string {
  return text.replace(
    /\b(?:(?:\d+|an?|one)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|just now)\b/gi,
    '',
  );
}

/** "© 2019-2025 Acme" -> "© Acme". */
export function stripCopyrightYears(text: string): string {
  return text.replace(
    /(©|\(c\)|copyright(?:\s*©)?)\s*(?:\d{4}\s*-\s*)?\d{4}\b/gi,
    (_m, symbol: string) => symbol,
  );
}

/** Strip ?query and #fragment from markdown link targets. */
export function stripLinkQueryAndFragments(text: string): string {
  return text.replace(/\]\(([^)\s]*?)[?#][^)\s]*/g, ']($1');
}

/** Bare cache-busting parameters such as "?v=123" or "&cb=abc" left in plain text. */
export function stripCacheBustingTokens(text: string): string {
  return text.replace(/[?&](?:v|ver|version|cb|_|t|ts|cachebust|cache)=[\w.-]+/gi, '');
}

/** "csrf_token: abc123", "authenticity_token=..." -> removed. */
export function stripCsrfStrings(text: string): string {
  return text.replace(/\b(?:csrf|xsrf|authenticity)[_-]?(?:token)?\s*[:=]\s*\S+/gi, '');
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function stripUuids(text: string): string {
  return text.replace(UUID, '');
}

/** 24+ char alphanumeric runs containing both letters and digits (hashes, session ids). */
export function stripLongRandomIds(text: string): string {
  return text.replace(/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{24,}\b/g, '');
}

/** Trim line ends, collapse runs of spaces, collapse 3+ newlines to one blank line. */
export function collapseWhitespace(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

/** Run every rule. Removal rules run before whitespace collapsing. */
export function normalize(text: string): string {
  return collapseWhitespace(
    stripLongRandomIds(
      stripUuids(
        stripCsrfStrings(
          stripCacheBustingTokens(
            stripLinkQueryAndFragments(
              stripCopyrightYears(stripRelativeTimestamps(normalizeQuotesAndDashes(text))),
            ),
          ),
        ),
      ),
    ),
  );
}
