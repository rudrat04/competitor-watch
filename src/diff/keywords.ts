export interface KeywordHit {
  keyword: string;
  change: 'appeared' | 'removed';
}

/** Global + per-page lists, de-duplicated case-insensitively, first spelling wins. */
export function mergeKeywords(globalList: string[] = [], pageList: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of [...globalList, ...pageList]) {
    const key = k.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(k.trim());
    }
  }
  return out;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive, whole-word (or whole-phrase) occurrence count. */
export function countOccurrences(text: string, keyword: string): number {
  const body = keyword.trim().split(/\s+/).map(escapeRegex).join('\\s+');
  // Unicode-aware "word boundary" that also works for keywords like "$99" or "C++".
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'giu');
  return text.match(re)?.length ?? 0;
}

/**
 * A hit is a keyword that appeared (0 -> >=1) or disappeared (>=1 -> 0) between the old
 * and new snapshot. A change in count that stays on the same side of zero is not a hit.
 * Pure code: costs nothing and runs before the diff-size threshold (PLAN.md §7.3a).
 */
export function findKeywordHits(
  oldText: string,
  newText: string,
  keywords: string[],
): KeywordHit[] {
  const hits: KeywordHit[] = [];
  for (const keyword of keywords) {
    const before = countOccurrences(oldText, keyword);
    const after = countOccurrences(newText, keyword);
    if (before === 0 && after > 0) hits.push({ keyword, change: 'appeared' });
    else if (before > 0 && after === 0) hits.push({ keyword, change: 'removed' });
  }
  return hits;
}

/** e.g. `Keyword trigger: "free plan" removed` */
export function describeHit(hit: KeywordHit): string {
  return `Keyword trigger: "${hit.keyword}" ${hit.change}`;
}
