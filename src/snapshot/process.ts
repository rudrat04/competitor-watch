import type { PageConfig } from '../config.js';
import { extractMarkdown } from '../fetch/extract.js';
import type { Fetcher } from '../fetch/fetcher.js';
import { renderHtml } from '../fetch/render.js';
import type { Storage } from '../storage/storage.js';
import { normalize } from './normalize.js';
import { pageKey, sha256, snapshotPath, type PageState, type State } from './state.js';

export type Capture =
  | { kind: 'ok'; markdown: string; hash: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'error'; message: string };

export interface CaptureDeps {
  fetcher: Fetcher;
  render?: (url: string) => Promise<{ html: string; finalUrl: string }>;
}

/** robots check -> fetch (or render) -> extract -> normalize -> hash. Never throws. */
export async function capturePage(page: PageConfig, deps: CaptureDeps): Promise<Capture> {
  try {
    const robots = await deps.fetcher.isAllowed(page.url);
    if (!robots.allowed)
      return { kind: 'blocked', reason: robots.reason ?? 'blocked by robots.txt' };

    const { html, finalUrl } = page.render
      ? await (deps.render ?? renderHtml)(page.url)
      : await deps.fetcher.getHtml(page.url);

    const markdown = normalize(
      extractMarkdown(html, finalUrl, { include: page.include, ignore: page.ignore }),
    );
    return { kind: 'ok', markdown, hash: sha256(markdown) };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export type ProcessResult =
  | { status: 'baseline'; detail?: string }
  | { status: 'unchanged' }
  /** Content differs from the stored snapshot. Not yet saved: the diff stage decides. */
  | { status: 'changed'; markdown: string; hash: string; previousHash: string }
  | { status: 'blocked'; reason: string }
  | { status: 'error'; message: string };

export interface ProcessContext extends CaptureDeps {
  storage: Storage;
  state: State;
  now?: () => Date;
}

/**
 * Capture one page and compare with state.json. Handles the LLM-free outcomes:
 * baseline, unchanged, blocked, error. On error/blocked the previous snapshot and
 * hash are kept (never an empty snapshot). Mutates `ctx.state`; the caller saves it.
 */
export async function processPage(
  ctx: ProcessContext,
  slug: string,
  pageId: string,
  page: PageConfig,
): Promise<ProcessResult> {
  const key = pageKey(slug, pageId);
  const stamp = (ctx.now?.() ?? new Date()).toISOString();
  const previous: PageState | undefined = ctx.state.pages[key];

  const update = (patch: Partial<PageState>): void => {
    ctx.state.pages[key] = {
      url: page.url,
      hash: previous?.hash ?? null,
      last_changed: previous?.last_changed ?? null,
      last_error: null,
      last_status: 'ok',
      ...patch,
      last_checked: stamp,
    };
  };

  const capture = await capturePage(page, ctx);

  if (capture.kind === 'blocked') {
    update({ last_status: 'blocked', last_error: capture.reason });
    return { status: 'blocked', reason: capture.reason };
  }
  if (capture.kind === 'error') {
    update({ last_status: 'error', last_error: capture.message });
    return { status: 'error', message: capture.message };
  }

  // A new page, or the config now points this page id at a different URL: diffing against
  // the old URL's snapshot would report a whole different page as one big change.
  if (!previous?.hash || previous.url !== page.url) {
    await ctx.storage.write(snapshotPath(slug, pageId), capture.markdown);
    update({ hash: capture.hash, last_changed: stamp, last_status: 'baseline' });
    return previous?.hash
      ? { status: 'baseline', detail: `URL changed from ${previous.url}; new baseline` }
      : { status: 'baseline' };
  }
  if (previous.hash === capture.hash) {
    update({ last_status: 'unchanged' });
    return { status: 'unchanged' };
  }
  // Leave hash and status as they were; the diff stage records the outcome.
  update({ last_status: previous.last_status, last_error: previous.last_error });
  return {
    status: 'changed',
    markdown: capture.markdown,
    hash: capture.hash,
    previousHash: previous.hash,
  };
}
