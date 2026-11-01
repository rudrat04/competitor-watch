import { ConfigError, type Config } from './config.js';
import { DEFAULT_MODELS, DEFAULT_PRICES, type Price } from './llm/defaults.js';

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface CostSummary {
  spentUsd: number;
  capUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  capHit: boolean;
}

export type Models = { triage: string; analysis: string };
export type PriceTable = Record<string, Price>;

/** Models in use (config overrides defaults) and their prices; throws if a price is unknown. */
export function resolveModelsAndPrices(config: Config): { models: Models; prices: PriceTable } {
  const m = config.settings.models;
  const models: Models = {
    triage: m.triage || DEFAULT_MODELS.triage,
    analysis: m.analysis || DEFAULT_MODELS.analysis,
  };
  const prices: PriceTable = { ...DEFAULT_PRICES, ...config.settings.prices };
  for (const id of new Set(Object.values(models))) {
    if (!prices[id]) {
      throw new ConfigError(
        `No price known for model "${id}". Add it under settings.prices in competitors.yaml ` +
          `(input_per_mtok / output_per_mtok) so the cost cap can work.`,
      );
    }
  }
  return { models, prices };
}

/** Rough token estimate (~3 chars/token, deliberately on the high side). */
export const estimateTokens = (chars: number): number => Math.ceil(chars / 3);

export class CostTracker {
  spentUsd = 0;
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;
  capHit = false;

  constructor(
    readonly capUsd: number,
    private readonly prices: PriceTable,
  ) {}

  private price(model: string): Price {
    const p = this.prices[model];
    if (!p) throw new Error(`No price known for model "${model}"`);
    return p;
  }

  /** Worst case for one call: estimated input plus the full `maxTokens` of output. */
  estimate(model: string, inputChars: number, maxTokens: number): number {
    const p = this.price(model);
    return (
      (estimateTokens(inputChars) * p.input_per_mtok + maxTokens * p.output_per_mtok) / 1_000_000
    );
  }

  /** False (and remembers the cap was hit) if the call could push the run over the cap. */
  canAfford(estimateUsd: number): boolean {
    if (this.spentUsd + estimateUsd > this.capUsd) {
      this.capHit = true;
      return false;
    }
    return true;
  }

  record(model: string, usage: Usage): number {
    const p = this.price(model);
    const cost =
      (usage.input_tokens * p.input_per_mtok + usage.output_tokens * p.output_per_mtok) / 1_000_000;
    this.spentUsd += cost;
    this.calls += 1;
    this.inputTokens += usage.input_tokens;
    this.outputTokens += usage.output_tokens;
    return cost;
  }

  summary(): CostSummary {
    return {
      spentUsd: this.spentUsd,
      capUsd: this.capUsd,
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      capHit: this.capHit,
    };
  }
}

export function formatCost(s: CostSummary): string {
  const base = `Cost: $${s.spentUsd.toFixed(4)} of $${s.capUsd.toFixed(2)} cap (${s.calls} LLM calls, ${s.inputTokens} in / ${s.outputTokens} out tokens)`;
  return s.capHit ? `${base} — COST CAP HIT: remaining changes will be picked up next run` : base;
}
