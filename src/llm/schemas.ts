import { z } from 'zod';

/** Every LLM output is parsed against one of these (PLAN.md §3, §7.4, §7.5). */
export const triageSchema = z.object({
  significance: z.enum(['noise', 'minor', 'material']),
  category: z.enum([
    'pricing',
    'packaging',
    'feature',
    'positioning',
    'hiring',
    'partnership',
    'other',
  ]),
  summary: z.string().min(1),
});
export type Triage = z.infer<typeof triageSchema>;

export const analysisSchema = z.object({
  what_changed: z.string().min(1),
  why_it_matters: z.string().min(1),
  impact_on_us: z.string().min(1),
  suggested_response: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type Analysis = z.infer<typeof analysisSchema>;

/** JSON Schema for the API's structured-output constraint. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete out.$schema;
  return out;
}

/** Battlecard creation: the five sections the model writes ("Recent changes" is code-built). */
export const battlecardCreateSchema = z.object({
  overview: z.string().min(1),
  pricing: z.string().min(1),
  positioning: z.string().min(1),
  strengths: z.string().min(1),
  handling: z.string().min(1),
});
export type BattlecardCreate = z.infer<typeof battlecardCreateSchema>;

/** Battlecard update: new text for affected sections only; null = leave untouched. */
export const battlecardUpdateSchema = z.object({
  overview: z.string().min(1).nullable(),
  pricing: z.string().min(1).nullable(),
  positioning: z.string().min(1).nullable(),
  strengths: z.string().min(1).nullable(),
  handling: z.string().min(1).nullable(),
});
export type BattlecardUpdate = z.infer<typeof battlecardUpdateSchema>;
