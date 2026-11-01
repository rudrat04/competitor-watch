/**
 * Battlecard document model (PLAN.md §7.6). A battlecard is Markdown with fixed `##`
 * sections. Updates replace only the sections the model returned; every other section is
 * kept byte-for-byte by splicing raw text, never by re-rendering it.
 */

export const SECTION_HEADINGS = {
  overview: 'Overview',
  pricing: 'Pricing & packaging',
  positioning: 'Positioning & messaging',
  recent: 'Recent changes',
  strengths: "Where they're strong / where we win",
  handling: 'How to handle them in a sales conversation',
} as const;

export type SectionKey = keyof typeof SECTION_HEADINGS;
export const SECTION_ORDER: SectionKey[] = [
  'overview',
  'pricing',
  'positioning',
  'recent',
  'strengths',
  'handling',
];
/** Sections the model writes. "Recent changes" is maintained by code. */
export type LlmSectionKey = Exclude<SectionKey, 'recent'>;
export const LLM_SECTIONS: LlmSectionKey[] = [
  'overview',
  'pricing',
  'positioning',
  'strengths',
  'handling',
];

export const MAX_RECENT_CHANGES = 15;
const EMPTY_RECENT = '_No changes recorded yet._';
const FOOTER_RE = /^_Last updated: [^\n]*_[ \t]*\n*$/m;

export class CardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardError';
  }
}

interface RawSection {
  heading: string;
  raw: string;
}

export interface ParsedCard {
  preamble: string;
  sections: RawSection[];
}

/** Keep model text from creating new `#` headings, which would break the section layout. */
export function sanitizeBody(text: string): string {
  return text
    .trim()
    .replace(/^#{1,6}[ \t]+(.*)$/gm, '**$1**')
    .replace(/\r\n?/g, '\n');
}

const sectionRaw = (key: SectionKey, body: string): string =>
  `## ${SECTION_HEADINGS[key]}\n\n${body.trim()}\n\n`;

const footer = (date: string): string => `_Last updated: ${date}_\n`;

export function parseCard(md: string): ParsedCard {
  // Cut the footer off exactly where it starts, so the last section's text is untouched.
  const footerAt = md.search(FOOTER_RE);
  const body = footerAt === -1 ? md : md.slice(0, footerAt);
  const starts: number[] = [];
  const re = /^## /gm;
  for (let m = re.exec(body); m; m = re.exec(body)) starts.push(m.index);
  if (starts.length === 0) throw new CardError('battlecard has no "##" sections');
  const preamble = body.slice(0, starts[0]);
  const sections = starts.map((start, i) => {
    const raw = body.slice(start, starts[i + 1] ?? body.length);
    return {
      heading: raw.slice(3, raw.indexOf('\n') === -1 ? undefined : raw.indexOf('\n')).trim(),
      raw,
    };
  });
  for (const key of SECTION_ORDER) {
    if (!sections.some((s) => s.heading === SECTION_HEADINGS[key])) {
      throw new CardError(`battlecard is missing the "${SECTION_HEADINGS[key]}" section`);
    }
  }
  return { preamble, sections };
}

function bodyOf(raw: string): string {
  const nl = raw.indexOf('\n');
  return nl === -1 ? '' : raw.slice(nl + 1).trim();
}

/** Existing "Recent changes" entries (lines starting with "- "), newest first. */
export function recentEntries(md: string): string[] {
  const card = parseCard(md);
  const sec = card.sections.find((s) => s.heading === SECTION_HEADINGS.recent);
  return bodyOf(sec?.raw ?? '')
    .split('\n')
    .filter((l) => l.startsWith('- '));
}

/** Newest first, de-duplicated, capped at 15. */
export function mergeRecent(newEntries: string[], existing: string[]): string[] {
  return [...new Set([...newEntries, ...existing])].slice(0, MAX_RECENT_CHANGES);
}

const recentBody = (entries: string[]): string =>
  entries.length > 0 ? entries.join('\n') : EMPTY_RECENT;

export type CardContent = Record<LlmSectionKey, string>;

/** A brand-new battlecard. */
export function renderCard(
  competitorName: string,
  content: CardContent,
  recent: string[],
  date: string,
): string {
  const parts = SECTION_ORDER.map((key) =>
    sectionRaw(key, key === 'recent' ? recentBody(recent) : sanitizeBody(content[key])),
  );
  return `# ${competitorName} — Battlecard\n\n${parts.join('')}${footer(date)}`;
}

/**
 * Splice updates into an existing card. `updates[key]` = new text, or null/undefined/blank to
 * leave that section untouched. New "Recent changes" entries go on top of the existing ones.
 * Throws CardError if the existing card is not in the expected layout, or if the result would
 * not be (callers then keep the old card).
 */
export function updateCard(
  md: string,
  updates: Partial<Record<LlmSectionKey, string | null>>,
  newRecent: string[],
  date: string,
): string {
  const card = parseCard(md);
  const sections = card.sections.map((s) => {
    const key = SECTION_ORDER.find((k) => SECTION_HEADINGS[k] === s.heading);
    if (!key) return s.raw;
    if (key === 'recent') {
      if (newRecent.length === 0) return s.raw;
      const merged = mergeRecent(
        newRecent,
        bodyOf(s.raw)
          .split('\n')
          .filter((l) => l.startsWith('- ')),
      );
      return sectionRaw('recent', recentBody(merged));
    }
    const text = updates[key];
    return typeof text === 'string' && text.trim() ? sectionRaw(key, sanitizeBody(text)) : s.raw;
  });
  const out = `${card.preamble}${sections.join('')}${footer(date)}`;
  parseCard(out); // validate the layout survived
  return out;
}

/** Body text of a section, for display and tests. */
export function sectionBody(md: string, key: SectionKey): string {
  const sec = parseCard(md).sections.find((s) => s.heading === SECTION_HEADINGS[key]);
  return bodyOf(sec?.raw ?? '');
}
