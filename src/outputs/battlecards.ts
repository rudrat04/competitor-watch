import { slugify, type CompetitorConfig, type Config } from '../config.js';
import { pageIdsFor, snapshotPath } from '../snapshot/state.js';
import type { Storage } from '../storage/storage.js';
import { CapReachedError, type Llm } from '../llm/client.js';
import {
  CardError,
  mergeRecent,
  recentEntries,
  renderCard,
  updateCard,
} from '../llm/battlecard-doc.js';
import {
  createBattlecard,
  proposeBattlecardUpdate,
  type ChangeNote,
  type SnapshotInput,
} from '../llm/battlecard.js';
import type { PageOutcome } from '../run.js';

export const battlecardPath = (slug: string): string => `battlecards/${slug}.md`;

export interface BattlecardResult {
  slug: string;
  competitor: string;
  action: 'created' | 'updated' | 'failed' | 'skipped';
  detail?: string;
}

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

async function readSnapshots(
  storage: Storage,
  competitor: CompetitorConfig,
): Promise<SnapshotInput[]> {
  const slug = slugify(competitor.name);
  const ids = pageIdsFor(competitor);
  const out: SnapshotInput[] = [];
  for (const [i, page] of competitor.pages.entries()) {
    const md = await storage.read(snapshotPath(slug, ids[i] ?? page.type));
    if (md) out.push({ pageType: page.type, url: page.url, markdown: md });
  }
  return out;
}

/** One dated "Recent changes" line per minor/material change. */
export function recentEntry(o: PageOutcome, date: string): string {
  const c = o.classification;
  const text = oneLine(c?.analysis?.what_changed ?? c?.summary ?? 'Page changed.');
  const tag = [o.status, c?.category].filter(Boolean).join(' · ');
  return `- **${date}** — [${tag}] ${text} ([${o.pageType}](${o.url}))`;
}

function changeNotes(outcomes: PageOutcome[]): ChangeNote[] {
  return outcomes.map((o) => ({
    pageType: o.pageType,
    url: o.url,
    significance: o.status as 'minor' | 'material',
    category: o.classification?.category,
    summary: o.classification?.summary,
    analysis: o.classification?.analysis,
    diffText: o.diffText,
  }));
}

/** Failures never stop the run: cap -> skipped, anything else -> failed (old card kept). */
function failure(competitor: string, slug: string, err: unknown, what: string): BattlecardResult {
  if (err instanceof CapReachedError) {
    return { slug, competitor, action: 'skipped', detail: `${what} skipped: ${err.message}` };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { slug, competitor, action: 'failed', detail: `${what} failed: ${msg}` };
}

export interface BattlecardStageInput {
  config: Config;
  storage: Storage;
  llm: Llm;
  outcomes: PageOutcome[];
  now: Date;
  /** Only this competitor slug, if the run was limited. */
  only?: string;
}

/**
 * PLAN.md §7: a competitor with snapshots but no battlecard gets one created; a competitor
 * with minor/material changes gets its battlecard updated (one call per competitor).
 */
export async function runBattlecardStage(input: BattlecardStageInput): Promise<BattlecardResult[]> {
  const { config, storage, llm, outcomes } = input;
  const date = dateOnly(input.now);
  const results: BattlecardResult[] = [];

  for (const competitor of config.competitors) {
    const slug = slugify(competitor.name);
    if (input.only && input.only !== slug) continue;
    const path = battlecardPath(slug);
    const existing = await storage.read(path);
    const changes = outcomes.filter(
      (o) => o.slug === slug && (o.status === 'minor' || o.status === 'material'),
    );
    const entries = changes.map((o) => recentEntry(o, date));

    if (existing === null) {
      const snapshots = await readSnapshots(storage, competitor);
      if (snapshots.length === 0) continue;
      try {
        const content = await createBattlecard(llm, config.company, competitor.name, snapshots);
        await storage.write(path, renderCard(competitor.name, content, entries, date));
        results.push({ slug, competitor: competitor.name, action: 'created' });
      } catch (err) {
        results.push(failure(competitor.name, slug, err, 'battlecard creation'));
      }
      continue;
    }

    if (changes.length === 0) continue;
    try {
      const update = await proposeBattlecardUpdate(
        llm,
        config.company,
        competitor.name,
        existing,
        changeNotes(changes),
      );
      // updateCard validates the layout; on failure the old card stays as it was.
      await storage.write(path, updateCard(existing, update, entries, date));
      results.push({ slug, competitor: competitor.name, action: 'updated' });
    } catch (err) {
      const r = failure(competitor.name, slug, err, 'battlecard update');
      if (err instanceof CardError)
        r.detail = `battlecard update failed: ${err.message}; kept the old battlecard (use "battlecard ${slug} --rebuild" to regenerate it)`;
      results.push(r);
    }
  }
  return results;
}

/**
 * `battlecard <slug> --rebuild`: regenerate all model-written sections from the current
 * snapshots. The "Recent changes" log can't be re-derived, so an existing one is carried over.
 */
export async function rebuildBattlecard(input: {
  config: Config;
  storage: Storage;
  llm: Llm;
  slug: string;
  now: Date;
}): Promise<string> {
  const competitor = input.config.competitors.find((c) => slugify(c.name) === input.slug);
  if (!competitor) throw new Error(`No competitor with slug "${input.slug}"`);
  const snapshots = await readSnapshots(input.storage, competitor);
  if (snapshots.length === 0) {
    throw new Error(`No snapshots for "${input.slug}" yet. Run "outflank run" first.`);
  }
  const path = battlecardPath(input.slug);
  const old = await input.storage.read(path);
  let carried: string[] = [];
  if (old) {
    try {
      carried = recentEntries(old);
    } catch {
      // A damaged old card is exactly why you rebuild; start the log fresh.
    }
  }
  const content = await createBattlecard(
    input.llm,
    input.config.company,
    competitor.name,
    snapshots,
  );
  const card = renderCard(competitor.name, content, mergeRecent([], carried), dateOnly(input.now));
  await input.storage.write(path, card);
  return card;
}
