import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

export class IncludeNoMatchError extends Error {
  constructor(selectors: string[]) {
    super(
      `include selector matched nothing (${selectors.join(', ')}) — ` +
        'the site may have been redesigned',
    );
    this.name = 'IncludeNoMatchError';
  }
}

export class EmptyContentError extends Error {
  constructor() {
    super('no readable content found on the page');
    this.name = 'EmptyContentError';
  }
}

export interface ExtractOptions {
  include?: string[];
  ignore?: string[];
}

const ALWAYS_REMOVE = 'script, style, noscript, template, img, picture, svg, video, iframe';
const BOILERPLATE = [
  'nav',
  'footer',
  '[role="navigation"]',
  '[role="contentinfo"]',
  '[id*="cookie" i]',
  '[class*="cookie" i]',
  '[id*="consent" i]',
  '[class*="consent" i]',
  '[id*="gdpr" i]',
  '[class*="gdpr" i]',
].join(', ');

function makeTurndown(): TurndownService {
  return new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
  });
}

function removeAll(root: ParentNode, selectors: string): void {
  for (const el of Array.from(root.querySelectorAll(selectors))) el.remove();
}

function safeRemoveAll(root: ParentNode, selectors: string[]): void {
  for (const sel of selectors) {
    try {
      removeAll(root, sel);
    } catch {
      // A bad selector is the user's mistake; skip it rather than fail the page.
    }
  }
}

function absolutizeLinks(root: ParentNode, baseUrl: string): void {
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    try {
      a.setAttribute('href', new URL(a.getAttribute('href') ?? '', baseUrl).href);
    } catch {
      // leave unparseable hrefs as they are
    }
  }
}

/** HTML -> Markdown for one page (PLAN.md §7.2). Normalization happens afterwards. */
export function extractMarkdown(html: string, url: string, opts: ExtractOptions = {}): string {
  const { document } = parseHTML(html);
  const td = makeTurndown();

  safeRemoveAll(document, opts.ignore ?? []);
  removeAll(document, ALWAYS_REMOVE);
  absolutizeLinks(document, url);

  const include = opts.include ?? [];
  if (include.length > 0) {
    // User chose these elements explicitly: skip boilerplate stripping and Readability.
    const found = new Set<Element>();
    for (const sel of include) {
      try {
        document.querySelectorAll(sel).forEach((el: Element) => found.add(el));
      } catch {
        // invalid selector -> matches nothing
      }
    }
    // Document order, and drop elements nested inside another match (no duplicate text).
    const ordered = [...found]
      .filter((el) => ![...found].some((other) => other !== el && other.contains(el)))
      .sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
    const parts = ordered.map((el) => td.turndown(el.outerHTML).trim()).filter(Boolean);
    if (ordered.length === 0) throw new IncludeNoMatchError(include);
    if (parts.length === 0) throw new EmptyContentError();
    return parts.join('\n\n');
  }

  removeAll(document, BOILERPLATE);

  let markdown = '';
  try {
    const article = new Readability(document.cloneNode(true) as unknown as Document).parse();
    if (article?.content) markdown = td.turndown(article.content).trim();
  } catch {
    // fall through to body text
  }
  if (!markdown) {
    const body = document.body;
    markdown = body ? td.turndown(body.innerHTML).trim() : '';
  }
  if (!markdown) throw new EmptyContentError();
  return markdown;
}
