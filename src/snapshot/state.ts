import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CompetitorConfig } from '../config.js';
import type { Storage } from '../storage/storage.js';

export const STATE_PATH = 'state.json';
export const STATE_SCHEMA_VERSION = 1;

export const PAGE_STATUSES = [
  'ok',
  'unchanged',
  'trivial',
  'noise',
  'minor',
  'material',
  'baseline',
  'error',
  'blocked',
] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

const pageStateSchema = z.object({
  url: z.string(),
  hash: z.string().nullable(),
  last_checked: z.string().nullable(),
  last_changed: z.string().nullable(),
  last_status: z.enum(PAGE_STATUSES),
  last_error: z.string().nullable(),
});

const stateSchema = z.object({
  schema_version: z.literal(STATE_SCHEMA_VERSION),
  last_run: z.string().nullable(),
  pages: z.record(z.string(), pageStateSchema),
});

export type PageState = z.infer<typeof pageStateSchema>;
export type State = z.infer<typeof stateSchema>;

export function emptyState(): State {
  return { schema_version: STATE_SCHEMA_VERSION, last_run: null, pages: {} };
}

export async function loadState(storage: Storage): Promise<State> {
  const raw = await storage.read(STATE_PATH);
  if (raw === null) return emptyState();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${STATE_PATH} is not valid JSON. Restore it from git history.`);
  }
  const version = (json as { schema_version?: unknown } | null)?.schema_version;
  if (version !== STATE_SCHEMA_VERSION) {
    throw new Error(
      `${STATE_PATH} has schema_version ${String(version)}, but this version of outflank ` +
        `expects ${STATE_SCHEMA_VERSION}. See the migration notes in the README.`,
    );
  }
  const parsed = stateSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${STATE_PATH} is malformed: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}

export async function saveState(storage: Storage, state: State): Promise<void> {
  await storage.write(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Stable page ids for one competitor (PLAN.md §5): `<type>` if that type is unique
 * among the competitor's pages, else `<type>-<8-char hash of URL>`. Result is aligned
 * with `competitor.pages`.
 */
export function pageIdsFor(competitor: CompetitorConfig): string[] {
  const counts = new Map<string, number>();
  for (const p of competitor.pages) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  return competitor.pages.map((p) =>
    counts.get(p.type) === 1 ? p.type : `${p.type}-${sha256(p.url).slice(0, 8)}`,
  );
}

export const pageKey = (slug: string, pageId: string): string => `${slug}/${pageId}`;
export const snapshotPath = (slug: string, pageId: string): string =>
  `snapshots/${slug}/${pageId}.md`;
