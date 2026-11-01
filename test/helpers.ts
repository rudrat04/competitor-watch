import { readFileSync } from 'node:fs';
import { createFetcher, type Fetcher } from '../src/fetch/fetcher.js';

export const fixture = (name: string): string => readFileSync(`test/fixtures/${name}`, 'utf8');

export type Routes = Record<string, { status?: number; body?: string; type?: string } | Error>;

/** A fetch mock keyed by URL. Records every call. Unknown URLs -> 404. */
export function mockFetch(routes: Routes) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const r = routes[url];
    if (r instanceof Error) throw r;
    if (!r) return new Response('not found', { status: 404 });
    return new Response(r.body ?? '', {
      status: r.status ?? 200,
      headers: { 'content-type': r.type ?? 'text/html' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

/** A fetcher with no real waiting and a controllable clock. */
export function testFetcher(routes: Routes, extra: Parameters<typeof createFetcher>[0] = {}) {
  const m = mockFetch(routes);
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const fetcher: Fetcher = createFetcher({
    fetchImpl: m.impl,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    random: () => 0.5,
    ...extra,
  });
  return { fetcher, calls: m.calls, sleeps };
}
