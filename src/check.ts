import type { Config } from './config.js';
import { slugify } from './config.js';
import type { Fetcher } from './fetch/fetcher.js';
import { capturePage, type CaptureDeps } from './snapshot/process.js';
import { pageIdsFor } from './snapshot/state.js';

export interface CheckLine {
  competitor: string;
  pageId: string;
  url: string;
  ok: boolean;
  detail: string;
}

/** Test-fetch every page. No LLM, no writes. */
export async function checkPages(
  config: Config,
  deps: { fetcher: Fetcher; render?: CaptureDeps['render'] },
  only?: string,
): Promise<CheckLine[]> {
  const lines: CheckLine[] = [];
  for (const competitor of config.competitors) {
    if (only && slugify(competitor.name) !== only) continue;
    const ids = pageIdsFor(competitor);
    for (const [i, page] of competitor.pages.entries()) {
      const result = await capturePage(page, deps);
      const base = { competitor: competitor.name, pageId: ids[i] ?? page.type, url: page.url };
      if (result.kind === 'ok') {
        lines.push({ ...base, ok: true, detail: `${result.markdown.length} chars extracted` });
      } else if (result.kind === 'blocked') {
        lines.push({ ...base, ok: false, detail: `BLOCKED: ${result.reason}` });
      } else {
        lines.push({ ...base, ok: false, detail: `ERROR: ${result.message}` });
      }
    }
  }
  return lines;
}

export function needsBrowser(config: Config): boolean {
  return config.competitors.some((c) => c.pages.some((p) => p.render));
}
