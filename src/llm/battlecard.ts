import type { Llm } from './client.js';
import type { CompanyInfo } from './analyze.js';
import type { LlmSectionKey, CardContent } from './battlecard-doc.js';
import { fence, limitDiff, loadPrompt } from './prompts.js';
import {
  battlecardCreateSchema,
  battlecardUpdateSchema,
  type Analysis,
  type BattlecardCreate,
  type BattlecardUpdate,
} from './schemas.js';

const MAX_SNAPSHOT_CHARS = 12_000;
const MAX_TOTAL_SNAPSHOT_CHARS = 40_000;
const MAX_CHANGE_DIFF_CHARS = 6_000;

export interface SnapshotInput {
  pageType: string;
  url: string;
  markdown: string;
}

export interface ChangeNote {
  pageType: string;
  url: string;
  significance: 'minor' | 'material';
  category?: string;
  summary?: string;
  analysis?: Analysis;
  diffText?: string;
}

function companyBlock(c: CompanyInfo): string {
  const lines = [`Name: ${c.name}`, `Description: ${c.description}`];
  if (c.positioning) lines.push(`Positioning: ${c.positioning}`);
  return fence('company', lines.join('\n'));
}

/** Cut text with an explicit marker (never silently). */
function limitText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[page text truncated: ${text.length - max} more characters not shown]`;
}

export function buildCreateMessage(
  company: CompanyInfo,
  competitor: string,
  snapshots: SnapshotInput[],
): string {
  let budget = MAX_TOTAL_SNAPSHOT_CHARS;
  const pages = snapshots.map((s) => {
    const text = limitText(s.markdown, Math.min(MAX_SNAPSHOT_CHARS, Math.max(budget, 0)));
    budget -= text.length;
    return fence('page', `Type: ${s.pageType}\nURL: ${s.url}\n\n${text}`);
  });
  return [companyBlock(company), `Competitor: ${competitor}`, ...pages].join('\n\n');
}

export function buildUpdateMessage(
  company: CompanyInfo,
  competitor: string,
  card: string,
  changes: ChangeNote[],
): string {
  const items = changes.map((c, i) => {
    const lines = [
      `Change ${i + 1}: ${c.significance}${c.category ? ` / ${c.category}` : ''} on ${c.pageType} page`,
      `URL: ${c.url}`,
    ];
    if (c.summary) lines.push(`Summary: ${c.summary}`);
    if (c.analysis) {
      lines.push(
        `What changed: ${c.analysis.what_changed}`,
        `Why it matters: ${c.analysis.why_it_matters}`,
      );
    }
    if (c.diffText) lines.push(fence('diff', limitDiff(c.diffText, MAX_CHANGE_DIFF_CHARS)));
    return lines.join('\n');
  });
  return [
    companyBlock(company),
    `Competitor: ${competitor}`,
    fence('battlecard', card),
    ...items,
  ].join('\n\n');
}

export function createBattlecard(
  llm: Llm,
  company: CompanyInfo,
  competitor: string,
  snapshots: SnapshotInput[],
): Promise<BattlecardCreate> {
  return llm.callJson({
    role: 'analysis',
    system: loadPrompt('battlecard-create'),
    user: buildCreateMessage(company, competitor, snapshots),
    schema: battlecardCreateSchema,
    maxTokens: 8192,
    effort: 'medium',
  });
}

export function proposeBattlecardUpdate(
  llm: Llm,
  company: CompanyInfo,
  competitor: string,
  card: string,
  changes: ChangeNote[],
): Promise<BattlecardUpdate> {
  return llm.callJson({
    role: 'analysis',
    system: loadPrompt('battlecard-update'),
    user: buildUpdateMessage(company, competitor, card, changes),
    schema: battlecardUpdateSchema,
    maxTokens: 8192,
    effort: 'medium',
  });
}

export type { CardContent, LlmSectionKey };
