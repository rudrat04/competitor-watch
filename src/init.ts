import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Kept identical to competitors.example.yaml by a test. */
export const EXAMPLE_CONFIG = `company:
  name: 'YOUR COMPANY' # must be changed before the first run
  description: 'What you sell and to whom, in 1–3 sentences.'
  positioning: 'Why customers pick you.' # optional

settings:
  max_cost_usd: 1.00 # hard cap per run
  alert_on: [] # optional keywords watched on every page
  min_change_chars: 40 # ignore diffs smaller than this
  allow_public_repo: false # leave false unless you're sure
  models: # optional; defaults come from the engine
    triage: ''
    analysis: ''
  notify:
    github_issue: true # only works inside GitHub Actions
    slack: false # needs SLACK_WEBHOOK_URL
    discord: false # needs DISCORD_WEBHOOK_URL

competitors:
  - name: 'Example Competitor'
    pages:
      - type: pricing # pricing | changelog | homepage | careers | product | blog | other
        url: 'https://example.com/pricing'
        include: ['.pricing-table'] # optional: watch only these elements
        alert_on: ['enterprise', 'free plan'] # optional: keywords that always count as material
      - type: homepage
        url: 'https://example.com'
        ignore: ['.testimonial-carousel'] # optional CSS selectors to strip
      - type: pricing
        url: 'https://example.com/plans'
        render: true # needs playwright; see README
`;

/** Kept identical to .env.example by a test. */
export const EXAMPLE_ENV = `ANTHROPIC_API_KEY=      # required — https://console.anthropic.com
SLACK_WEBHOOK_URL=      # optional
DISCORD_WEBHOOK_URL=    # optional
`;

export interface InitResult {
  created: string[];
  skipped: string[];
}

/** `competitor-watch init`: create competitors.yaml and .env, never overwriting either. */
export function initProject(dir: string): InitResult {
  const result: InitResult = { created: [], skipped: [] };
  for (const [name, content] of [
    ['competitors.yaml', EXAMPLE_CONFIG],
    ['.env', EXAMPLE_ENV],
  ] as const) {
    const path = join(dir, name);
    if (existsSync(path)) {
      result.skipped.push(name);
    } else {
      writeFileSync(path, content, { encoding: 'utf8', mode: name === '.env' ? 0o600 : 0o644 });
      result.created.push(name);
    }
  }
  return result;
}

export const NEXT_STEPS = `Next steps:
  1. Put your Anthropic API key in .env (https://console.anthropic.com).
  2. Edit competitors.yaml: your company, then 2-5 competitors and their page URLs.
  3. npx @rudrat04/competitor-watch check          # confirms every page is reachable
  4. npx @rudrat04/competitor-watch run --dry-run  # try it; writes nothing
  5. npx @rudrat04/competitor-watch run            # writes ./data

Tip: run "git init" here to keep the history of every change.`;
