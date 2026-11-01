import { slugify, type Config } from '../config.js';
import { describeHit } from '../diff/keywords.js';
import { formatCost, type CostSummary } from '../cost.js';
import type { LinkBuilder } from '../github/context.js';
import { pageIdsFor, pageKey, type State } from '../snapshot/state.js';
import type { Storage } from '../storage/storage.js';
import type { PageOutcome } from '../run.js';
import type { BattlecardResult } from './battlecards.js';

export interface DigestInput {
  /** YYYY-MM-DD */
  date: string;
  outcomes: PageOutcome[];
  battlecards: BattlecardResult[];
  config: Config;
  state: State;
  links: LinkBuilder;
  cost?: CostSummary;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Pages in state.json that the config no longer lists (PLAN.md §5: files stay, digest notes). */
export function unwatchedPages(config: Config, state: State): string[] {
  const watched = new Set<string>();
  for (const c of config.competitors) {
    const slug = slugify(c.name);
    for (const id of pageIdsFor(c)) watched.add(pageKey(slug, id));
  }
  return Object.keys(state.pages)
    .filter((k) => !watched.has(k))
    .sort();
}

/** e.g. "2 material, 3 minor changes across 4 competitors" (PLAN.md §7.7). */
export function digestHeadline(outcomes: PageOutcome[]): string {
  const material = outcomes.filter((o) => o.status === 'material').length;
  const minor = outcomes.filter((o) => o.status === 'minor').length;
  if (material + minor > 0) {
    const changed = new Set(
      outcomes.filter((o) => o.status === 'material' || o.status === 'minor').map((o) => o.slug),
    );
    const parts = [material ? `${material} material` : '', minor ? `${minor} minor` : ''].filter(
      Boolean,
    );
    return `${parts.join(', ')} ${material + minor === 1 ? 'change' : 'changes'} across ${plural(changed.size, 'competitor')}`;
  }
  const baselines = outcomes.filter((o) => o.status === 'baseline');
  if (baselines.length > 0) {
    const comps = new Set(baselines.map((o) => o.slug));
    return `Baseline created for ${plural(comps.size, 'competitor')}, ${plural(baselines.length, 'page')}`;
  }
  return 'No meaningful changes';
}

/** Compact form for commit messages and titles, e.g. "2 material, 3 minor" or "baseline". */
export function shortSummary(outcomes: PageOutcome[]): string {
  const material = outcomes.filter((o) => o.status === 'material').length;
  const minor = outcomes.filter((o) => o.status === 'minor').length;
  if (material + minor > 0) {
    return [material ? `${material} material` : '', minor ? `${minor} minor` : '']
      .filter(Boolean)
      .join(', ');
  }
  if (outcomes.some((o) => o.status === 'baseline')) return 'baseline';
  return 'no changes';
}

export function buildDigest(input: DigestInput): string {
  const { outcomes, links } = input;
  const material = outcomes.filter((o) => o.status === 'material');
  const minor = outcomes.filter((o) => o.status === 'minor');
  const baselines = outcomes.filter((o) => o.status === 'baseline');
  const baselineCompetitors = new Set(baselines.map((o) => o.slug));

  const out: string[] = [`# Competitor Watch — ${input.date}`, ''];

  out.push(`**${digestHeadline(outcomes)}**`, '');

  // Baseline + battlecards
  if (baselines.length > 0 && (material.length > 0 || minor.length > 0)) {
    out.push(
      `Baseline also created for ${plural(baselineCompetitors.size, 'competitor')}, ${plural(baselines.length, 'page')}.`,
      '',
    );
  }
  const created = input.battlecards.filter((b) => b.action === 'created');
  if (created.length > 0) {
    out.push('## New battlecards', '');
    for (const b of created) out.push(`- [${b.competitor}](${links.battlecard(b.slug)})`);
    out.push('');
  }

  // Material first
  if (material.length > 0) {
    out.push('## Material changes', '');
    for (const o of material) {
      const c = o.classification;
      out.push(`### ${o.competitor} — ${o.pageType}`, '');
      if (c?.summary) out.push(`**${oneLine(c.summary)}**`, '');
      out.push(`- Page: ${o.url} · [change history](${links.snapshotHistory(o.slug, o.pageId)})`);
      for (const h of o.keywordHits) out.push(`- ${describeHit(h)}`);
      if (c?.analysis) {
        const a = c.analysis;
        out.push(
          `- **What changed:** ${oneLine(a.what_changed)}`,
          `- **Why it matters:** ${oneLine(a.why_it_matters)}`,
          `- **Impact on us:** ${oneLine(a.impact_on_us)}`,
          `- **Suggested response:** ${oneLine(a.suggested_response)} _(confidence: ${a.confidence})_`,
        );
      }
      out.push('');
    }
  }

  if (minor.length > 0) {
    out.push('## Minor changes', '');
    for (const o of minor) {
      const summary = oneLine(o.classification?.summary ?? 'Page changed.');
      out.push(
        `- **${o.competitor}** (${o.pageType}): ${summary} — [history](${links.snapshotHistory(o.slug, o.pageId)})`,
      );
    }
    out.push('');
  }

  // Needs attention
  const attention: string[] = [];
  for (const o of outcomes) {
    if (o.status === 'error')
      attention.push(
        `- ❌ **${o.competitor} / ${o.pageType}** failed: ${oneLine(o.detail ?? 'unknown error')} (${o.url}). Previous snapshot kept.`,
      );
    if (o.status === 'blocked')
      attention.push(
        `- 🚫 **${o.competitor} / ${o.pageType}** blocked: ${oneLine(o.detail ?? 'robots.txt')} (${o.url}). Skipped.`,
      );
    if (o.status === 'deferred') {
      attention.push(
        `- ⏳ **${o.competitor} / ${o.pageType}** changed but was not analyzed: ${oneLine(o.detail ?? 'deferred')}. It will be picked up next run.`,
      );
      for (const h of o.keywordHits) attention.push(`  - ${describeHit(h)}`);
    }
  }
  for (const b of input.battlecards) {
    if (b.action === 'failed' || b.action === 'skipped') {
      attention.push(`- 📇 **${b.competitor}** ${oneLine(b.detail ?? 'battlecard not updated')}`);
    }
  }
  for (const key of unwatchedPages(input.config, input.state)) {
    attention.push(`- 💤 \`${key}\` is no longer watched (its files are kept).`);
  }
  if (attention.length > 0) out.push('## Needs attention', '', ...attention, '');

  // Quiet pages
  const quiet = outcomes.filter((o) => ['unchanged', 'noise', 'trivial'].includes(o.status)).length;
  if (quiet > 0) out.push(`${plural(quiet, 'page')} checked with nothing worth reporting.`, '');

  if (input.cost) out.push(formatCost(input.cost), '');
  return out.join('\n').trimEnd() + '\n';
}

/** digests/YYYY-MM-DD.md, or -2, -3 … if earlier runs already wrote one that day. */
export async function nextDigestPath(storage: Storage, date: string): Promise<string> {
  const existing = new Set(await storage.list('digests'));
  let path = `digests/${date}.md`;
  for (let n = 2; existing.has(path); n++) path = `digests/${date}-${n}.md`;
  return path;
}
