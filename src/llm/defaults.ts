/**
 * Default model IDs and per-token prices (PLAN.md §3, §7.9).
 *
 * >>> UPDATE HERE when Anthropic releases new models or changes prices <<<
 * Check https://platform.claude.com/docs/en/about-claude/models for current IDs and
 * https://claude.com/pricing for prices. Users can override model IDs and prices in
 * competitors.yaml (settings.models, settings.prices) without waiting for a release.
 */
export const DEFAULT_MODELS = {
  /** Fast and cheap: classifies every change that survives the deterministic filters. */
  triage: 'claude-haiku-5-5',
  /** Stronger: analyzes only material changes (and, from M5, writes battlecards). */
  analysis: 'claude-opus-5-5',
} as const;

export interface Price {
  /** USD per 1M input tokens. */
  input_per_mtok: number;
  /** USD per 1M output tokens (thinking tokens are billed as output). */
  output_per_mtok: number;
}

/** Standard (non-cached, non-batch) prices. Haiku's price is for prompts up to 100K tokens. */
export const DEFAULT_PRICES: Record<string, Price> = {
  'claude-haiku-5-5': { input_per_mtok: 0.1, output_per_mtok: 0.5 },
  'claude-opus-5-5': { input_per_mtok: 4, output_per_mtok: 20 },
};

/** Max diff text sent to a model; longer diffs are cut with an explicit marker. */
export const MAX_DIFF_CHARS = 20_000;
