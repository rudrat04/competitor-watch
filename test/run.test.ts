import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConfigError, parseConfig } from '../src/config.js';
import { FilesystemStorage } from '../src/storage/filesystem.js';
import { formatReport, runPipeline, type Classify } from '../src/run.js';
import { fixture, testFetcher } from './helpers.js';

const P = 'https://rival.io/pricing';
const H = 'https://rival.io/';
const NOW = () => new Date('2026-11-02T03:00:00Z');

const yaml = (extra = '') => `
company: {name: Acme, description: Anvils}
settings:
  min_change_chars: 40
${extra}
competitors:
  - name: Rival
    pages:
      - {type: pricing, url: "${P}"}
  - name: Other Co
    pages:
      - {type: homepage, url: "${H}"}
`;

function env(config = yaml()) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-run-'));
  const storage = new FilesystemStorage(dir);
  const cfg = parseConfig(config);
  const go = (
    pages: Record<string, string>,
    opts: Parameters<typeof runPipeline>[2] = {},
    classify?: Classify,
    c = cfg,
  ) => {
    const routes = Object.fromEntries(Object.entries(pages).map(([u, b]) => [u, { body: b }]));
    const { fetcher } = testFetcher(routes);
    return runPipeline(c, { fetcher, storage, classify, now: NOW }, opts);
  };
  const files = () => readdirSync(dir, { recursive: true }).map(String).sort();
  const read = (p: string) => readFileSync(join(dir, p), 'utf8');
  return { go, files, read, cfg, dir };
}

const home =
  '<html><body><main><h1>Other</h1><p>We build things for people who like things.</p></main></body></html>';
const before = fixture('pricing-before.html');
const after = fixture('pricing-after.html');
const material: Classify = async () => ({ significance: 'material', summary: 's' });

describe('runPipeline', () => {
  it('first run writes baselines and state (no LLM needed)', async () => {
    const e = env();
    const r = await e.go({ [P]: before, [H]: home });
    expect(r.outcomes.map((o) => o.status)).toEqual(['baseline', 'baseline']);
    expect(e.files()).toEqual([
      'digests',
      'digests/2026-11-02.md',
      'snapshots',
      'snapshots/other-co',
      'snapshots/other-co/homepage.md',
      'snapshots/rival',
      'snapshots/rival/pricing.md',
      'state.json',
    ]);
    expect(JSON.parse(e.read('state.json')).last_run).toBe('2026-11-02T03:00:00.000Z');
  });

  it('second run on identical pages: unchanged', async () => {
    const e = env();
    await e.go({ [P]: before, [H]: home });
    const r = await e.go({ [P]: before, [H]: home });
    expect(r.outcomes.map((o) => o.status)).toEqual(['unchanged', 'unchanged']);
  });

  it('dry-run reports a changed page but writes nothing at all', async () => {
    const e = env();
    await e.go({ [P]: before, [H]: home });
    const stateBefore = e.read('state.json');
    const snapBefore = e.read('snapshots/rival/pricing.md');
    const files = e.files();

    const classify = vi.fn(material);
    const r = await e.go({ [P]: after, [H]: home }, { dryRun: true }, classify);
    const o = r.outcomes[0]!;
    expect(o.status).toBe('material');
    expect(o.diffText).toContain('+$45 per user per month');
    expect(formatReport(r)).toMatch(/DRY RUN/);
    expect(e.read('state.json')).toBe(stateBefore);
    expect(e.read('snapshots/rival/pricing.md')).toBe(snapBefore);
    expect(e.files()).toEqual(files);
  });

  it('dry-run on a fresh data dir creates no files', async () => {
    const e = env();
    const r = await e.go({ [P]: before, [H]: home }, { dryRun: true });
    expect(r.outcomes.map((o) => o.status)).toEqual(['baseline', 'baseline']);
    expect(e.files()).toEqual([]);
  });

  it('with no classifier, a changed page is deferred and its snapshot and hash are kept', async () => {
    const e = env();
    await e.go({ [P]: before, [H]: home });
    const hash = JSON.parse(e.read('state.json')).pages['rival/pricing'].hash;
    const r = await e.go({ [P]: after, [H]: home });
    expect(r.outcomes[0]?.status).toBe('deferred');
    expect(JSON.parse(e.read('state.json')).pages['rival/pricing'].hash).toBe(hash);
    expect(e.read('snapshots/rival/pricing.md')).not.toContain('$45');
    // ...so the next run sees it again.
    const again = await e.go({ [P]: after, [H]: home });
    expect(again.outcomes[0]?.status).toBe('deferred');
  });

  it('a classified change saves the new snapshot and hash with its status', async () => {
    const e = env();
    await e.go({ [P]: before, [H]: home });
    const r = await e.go({ [P]: after, [H]: home }, {}, async () => ({ significance: 'minor' }));
    expect(r.outcomes[0]?.status).toBe('minor');
    expect(e.read('snapshots/rival/pricing.md')).toContain('$45');
    expect(JSON.parse(e.read('state.json')).pages['rival/pricing'].last_status).toBe('minor');
    const next = await e.go({ [P]: after, [H]: home });
    expect(next.outcomes[0]?.status).toBe('unchanged');
  });

  it('noise from triage is saved quietly', async () => {
    const e = env();
    await e.go({ [P]: before, [H]: home });
    const r = await e.go({ [P]: fixture('copy-after.html'), [H]: home }, {}, async () => ({
      significance: 'noise',
    }));
    expect(r.outcomes[0]?.status).toBe('noise');
  });

  it('a tiny diff with no keyword hit is trivial: saved, classifier never called', async () => {
    const e = env();
    await e.go({ [P]: before, [H]: home });
    const classify = vi.fn(material);
    const tiny = before.replace('<h2>Pro</h2>', '<h2>Pro+</h2>');
    const r = await e.go({ [P]: tiny, [H]: home }, {}, classify);
    expect(r.outcomes[0]).toMatchObject({ status: 'trivial' });
    expect(classify).not.toHaveBeenCalled();
    expect(e.read('snapshots/rival/pricing.md')).toContain('Pro+');
  });

  it('a keyword hit below the threshold still fires and forces material', async () => {
    const e = env(yaml('  alert_on: ["free plan"]'));
    await e.go({ [P]: before, [H]: home });
    const withFree = before.replace('<h1>Pricing</h1>', '<h1>Pricing</h1><p>Free plan</p>');
    const classify = vi.fn<Classify>(async () => ({ significance: 'noise', summary: 'meh' }));
    const r = await e.go({ [P]: withFree, [H]: home }, {}, classify);
    const o = r.outcomes[0]!;
    expect(o.changedChars).toBeLessThan(40);
    expect(o.status).toBe('material');
    expect(o.keywordHits).toEqual([{ keyword: 'free plan', change: 'appeared' }]);
    expect(classify.mock.calls[0]?.[0].keywordHits).toHaveLength(1);
    expect(formatReport(r)).toContain('Keyword trigger: "free plan" appeared');
  });

  it('a keyword hit with no classifier is deferred, not dropped', async () => {
    const e = env(yaml('  alert_on: ["free plan"]'));
    await e.go({ [P]: before, [H]: home });
    const withFree = before.replace('<h1>Pricing</h1>', '<h1>Pricing</h1><p>Free plan</p>');
    const r = await e.go({ [P]: withFree, [H]: home });
    expect(r.outcomes[0]?.status).toBe('deferred');
    expect(e.read('snapshots/rival/pricing.md')).not.toContain('Free plan');
  });

  it('merges per-page and global keywords', async () => {
    const e = env(`
company: {name: Acme, description: Anvils}
settings: {alert_on: ["sso"]}
competitors:
  - name: Rival
    pages:
      - {type: pricing, url: "${P}", alert_on: ["enterprise"]}
`);
    await e.go({ [P]: before });
    const r = await e.go({ [P]: before.replace('<h1>', '<p>Enterprise SSO</p><h1>') });
    expect(r.outcomes[0]?.keywordHits.map((h) => h.keyword).sort()).toEqual(['enterprise', 'sso']);
  });

  it('one failing page does not stop the run', async () => {
    const e = env();
    const r = await e.go({ [H]: home }); // pricing 404s
    expect(r.outcomes.map((o) => o.status)).toEqual(['error', 'baseline']);
    expect(e.read('state.json')).toContain('"last_status": "error"');
  });

  it('--only limits the run to one competitor; unknown slug is a config error', async () => {
    const e = env();
    const r = await e.go({ [P]: before, [H]: home }, { only: 'other-co' });
    expect(r.outcomes.map((o) => o.slug)).toEqual(['other-co']);
    await expect(e.go({}, { only: 'nope' })).rejects.toThrow(ConfigError);
  });

  it('re-baselines when state knows the page but the snapshot file is gone', async () => {
    const e = env();
    await e.go({ [P]: before, [H]: home });
    rmSync(join(e.dir, 'snapshots/rival/pricing.md'));
    const r = await e.go({ [P]: before, [H]: home });
    // same content -> unchanged, snapshot file stays missing; change it to trigger re-baseline
    expect(r.outcomes[0]?.status).toBe('unchanged');
    const r2 = await e.go({ [P]: after, [H]: home }, {}, material);
    expect(r2.outcomes[0]?.status).toBe('baseline');
    expect(e.read('snapshots/rival/pricing.md')).toContain('$45');
  });
});

describe('runPipeline with the LLM stage', () => {
  it('a DeferChange (cost cap) keeps the old hash and snapshot and is reported as deferred', async () => {
    const { DeferChange } = await import('../src/run.js');
    const e = env();
    await e.go({ [P]: before, [H]: home });
    const hash = JSON.parse(e.read('state.json')).pages['rival/pricing'].hash;
    const r = await e.go({ [P]: after, [H]: home }, {}, async () => {
      throw new DeferChange('cost cap reached; will be retried next run');
    });
    expect(r.outcomes[0]).toMatchObject({
      status: 'deferred',
      detail: expect.stringContaining('cost cap'),
    });
    expect(JSON.parse(e.read('state.json')).pages['rival/pricing'].hash).toBe(hash);
    expect(e.read('snapshots/rival/pricing.md')).not.toContain('$45');
    const again = await e.go({ [P]: after, [H]: home }, {}, material);
    expect(again.outcomes[0]?.status).toBe('material'); // picked up next run
  });

  it('a classifier error fails only that page: error status, old hash and snapshot kept', async () => {
    const e = env();
    await e.go({ [P]: before, [H]: home });
    const hash = JSON.parse(e.read('state.json')).pages['rival/pricing'].hash;
    const r = await e.go({ [P]: after, [H]: home }, {}, async () => {
      throw new Error('response failed validation');
    });
    expect(r.outcomes.map((o) => o.status)).toEqual(['error', 'unchanged']);
    const st = JSON.parse(e.read('state.json')).pages['rival/pricing'];
    expect(st).toMatchObject({
      hash,
      last_status: 'error',
      last_error: 'response failed validation',
    });
    expect(e.read('snapshots/rival/pricing.md')).not.toContain('$45');
  });

  it('analysis and cost appear in the report', async () => {
    const { CostTracker } = await import('../src/cost.js');
    const { DEFAULT_PRICES } = await import('../src/llm/defaults.js');
    const e = env();
    await e.go({ [P]: before, [H]: home });
    const cost = new CostTracker(1, DEFAULT_PRICES);
    cost.record('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 100 });
    const { fetcher } = testFetcher({ [P]: { body: after }, [H]: { body: home } });
    const r = await runPipeline(e.cfg, {
      fetcher,
      storage: new FilesystemStorage(e.dir),
      cost,
      now: NOW,
      classify: async () => ({
        significance: 'material',
        summary: 'Pro up',
        analysis: {
          what_changed: 'W',
          why_it_matters: 'Y',
          impact_on_us: 'I',
          suggested_response: 'S',
          confidence: 'high',
        },
      }),
    });
    const text = formatReport(r);
    expect(text).toContain('What changed: W');
    expect(text).toContain('Suggested response: S (confidence: high)');
    expect(text).toMatch(/Cost: \$0\.0001 of \$1\.00 cap/);
  });
});
