import { DeferChange, type Classify } from '../run.js';
import { analyze, type CompanyInfo } from './analyze.js';
import { CapReachedError, type Llm } from './client.js';
import { triage } from './triage.js';

export interface ClassifierDeps {
  llm: Llm;
  company: CompanyInfo;
  /** Current battlecard for a competitor slug (M5 supplies the real one). */
  getBattlecard?: (slug: string) => Promise<string | null>;
}

/**
 * The LLM stage of the pipeline (PLAN.md §7): triage every change that reaches it; a keyword
 * hit forces material; material changes are analyzed. Hitting the cost cap defers the page
 * (its snapshot and hash stay as they were); any other failure surfaces as that page's error.
 */
export function createClassifier(deps: ClassifierDeps): Classify {
  return async (input) => {
    const facts = {
      competitor: input.competitor,
      pageType: input.page.type,
      url: input.page.url,
      diffText: input.diffText,
      keywordHits: input.keywordHits,
    };
    try {
      const t = await triage(deps.llm, facts);
      const significance = input.keywordHits.length > 0 ? 'material' : t.significance;
      if (significance !== 'material') {
        return { significance, category: t.category, summary: t.summary };
      }
      const battlecard = (await deps.getBattlecard?.(input.slug)) ?? null;
      const analysis = await analyze(deps.llm, {
        ...facts,
        company: deps.company,
        triage: t,
        battlecard,
      });
      return { significance, category: t.category, summary: t.summary, analysis };
    } catch (err) {
      if (err instanceof CapReachedError) {
        throw new DeferChange(`${err.message}; will be retried next run`);
      }
      throw err;
    }
  };
}
