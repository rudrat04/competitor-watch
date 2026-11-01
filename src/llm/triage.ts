import type { KeywordHit } from '../diff/keywords.js';
import { describeHit } from '../diff/keywords.js';
import type { Llm } from './client.js';
import { fence, limitDiff, loadPrompt } from './prompts.js';
import { triageSchema, type Triage } from './schemas.js';

export interface ChangeFacts {
  competitor: string;
  pageType: string;
  url: string;
  diffText: string;
  keywordHits: KeywordHit[];
}

export function describeChange(f: ChangeFacts): string {
  const lines = [`Competitor: ${f.competitor}`, `Page type: ${f.pageType}`, `URL: ${f.url}`];
  if (f.keywordHits.length > 0) lines.push(...f.keywordHits.map(describeHit));
  return lines.join('\n');
}

export function buildTriageMessage(f: ChangeFacts): string {
  return `${describeChange(f)}\n\n${fence('diff', limitDiff(f.diffText))}`;
}

/** Fast-model classification: noise / minor / material, plus category and a summary. */
export function triage(llm: Llm, facts: ChangeFacts): Promise<Triage> {
  return llm.callJson({
    role: 'triage',
    system: loadPrompt('triage'),
    user: buildTriageMessage(facts),
    schema: triageSchema,
    maxTokens: 2048,
    effort: 'low',
  });
}
