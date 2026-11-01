import robotsParserModule from 'robots-parser';
import { USER_AGENT } from '../constants.js';

interface RobotsLike {
  isAllowed(url: string, ua?: string): boolean | undefined;
}
// robots-parser ships CJS typings; Node's ESM default import is the function itself.
const robotsParser = robotsParserModule as unknown as (url: string, txt: string) => RobotsLike;

/** Product token matched against robots.txt `User-agent:` lines. */
export const ROBOTS_TOKEN = 'CompetitorWatch';

export class FetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchError';
  }
}

export interface FetcherOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  timeoutMs?: number;
  retries?: number;
  /** Base backoff; attempt n waits base * 2^n. */
  backoffMs?: number;
  minHostDelayMs?: number;
  maxHostDelayMs?: number;
}

export interface Fetcher {
  /** robots.txt check, cached per host for the life of this fetcher (one run). */
  isAllowed(url: string): Promise<{ allowed: boolean; reason?: string }>;
  /** GET a page's HTML. Throws FetchError. Does not check robots.txt; callers must. */
  getHtml(url: string): Promise<{ html: string; finalUrl: string }>;
}

type Robots = RobotsLike | 'allow-all' | 'disallow-all';

export function createFetcher(opts: FetcherOptions = {}): Fetcher {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const retries = opts.retries ?? 2;
  const backoffMs = opts.backoffMs ?? 1_000;
  const minDelay = opts.minHostDelayMs ?? 1_000;
  const maxDelay = opts.maxHostDelayMs ?? 2_000;

  const lastRequestAt = new Map<string, number>();
  const robotsCache = new Map<string, Promise<Robots>>();

  /** Wait so requests to one host are 1–2s apart. */
  async function politeWait(host: string): Promise<void> {
    const last = lastRequestAt.get(host);
    if (last !== undefined) {
      const gap = minDelay + random() * (maxDelay - minDelay);
      const wait = last + gap - now();
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt.set(host, now());
  }

  async function request(url: string, accept: string): Promise<Response> {
    const host = new URL(url).host;
    let lastError = 'unknown error';
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
      await politeWait(host);
      try {
        const res = await doFetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: accept },
          redirect: 'follow',
          credentials: 'omit',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = `HTTP ${res.status}`;
          await res.body?.cancel();
          continue;
        }
        return res;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    throw new FetchError(`${lastError} (after ${retries + 1} attempts)`);
  }

  async function loadRobots(origin: string): Promise<Robots> {
    const robotsUrl = `${origin}/robots.txt`;
    let res: Response;
    try {
      res = await request(robotsUrl, 'text/plain');
    } catch {
      // RFC 9309: robots.txt unreachable (5xx / network) -> assume complete disallow.
      return 'disallow-all';
    }
    if (res.status >= 400) {
      await res.body?.cancel();
      return 'allow-all'; // 4xx: no robots.txt
    }
    return robotsParser(robotsUrl, await res.text());
  }

  return {
    async isAllowed(url) {
      const origin = new URL(url).origin;
      let pending = robotsCache.get(origin);
      if (!pending) {
        pending = loadRobots(origin);
        robotsCache.set(origin, pending);
      }
      const robots = await pending;
      if (robots === 'allow-all') return { allowed: true };
      if (robots === 'disallow-all') {
        return { allowed: false, reason: `${origin}/robots.txt could not be fetched` };
      }
      if (robots.isAllowed(url, ROBOTS_TOKEN) === false) {
        return { allowed: false, reason: `disallowed by ${origin}/robots.txt` };
      }
      return { allowed: true };
    },

    async getHtml(url) {
      const res = await request(url, 'text/html,application/xhtml+xml');
      if (!res.ok) {
        await res.body?.cancel();
        throw new FetchError(`HTTP ${res.status}`);
      }
      const type = res.headers.get('content-type') ?? '';
      if (type && !/html|xml/i.test(type)) {
        await res.body?.cancel();
        throw new FetchError(`unexpected content type "${type}" (expected HTML)`);
      }
      return { html: await res.text(), finalUrl: res.url || url };
    },
  };
}
