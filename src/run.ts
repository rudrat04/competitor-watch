import { ConfigError, slugify, type Config, type PageConfig } from './config.js';
import { diffSnapshots, formatHunks, type SnapshotDiff } from './diff/differ.js';
import { describeHit, findKeywordHits, mergeKeywords, type KeywordHit } from './diff/keywords.js';
import { isTrivial } from './diff/threshold.js';
import type { Fetcher } from './fetch/fetcher.js';
import { processPage } from './snapshot/process.js';
import {
  pageIdsFor,
  loadState,
  pageKey,
  saveState,
  snapshotPath,
  type PageStatus,
  type State,
} from './snapshot/state.js';
import { readOnlyStorage } from './storage/readonly.js';
import type { Storage } from './storage/storage.js';

export type Significance = 'noise' | 'minor' | 'material';

export interface ChangeInput {
  competitor: string;
  slug: string;
  pageId: string;
  page: PageConfig;
  diff: SnapshotDiff;
  keywordHits: KeywordHit[];
}

export interface Classification {
  significance: Significance;
  category?: string;
  summary?: string;
}

/**
 * Seam for the LLM stage (M4): triage, and analysis for material changes.
 * Return null to defer (no LLM available, or cost cap hit): the page's snapshot and hash
 * are then left untouched so the change is picked up again next run (PLAN.md §7.9).
 */
export type Classify = (input: ChangeInput) => Promise<Classification | null>;

export interface RunDeps {
  fetcher: Fetcher;
  storage: Storage;
  render?: (url: string) => Promise<{ html: string; finalUrl: string }>;
  classify?: Classify;
  now?: () => Date;
}

export interface RunOptions {
  dryRun?: boolean;
  /** Competitor slug. */
  only?: string;
}

export interface PageOutcome {
  competitor: string;
  slug: string;
  pageId: string;
  url: string;
  /** `deferred` = changed but not classified; snapshot and hash left as they were. */
  status: PageStatus | 'deferred';
  detail?: string;
  changedChars?: number;
  keywordHits: KeywordHit[];
  classification?: Classification;
  /** Diff hunks as text, for changed pages. */
  diffText?: string;
}

export interface RunResult {
  outcomes: PageOutcome[];
  state: State;
  dryRun: boolean;
}

export async function runPipeline(
  config: Config,
  deps: RunDeps,
  opts: RunOptions = {},
): Promise<RunResult> {
  const dryRun = opts.dryRun ?? false;
  const now = deps.now ?? (() => new Date());
  const storage = dryRun ? readOnlyStorage(deps.storage) : deps.storage;
  const state = await loadState(deps.storage);

  const slugs = config.competitors.map((c) => slugify(c.name));
  if (opts.only && !slugs.includes(opts.only)) {
    throw new ConfigError(
      `--only "${opts.only}" matches no competitor. Known: ${slugs.join(', ')}`,
    );
  }

  const outcomes: PageOutcome[] = [];
  for (const competitor of config.competitors) {
    const slug = slugify(competitor.name);
    if (opts.only && opts.only !== slug) continue;
    const ids = pageIdsFor(competitor);

    for (const [i, page] of competitor.pages.entries()) {
      const pageId = ids[i] ?? page.type;
      const key = pageKey(slug, pageId);
      const base = { competitor: competitor.name, slug, pageId, url: page.url, keywordHits: [] };
      const stamp = now().toISOString();

      const result = await processPage(
        { fetcher: deps.fetcher, render: deps.render, storage, state, now },
        slug,
        pageId,
        page,
      );

      if (result.status === 'blocked') {
        outcomes.push({ ...base, status: 'blocked', detail: result.reason });
        continue;
      }
      if (result.status === 'error') {
        outcomes.push({ ...base, status: 'error', detail: result.message });
        continue;
      }
      if (result.status !== 'changed') {
        outcomes.push({ ...base, status: result.status });
        continue;
      }

      const commit = async (status: PageStatus): Promise<void> => {
        await storage.write(snapshotPath(slug, pageId), result.markdown);
        const entry = state.pages[key];
        if (entry) {
          entry.hash = result.hash;
          entry.last_changed = stamp;
          entry.last_status = status;
          entry.last_error = null;
        }
      };

      const oldMarkdown = await storage.read(snapshotPath(slug, pageId));
      if (oldMarkdown === null) {
        // State knows the page but its snapshot file is gone: nothing to diff, re-baseline.
        await commit('baseline');
        outcomes.push({ ...base, status: 'baseline', detail: 'snapshot file was missing' });
        continue;
      }

      const diff = diffSnapshots(oldMarkdown, result.markdown);
      const keywords = mergeKeywords(config.settings.alert_on, page.alert_on);
      const keywordHits = findKeywordHits(oldMarkdown, result.markdown, keywords);
      const common = {
        ...base,
        keywordHits,
        changedChars: diff.changedChars,
        diffText: formatHunks(diff),
      };

      // Keyword hits run before the threshold, so a tiny diff with a hit is never skipped.
      if (keywordHits.length === 0 && isTrivial(diff, config.settings.min_change_chars)) {
        await commit('trivial');
        outcomes.push({ ...common, status: 'trivial' });
        continue;
      }

      const decision = deps.classify
        ? await deps.classify({
            competitor: competitor.name,
            slug,
            pageId,
            page,
            diff,
            keywordHits,
          })
        : null;
      if (!decision) {
        outcomes.push({
          ...common,
          status: 'deferred',
          detail: 'needs LLM triage; snapshot and hash left unchanged',
        });
        continue;
      }

      // A keyword hit forces material, whatever triage said.
      const significance = keywordHits.length > 0 ? 'material' : decision.significance;
      await commit(significance);
      outcomes.push({
        ...common,
        status: significance,
        classification: { ...decision, significance },
      });
    }
  }

  if (!dryRun) {
    state.last_run = now().toISOString();
    await saveState(deps.storage, state);
  }
  return { outcomes, state, dryRun };
}

/** Plain-text report for the terminal. The real digest arrives in M5. */
export function formatReport(result: RunResult): string {
  const lines: string[] = [];
  if (result.dryRun) lines.push('DRY RUN — nothing was written.', '');
  const counts = new Map<string, number>();
  for (const o of result.outcomes) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
  lines.push(
    `${result.outcomes.length} pages: ` +
      ([...counts].map(([s, n]) => `${n} ${s}`).join(', ') || 'none'),
    '',
  );
  for (const o of result.outcomes) {
    lines.push(`[${o.status}] ${o.competitor} / ${o.pageId} — ${o.url}`);
    if (o.detail) lines.push(`    ${o.detail}`);
    if (o.changedChars !== undefined) lines.push(`    ${o.changedChars} chars changed`);
    for (const h of o.keywordHits) lines.push(`    ${describeHit(h)}`);
    if (o.classification?.summary) lines.push(`    ${o.classification.summary}`);
  }
  return lines.join('\n');
}
