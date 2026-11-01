import { describe, expect, it } from 'vitest';
import { FetchError } from '../src/fetch/fetcher.js';
import { USER_AGENT } from '../src/constants.js';
import { testFetcher } from './helpers.js';

const robots = (txt: string) => ({ 'https://a.io/robots.txt': { body: txt, type: 'text/plain' } });

describe('fetcher', () => {
  it('sends the identifying user agent', async () => {
    const { fetcher, calls } = testFetcher({ 'https://a.io/p': { body: '<p>hi</p>' } });
    await fetcher.getHtml('https://a.io/p');
    expect(calls[0]?.headers['User-Agent']).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^Outflank\/\d/);
  });

  it('retries 5xx with exponential backoff, then succeeds', async () => {
    let n = 0;
    const { fetcher, sleeps } = testFetcher(
      {},
      {
        fetchImpl: (async () =>
          ++n < 3
            ? new Response('', { status: 503 })
            : new Response('<p>ok</p>', {
                headers: { 'content-type': 'text/html' },
              })) as typeof fetch,
      },
    );
    expect((await fetcher.getHtml('https://a.io/p')).html).toContain('ok');
    expect(n).toBe(3);
    expect(sleeps).toContain(1000);
    expect(sleeps).toContain(2000);
  });

  it('gives up after 2 retries', async () => {
    let n = 0;
    const { fetcher } = testFetcher(
      {},
      {
        fetchImpl: (async () => {
          n++;
          throw new Error('boom');
        }) as typeof fetch,
      },
    );
    await expect(fetcher.getHtml('https://a.io/p')).rejects.toThrow(/boom.*3 attempts/);
    expect(n).toBe(3);
  });

  it('does not retry a 404', async () => {
    const { fetcher, calls } = testFetcher({});
    await expect(fetcher.getHtml('https://a.io/missing')).rejects.toThrow(FetchError);
    expect(calls).toHaveLength(1);
  });

  it('rejects non-HTML content', async () => {
    const { fetcher } = testFetcher({
      'https://a.io/f.pdf': { body: '%PDF', type: 'application/pdf' },
    });
    await expect(fetcher.getHtml('https://a.io/f.pdf')).rejects.toThrow(/content type/);
  });

  it('waits 1–2s between requests to the same host, not across hosts', async () => {
    const { fetcher, sleeps } = testFetcher({
      'https://a.io/1': { body: '<p>1</p>' },
      'https://a.io/2': { body: '<p>2</p>' },
      'https://b.io/1': { body: '<p>3</p>' },
    });
    await fetcher.getHtml('https://a.io/1');
    expect(sleeps).toEqual([]);
    await fetcher.getHtml('https://a.io/2');
    expect(sleeps).toEqual([1500]); // random() = 0.5 -> 1.5s gap
    await fetcher.getHtml('https://b.io/1');
    expect(sleeps).toEqual([1500]);
  });
});

describe('robots.txt', () => {
  it('blocks disallowed paths for our token and allows others', async () => {
    const { fetcher } = testFetcher(
      robots('User-agent: Outflank\nDisallow: /private\n\nUser-agent: *\nAllow: /'),
    );
    expect((await fetcher.isAllowed('https://a.io/private/x')).allowed).toBe(false);
    expect((await fetcher.isAllowed('https://a.io/public')).allowed).toBe(true);
  });

  it('honours a wildcard disallow', async () => {
    const { fetcher } = testFetcher(robots('User-agent: *\nDisallow: /'));
    const r = await fetcher.isAllowed('https://a.io/pricing');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/robots\.txt/);
  });

  it('is cached per host for the run', async () => {
    const { fetcher, calls } = testFetcher(robots('User-agent: *\nAllow: /'));
    await fetcher.isAllowed('https://a.io/1');
    await fetcher.isAllowed('https://a.io/2');
    expect(calls.filter((c) => c.url.endsWith('/robots.txt'))).toHaveLength(1);
  });

  it('a missing robots.txt (404) allows everything', async () => {
    const { fetcher } = testFetcher({});
    expect((await fetcher.isAllowed('https://a.io/x')).allowed).toBe(true);
  });

  it('an unreachable robots.txt (5xx) is treated as disallow', async () => {
    const { fetcher } = testFetcher({ 'https://a.io/robots.txt': { status: 500 } });
    expect((await fetcher.isAllowed('https://a.io/x')).allowed).toBe(false);
  });
});
