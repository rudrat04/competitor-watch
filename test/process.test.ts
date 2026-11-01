import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkPages, needsBrowser } from '../src/check.js';
import { parseConfig, type PageConfig } from '../src/config.js';
import { RenderUnavailableError, loadPlaywright, renderHtml } from '../src/fetch/render.js';
import { processPage } from '../src/snapshot/process.js';
import { emptyState } from '../src/snapshot/state.js';
import { FilesystemStorage } from '../src/storage/filesystem.js';
import { fixture, testFetcher } from './helpers.js';

const URL_ = 'https://rival.io/pricing';
const page = (extra: Partial<PageConfig> = {}): PageConfig => ({
  type: 'pricing',
  url: URL_,
  render: false,
  ...extra,
});

function setup(html = fixture('pricing-before.html')) {
  const { fetcher } = testFetcher({ [URL_]: { body: html } });
  const storage = new FilesystemStorage(mkdtempSync(join(tmpdir(), 'cw-proc-')));
  const state = emptyState();
  return {
    ctx: { fetcher, storage, state, now: () => new Date('2026-11-02T03:00:00Z') },
    storage,
    state,
  };
}

describe('processPage', () => {
  it('first sight: saves a baseline snapshot and state, no LLM involved', async () => {
    const { ctx, storage, state } = setup();
    expect(await processPage(ctx, 'rival', 'pricing', page())).toEqual({ status: 'baseline' });
    const snap = await storage.read('snapshots/rival/pricing.md');
    expect(snap).toContain('$30 per user per month');
    const s = state.pages['rival/pricing']!;
    expect(s).toMatchObject({ url: URL_, last_status: 'baseline', last_error: null });
    expect(s.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.last_checked).toBe('2026-11-02T03:00:00.000Z');
  });

  it('second sight, same content: unchanged', async () => {
    const { ctx, state } = setup();
    await processPage(ctx, 'rival', 'pricing', page());
    const hash = state.pages['rival/pricing']!.hash;
    expect(await processPage(ctx, 'rival', 'pricing', page())).toEqual({ status: 'unchanged' });
    expect(state.pages['rival/pricing']).toMatchObject({ hash, last_status: 'unchanged' });
  });

  it('volatile-only changes still count as unchanged', async () => {
    const a = setup(fixture('pricing-before.html'));
    await processPage(a.ctx, 'rival', 'pricing', page());
    const { fetcher } = testFetcher({
      [URL_]: {
        body: fixture('pricing-before.html')
          .replace('3 hours ago', '9 days ago')
          .replace('© 2024', '© 2026'),
      },
    });
    const r = await processPage({ ...a.ctx, fetcher }, 'rival', 'pricing', page());
    expect(r.status).toBe('unchanged');
  });

  it('changed content is reported but neither snapshot nor hash is touched', async () => {
    const a = setup();
    await processPage(a.ctx, 'rival', 'pricing', page());
    const before = { ...a.state.pages['rival/pricing']! };
    const { fetcher } = testFetcher({
      [URL_]: { body: fixture('pricing-before.html').replace('$30', '$45') },
    });
    const r = await processPage({ ...a.ctx, fetcher }, 'rival', 'pricing', page());
    expect(r.status).toBe('changed');
    if (r.status === 'changed') {
      expect(r.markdown).toContain('$45');
      expect(r.previousHash).toBe(before.hash);
    }
    expect(a.state.pages['rival/pricing']!.hash).toBe(before.hash);
    expect(await a.storage.read('snapshots/rival/pricing.md')).toContain('$30');
  });

  it('include matching nothing: error, previous snapshot and hash kept', async () => {
    const a = setup();
    await processPage(a.ctx, 'rival', 'pricing', page());
    const before = a.state.pages['rival/pricing']!.hash;
    const r = await processPage(a.ctx, 'rival', 'pricing', page({ include: ['.gone'] }));
    expect(r).toMatchObject({ status: 'error' });
    expect(a.state.pages['rival/pricing']).toMatchObject({ hash: before, last_status: 'error' });
    expect(a.state.pages['rival/pricing']!.last_error).toMatch(/matched nothing/);
    expect(await a.storage.read('snapshots/rival/pricing.md')).toContain('$30');
  });

  it('first fetch failing records an error and writes no snapshot', async () => {
    const { fetcher } = testFetcher({});
    const storage = new FilesystemStorage(mkdtempSync(join(tmpdir(), 'cw-proc-')));
    const state = emptyState();
    const r = await processPage({ fetcher, storage, state }, 'rival', 'pricing', page());
    expect(r.status).toBe('error');
    expect(state.pages['rival/pricing']).toMatchObject({ hash: null, last_status: 'error' });
    expect(await storage.list('snapshots')).toEqual([]);
  });

  it('robots-blocked pages are recorded as blocked and never fetched', async () => {
    const { fetcher, calls } = testFetcher({
      'https://rival.io/robots.txt': { body: 'User-agent: *\nDisallow: /' },
      [URL_]: { body: '<p>x</p>' },
    });
    const storage = new FilesystemStorage(mkdtempSync(join(tmpdir(), 'cw-proc-')));
    const state = emptyState();
    const r = await processPage({ fetcher, storage, state }, 'rival', 'pricing', page());
    expect(r.status).toBe('blocked');
    expect(state.pages['rival/pricing']!.last_status).toBe('blocked');
    expect(calls.some((c) => c.url === URL_)).toBe(false);
  });

  it('render: true without playwright installed fails that page with instructions', async () => {
    const { fetcher } = testFetcher({});
    const storage = new FilesystemStorage(mkdtempSync(join(tmpdir(), 'cw-proc-')));
    const state = emptyState();
    const render = () =>
      renderHtml(URL_, () => loadPlaywright(async () => Promise.reject(new Error('nope'))));
    const r = await processPage(
      { fetcher, storage, state, render },
      'rival',
      'pricing',
      page({ render: true }),
    );
    expect(r).toMatchObject({ status: 'error' });
    expect((r as { message: string }).message).toMatch(/npm install playwright/);
    await expect(render()).rejects.toThrow(RenderUnavailableError);
  });
});

describe('checkPages / needsBrowser', () => {
  const config = parseConfig(`
company: {name: Acme, description: Anvils}
competitors:
  - name: Rival
    pages:
      - {type: pricing, url: "${URL_}"}
      - {type: homepage, url: "https://rival.io/gone"}
`);

  it('reports per-page ok / error without writing anything', async () => {
    const { fetcher } = testFetcher({ [URL_]: { body: fixture('pricing-before.html') } });
    const lines = await checkPages(config, { fetcher });
    expect(lines.map((l) => l.ok)).toEqual([true, false]);
    expect(lines[1]?.detail).toMatch(/ERROR/);
  });

  it('needsBrowser is true only if some page has render: true', () => {
    expect(needsBrowser(config)).toBe(false);
    config.competitors[0]!.pages[1]!.render = true;
    expect(needsBrowser(config)).toBe(true);
  });
});
