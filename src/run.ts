import { ConfigError, slugify, type Config, type PageConfig } from './config.js';
import { diffSnapshots, formatHunks, type SnapshotDiff } from './diff/differ.js';
import { describeHit, findKeywordHits, mergeKeywords, type KeywordHit } from './diff/keywords.js';
import { isTrivial } from './diff/threshold.js';
import { formatCost, type CostSummary, type CostTracker } from './cost.js';
import type { Analysis } from './llm/schemas.js';
import { localLinks, type LinkBuilder } from './github/context.js';
import type { Llm } from './llm/client.js';
import { runBattlecardStage, type BattlecardResult } from './outputs/battlecards.js';
import { buildDigest, nextDigestPath } from './outputs/digest.js';
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
import { dryRunStorage } from './storage/readonly.js';
import type { Storage } from './storage/storage.js';

export type Significance = 'noise' | 'minor' | 'material';

export interface ChangeInput {
  competitor: string;
  slug: string;
  pageId: string;
  page: PageConfig;
  diff: SnapshotDiff;
  keywordHits: KeywordHit[];
  /** diff hunks as text (what the LLM sees) */
  diffText: string;
}

export interface Classification {
  significance: Significance;
  category?: string;
  summary?: string;
  /** Present for material changes. */
  analysis?: Analysis;
}

/** Thrown by a classifier to postpone a change (e.g. cost cap hit): snapshot and hash are kept. */
export class DeferChange extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeferChange';
  }
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
  cost?: CostTracker;
  /** Needed for battlecards; without it that stage is skipped. */
  llm?: Llm;
  links?: LinkBuilder;
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
  pageType: string;
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
  cost?: CostSummary;
  battlecards: BattlecardResult[];
  /** The digest Markdown, and where it is (or, in a dry run, would be) written. */
  digest: string;
  digestPath: string;
}

export async function runPipeline(
  config: Config,
  deps: RunDeps,
  opts: RunOptions = {},
): Promise<RunResult> {
  const dryRun = opts.dryRun ?? false;
  const now = deps.now ?? (() => new Date());
  const storage = dryRun ? dryRunStorage(deps.storage) : deps.storage;
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
      const base = {
        competitor: competitor.name,
        slug,
        pageId,
        pageType: page.type,
        url: page.url,
        keywordHits: [],
      };
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

      let decision: Classification | null;
      try {
        decision = deps.classify
          ? await deps.classify({
              competitor: competitor.name,
              slug,
              pageId,
              page,
              diff,
              keywordHits,
              diffText: common.diffText,
            })
          : null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof DeferChange) {
          outcomes.push({ ...common, status: 'deferred', detail: message });
        } else {
          // One failing item never fails the run; old snapshot and hash are kept.
          const entry = state.pages[key];
          if (entry) {
            entry.last_status = 'error';
            entry.last_error = message;
          }
          outcomes.push({ ...common, status: 'error', detail: `LLM stage failed: ${message}` });
        }
        continue;
      }
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

  const when = now();
  const battlecards = deps.llm
    ? await runBattlecardStage({
        config,
        storage,
        llm: deps.llm,
        outcomes,
        now: when,
        only: opts.only,
      })
    : [];

  const date = when.toISOString().slice(0, 10);
  const cost = deps.cost?.summary();
  const digest = buildDigest({
    date,
    outcomes,
    battlecards,
    config,
    state,
    links: deps.links ?? localLinks,
    cost,
  });
  const digestPath = await nextDigestPath(storage, date);
  await storage.write(digestPath, digest);

  if (!dryRun) {
    state.last_run = when.toISOString();
    await saveState(deps.storage, state);
  }
  return { outcomes, state, dryRun, cost, battlecards, digest, digestPath };
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
    const a = o.classification?.analysis;
    if (a) {
      lines.push(
        `    What changed: ${a.what_changed}`,
        `    Why it matters: ${a.why_it_matters}`,
        `    Impact on us: ${a.impact_on_us}`,
        `    Suggested response: ${a.suggested_response} (confidence: ${a.confidence})`,
      );
    }
  }
  if (result.cost) lines.push('', formatCost(result.cost));
  return lines.join('\n');
}
