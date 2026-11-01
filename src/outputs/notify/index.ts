import type { Config } from '../../config.js';
import type { RunResult } from '../../run.js';
import { digestHeadline } from '../digest.js';
import { createDigestIssue } from './github-issue.js';
import { sendDiscord } from './discord.js';
import type { NotifyResult } from './http.js';
import { sendSlack } from './slack.js';

export type { NotifyResult } from './http.js';

export interface NotifySummary {
  date: string;
  headline: string;
  /** One line per change, material first. */
  items: string[];
  /** Changes not listed in `items`. */
  more: number;
  digestUrl: string;
}

const MAX_ITEMS = 5;
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * PLAN.md §7.8: notify when there is at least one minor or material change, or a baseline was
 * created (so the user sees setup worked), or the cost cap was hit.
 */
export function shouldNotify(result: RunResult): boolean {
  return (
    result.outcomes.some((o) => ['minor', 'material', 'baseline'].includes(o.status)) ||
    result.cost?.capHit === true
  );
}

export function summarize(result: RunResult, date: string, digestUrl: string): NotifySummary {
  const changes = [
    ...result.outcomes.filter((o) => o.status === 'material'),
    ...result.outcomes.filter((o) => o.status === 'minor'),
  ];
  const items = changes
    .slice(0, MAX_ITEMS)
    .map(
      (o) =>
        `${o.status === 'material' ? '🔴' : '🟡'} ${o.competitor} (${o.pageType}): ${oneLine(o.classification?.summary ?? 'page changed')}`,
    );
  let headline = digestHeadline(result.outcomes);
  if (result.cost?.capHit) headline += ' — cost cap hit, some changes will be analyzed next run';
  return { date, headline, items, more: Math.max(0, changes.length - MAX_ITEMS), digestUrl };
}

export interface NotifyOptions {
  result: RunResult;
  config: Config;
  date: string;
  digestUrl: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

/** Send every enabled notification. Never throws; each channel reports its own result. */
export async function notifyAll(opts: NotifyOptions): Promise<NotifyResult[]> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const n = opts.config.settings.notify;
  if (opts.result.dryRun || !shouldNotify(opts.result)) return [];

  const summary = summarize(opts.result, opts.date, opts.digestUrl);
  const results: NotifyResult[] = [];

  if (n.github_issue) {
    results.push(
      await createDigestIssue({
        title: `Competitor Watch — ${opts.date}: ${summary.headline}`,
        digest: opts.result.digest,
        digestUrl: opts.digestUrl,
        env,
        fetchImpl,
      }),
    );
  }
  if (n.slack) {
    results.push(
      env.SLACK_WEBHOOK_URL
        ? await sendSlack(env.SLACK_WEBHOOK_URL, summary, fetchImpl)
        : {
            channel: 'slack',
            status: 'failed',
            detail: 'notify.slack is on but SLACK_WEBHOOK_URL is not set',
          },
    );
  }
  if (n.discord) {
    results.push(
      env.DISCORD_WEBHOOK_URL
        ? await sendDiscord(env.DISCORD_WEBHOOK_URL, summary, fetchImpl)
        : {
            channel: 'discord',
            status: 'failed',
            detail: 'notify.discord is on but DISCORD_WEBHOOK_URL is not set',
          },
    );
  }
  return results;
}
