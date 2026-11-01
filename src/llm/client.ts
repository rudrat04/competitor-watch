import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { CostTracker, type Models } from '../cost.js';
import { toJsonSchema } from './schemas.js';

export type Role = 'triage' | 'analysis';

/** The one method of the SDK we use; lets tests pass a mock. */
export interface MessagesApi {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

/** The run's cost cap would be exceeded by this call, so it was not made. */
export class CapReachedError extends Error {
  constructor(readonly estimateUsd: number) {
    super(`cost cap reached (next call would cost up to ~$${estimateUsd.toFixed(4)})`);
    this.name = 'CapReachedError';
  }
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface JsonCall<T> {
  role: Role;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  effort: 'low' | 'medium' | 'high';
}

export interface Llm {
  /**
   * One structured call. Output is validated against `schema`; on a parse failure the call
   * is retried once, then LlmError. Throws CapReachedError before spending if over the cap.
   */
  callJson<T>(call: JsonCall<T>): Promise<T>;
}

export function createLlm(deps: { api: MessagesApi; tracker: CostTracker; models: Models }): Llm {
  const { api, tracker, models } = deps;

  async function once<T>(
    call: JsonCall<T>,
  ): Promise<{ ok: true; data: T } | { ok: false; why: string }> {
    const model = models[call.role];
    const estimate = tracker.estimate(model, call.system.length + call.user.length, call.maxTokens);
    if (!tracker.canAfford(estimate)) throw new CapReachedError(estimate);

    // No temperature/top_p, no forced tool_choice, no thinking param: the current models
    // reject these. Depth is controlled with output_config.effort.
    const res = await api.create({
      model,
      max_tokens: call.maxTokens,
      system: call.system,
      messages: [{ role: 'user', content: call.user }],
      output_config: {
        effort: call.effort,
        format: { type: 'json_schema', schema: toJsonSchema(call.schema) },
      },
    });
    tracker.record(model, res.usage);

    if (res.stop_reason === 'refusal') {
      const category = res.stop_details?.category;
      throw new LlmError(`model declined the request${category ? ` (${category})` : ''}`);
    }
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    if (res.stop_reason === 'max_tokens') {
      return { ok: false, why: 'response was cut off at max_tokens' };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, why: 'response was not valid JSON' };
    }
    const parsed = call.schema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        why: `response failed validation: ${issue?.path.join('.')} ${issue?.message}`,
      };
    }
    return { ok: true, data: parsed.data };
  }

  return {
    async callJson<T>(call: JsonCall<T>): Promise<T> {
      const first = await once(call);
      if (first.ok) return first.data;
      const second = await once(call); // retry once on parse failure
      if (second.ok) return second.data;
      throw new LlmError(`${second.why} (after 2 attempts)`);
    },
  };
}
