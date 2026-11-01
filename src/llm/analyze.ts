import type { Llm } from './client.js';
import { fence, limitDiff, loadPrompt } from './prompts.js';
import { analysisSchema, type Analysis, type Triage } from './schemas.js';
import { describeChange, type ChangeFacts } from './triage.js';

export interface CompanyInfo {
  name: string;
  description: string;
  positioning?: string;
}

export interface AnalysisInput extends ChangeFacts {
  company: CompanyInfo;
  triage: Triage;
  /** The competitor's current battlecard, if one exists. */
  battlecard: string | null;
}

export function buildAnalysisMessage(i: AnalysisInput): string {
  const company = [`Name: ${i.company.name}`, `Description: ${i.company.description}`];
  if (i.company.positioning) company.push(`Positioning: ${i.company.positioning}`);
  const parts = [
    fence('company', company.join('\n')),
    describeChange(i),
    `Triage (${i.triage.category}): ${i.triage.summary}`,
    fence('diff', limitDiff(i.diffText)),
  ];
  if (i.battlecard) parts.push(fence('battlecard', i.battlecard));
  return parts.join('\n\n');
}

/** Strong-model analysis of one material change. */
export function analyze(llm: Llm, input: AnalysisInput): Promise<Analysis> {
  return llm.callJson({
    role: 'analysis',
    system: loadPrompt('analyze'),
    user: buildAnalysisMessage(input),
    schema: analysisSchema,
    maxTokens: 4096,
    effort: 'medium',
  });
}
