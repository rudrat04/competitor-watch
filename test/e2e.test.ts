import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { CostTracker } from '../src/cost.js';
import { sectionBody, recentEntries } from '../src/llm/battlecard-doc.js';
import { createClassifier } from '../src/llm/classify.js';
import { createLlm, type MessagesApi } from '../src/llm/client.js';
import { DEFAULT_MODELS, DEFAULT_PRICES } from '../src/llm/defaults.js';
import { runPipeline } from '../src/run.js';
import { FilesystemStorage } from '../src/storage/filesystem.js';
import { fixture, testFetcher } from './helpers.js';

const P = 'https://rival.io/pricing';
const H = 'https://other.io/';
const home =
  '<html><body><main><h1>Other Co</h1><p>We build lovely things for people who like lovely things.</p></main></body></html>';

const config = parseConfig(`
company: {name: Acme, description: Anvils for everyone, positioning: Cheapest}
settings: {max_cost_usd: 1}
competitors:
  - name: Rival
    pages:
      - {type: pricing, url: "${P}"}
  - name: Other Co
    pages:
      - {type: homepage, url: "${H}"}
`);

/** A scripted Anthropic: answers by which prompt it was given. */
function fakeAnthropic() {
  const seen: string[] = [];
  const reply = (obj: unknown) => ({
    content: [{ type: 'text', text: JSON.stringify(obj) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 800, output_tokens: 200 },
  });
  const api = {
    create: async (p: { system: string; model: string }) => {
      if (p.system.includes('You triage')) {
        seen.push('triage');
        return reply({
          significance: 'material',
          category: 'pricing',
          summary: 'Pro rose to $45 and an Enterprise plan appeared.',
        });
      }
      if (p.system.includes('competitive-intelligence analyst')) {
        seen.push('analysis');
        return reply({
          what_changed: 'Pro went from $30 to $45 and Enterprise was added.',
          why_it_matters: 'Likely moving upmarket (speculation).',
          impact_on_us: 'Our price now looks better.',
          suggested_response: 'Sales: lead with price.',
          confidence: 'high',
        });
      }
      if (p.system.includes('write competitive battlecards')) {
        seen.push('create');
        return reply({
          overview: 'Sells things.',
          pricing: '- Starter $10\n- Pro $30',
          positioning: 'Simple.',
          strengths: 'Brand.',
          handling: 'Lead with price.',
        });
      }
      if (p.system.includes('keep a competitor battlecard current')) {
        seen.push('update');
        return reply({
          overview: null,
          pricing: '- Starter $10\n- Pro $45\n- Enterprise (custom)',
          positioning: null,
          strengths: null,
          handling: null,
        });
      }
      throw new Error('unexpected prompt');
    },
  } as unknown as MessagesApi;
  return { api, seen };
}

describe('end to end: run against fixtures with a mocked LLM', () => {
  it('baseline, then a material change, then a quiet run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-e2e-'));
    const storage = new FilesystemStorage(dir);
    const read = (p: string) => readFileSync(join(dir, p), 'utf8');
    const tree = () =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
        .sort();

    async function go(pages: Record<string, string>, when: string, dryRun = false) {
      const ai = fakeAnthropic();
      const cost = new CostTracker(1, DEFAULT_PRICES);
      const llm = createLlm({ api: ai.api, tracker: cost, models: { ...DEFAULT_MODELS } });
      const { fetcher } = testFetcher(
        Object.fromEntries(Object.entries(pages).map(([u, b]) => [u, { body: b }])),
      );
      const result = await runPipeline(
        config,
        {
          fetcher,
          storage,
          llm,
          cost,
          classify: createClassifier({
            llm,
            company: config.company,
            getBattlecard: (s) => storage.read(`battlecards/${s}.md`),
          }),
          now: () => new Date(when),
        },
        { dryRun },
      );
      return { result, calls: ai.seen };
    }

    // --- Run 1: baseline ---
    const r1 = await go({ [P]: fixture('pricing-before.html'), [H]: home }, '2026-11-02T03:17:00Z');
    expect(r1.result.outcomes.map((o) => o.status)).toEqual(['baseline', 'baseline']);
    expect(r1.calls).toEqual(['create', 'create']);
    expect(tree()).toEqual([
      'battlecards/other-co.md',
      'battlecards/rival.md',
      'digests/2026-11-02.md',
      'snapshots/other-co/homepage.md',
      'snapshots/rival/pricing.md',
      'state.json',
    ]);
    expect(read('digests/2026-11-02.md')).toContain(
      '**Baseline created for 2 competitors, 2 pages**',
    );
    expect(read('digests/2026-11-02.md')).toContain('[Rival](../battlecards/rival.md)');
    expect(read('battlecards/rival.md')).toContain('# Rival — Battlecard');
    expect(JSON.parse(read('state.json'))).toMatchObject({
      schema_version: 1,
      last_run: '2026-11-02T03:17:00.000Z',
    });

    // --- Run 2: pricing changed ---
    const priorOther = read('battlecards/other-co.md');
    const r2 = await go({ [P]: fixture('pricing-after.html'), [H]: home }, '2026-11-09T03:17:00Z');
    expect(r2.result.outcomes.map((o) => o.status)).toEqual(['material', 'unchanged']);
    expect(r2.calls).toEqual(['triage', 'analysis', 'update']);
    expect(read('snapshots/rival/pricing.md')).toContain('$45');
    const state2 = JSON.parse(read('state.json'));
    expect(state2.pages['rival/pricing']).toMatchObject({
      last_status: 'material',
      last_error: null,
    });
    expect(state2.pages['other-co/homepage'].last_status).toBe('unchanged');
    const card = read('battlecards/rival.md');
    expect(sectionBody(card, 'pricing')).toContain('Pro $45');
    expect(sectionBody(card, 'overview')).toBe('Sells things.'); // untouched
    expect(recentEntries(card)).toHaveLength(1);
    expect(read('battlecards/other-co.md')).toBe(priorOther); // other competitor untouched
    const d2 = read('digests/2026-11-09.md');
    expect(d2).toContain('**1 material change across 1 competitor**');
    expect(d2).toContain('**What changed:** Pro went from $30 to $45 and Enterprise was added.');
    expect(d2).toMatch(/Cost: \$0\.\d+ of \$1\.00 cap/);

    // --- Run 3: same day, nothing changed -> second digest, no LLM calls ---
    const r3 = await go({ [P]: fixture('pricing-after.html'), [H]: home }, '2026-11-09T15:00:00Z');
    expect(r3.calls).toEqual([]);
    expect(r3.result.outcomes.map((o) => o.status)).toEqual(['unchanged', 'unchanged']);
    expect(tree()).toContain('digests/2026-11-09-2.md');
    expect(read('digests/2026-11-09-2.md')).toContain('**No meaningful changes**');

    // --- Dry run on a changed page: LLM runs, but nothing is written ---
    const before = Object.fromEntries(tree().map((f) => [f, read(f)]));
    const r4 = await go(
      { [P]: fixture('pricing-after.html').replace('$45', '$60'), [H]: home },
      '2026-11-16T03:17:00Z',
      true,
    );
    expect(r4.calls).toEqual(['triage', 'analysis', 'update']);
    expect(r4.result.digest).toContain('1 material change');
    expect(r4.result.digestPath).toBe('digests/2026-11-16.md');
    expect(Object.fromEntries(tree().map((f) => [f, read(f)]))).toEqual(before);
  });
});
