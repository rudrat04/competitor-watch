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

/**
 * Keywords the structured-outputs API does not accept. They are stripped from the schema we
 * send; zod still enforces them on the response (and a failure triggers the one retry).
 */
const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
]);

function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (!UNSUPPORTED_KEYWORDS.has(k)) out[k] = stripUnsupported(v);
    }
    return out;
  }
  return node;
}

/** JSON Schema for the API's structured-output constraint. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return stripUnsupported(z.toJSONSchema(schema)) as Record<string, unknown>;
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
