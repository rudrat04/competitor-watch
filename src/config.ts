import { readFile } from 'node:fs/promises';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';

export const PLACEHOLDER_COMPANY_NAME = 'YOUR COMPANY';

export const PAGE_TYPES = [
  'pricing',
  'changelog',
  'homepage',
  'careers',
  'product',
  'blog',
  'other',
] as const;

const keywordList = z.array(z.string().trim().min(1, 'keywords must be non-empty strings'));
const selectorList = z.array(z.string().trim().min(1, 'selectors must be non-empty strings'));

const httpUrl = z
  .string()
  .url('must be a valid URL')
  .refine((u) => /^https?:\/\//i.test(u), 'must start with http:// or https://');

const pageSchema = z
  .object({
    type: z.enum(PAGE_TYPES),
    url: httpUrl,
    include: selectorList.optional(),
    ignore: selectorList.optional(),
    alert_on: keywordList.optional(),
    render: z.boolean().default(false),
  })
  .strict();

const competitorSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required'),
    pages: z.array(pageSchema).min(1, 'each competitor needs at least one page'),
  })
  .strict();

const settingsSchema = z
  .object({
    max_cost_usd: z.number().positive().default(1.0),
    alert_on: keywordList.default([]),
    min_change_chars: z.number().int().nonnegative().default(40),
    allow_public_repo: z.boolean().default(false),
    models: z
      .object({
        triage: z.string().default(''),
        analysis: z.string().default(''),
      })
      .strict()
      .default({ triage: '', analysis: '' }),
    notify: z
      .object({
        github_issue: z.boolean().default(true),
        slack: z.boolean().default(false),
        discord: z.boolean().default(false),
      })
      .strict()
      .default({ github_issue: true, slack: false, discord: false }),
  })
  .strict();

const configSchema = z
  .object({
    company: z
      .object({
        name: z.string().trim().min(1, 'name is required'),
        description: z.string().trim().min(1, 'description is required'),
        positioning: z.string().optional(),
      })
      .strict(),
    settings: settingsSchema.default(settingsSchema.parse({})),
    competitors: z.array(competitorSchema).min(1, 'add at least one competitor'),
  })
  .strict();

export type Config = z.infer<typeof configSchema>;
export type PageConfig = z.infer<typeof pageSchema>;
export type CompetitorConfig = z.infer<typeof competitorSchema>;

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** "Example Competitor" -> "example-competitor". */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatIssue(issue: z.ZodIssue): string {
  const path = issue.path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join('');
  return `${path || '(root)'}: ${issue.message}`;
}

/** Parse + validate YAML text. Throws ConfigError with field-specific messages. */
export function parseConfig(text: string): Config {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    const msg = err instanceof YAMLParseError ? err.message : String(err);
    throw new ConfigError(`competitors.yaml is not valid YAML: ${msg}`);
  }
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(formatIssue);
    throw new ConfigError(`Invalid competitors.yaml:\n  - ${issues.join('\n  - ')}`, issues);
  }
  const config = result.data;

  const issues: string[] = [];
  const seen = new Map<string, string>();
  config.competitors.forEach((c, i) => {
    const slug = slugify(c.name);
    if (!slug) {
      issues.push(
        `competitors[${i}].name: "${c.name}" has no letters or digits to build an id from`,
      );
    } else if (seen.has(slug)) {
      issues.push(
        `competitors[${i}].name: "${c.name}" has the same id ("${slug}") as "${seen.get(slug)}"`,
      );
    } else {
      seen.set(slug, c.name);
    }
  });
  if (issues.length > 0) {
    throw new ConfigError(`Invalid competitors.yaml:\n  - ${issues.join('\n  - ')}`, issues);
  }
  return config;
}

export async function loadConfig(path: string): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ConfigError(`${path} not found. Run "competitor-watch init" to create one.`);
    }
    throw err;
  }
  return parseConfig(text);
}

function isExampleHost(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return host === 'example.com' || host.endsWith('.example.com');
}

/** Why the config is still the placeholder, or null if it has been filled in (PLAN.md §6). */
export function notConfiguredReason(config: Config): string | null {
  if (config.company.name.trim() === PLACEHOLDER_COMPANY_NAME) {
    return `company.name is still "${PLACEHOLDER_COMPANY_NAME}"`;
  }
  for (const c of config.competitors) {
    for (const p of c.pages) {
      if (isExampleHost(p.url)) return `${p.url} is an example.com placeholder URL`;
    }
  }
  return null;
}

export const NOT_CONFIGURED_MESSAGE = 'Not configured yet — edit competitors.yaml';
