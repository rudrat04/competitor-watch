import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { CostTracker } from '../src/cost.js';
import {
  createLinks,
  detectGithub,
  localLinks,
  repoRelativeDataDir,
} from '../src/github/context.js';
import { createLlm, type MessagesApi } from '../src/llm/client.js';
import { DEFAULT_MODELS, DEFAULT_PRICES } from '../src/llm/defaults.js';
import { recentEntries, sectionBody, updateCard } from '../src/llm/battlecard-doc.js';
import { buildDigest, nextDigestPath, unwatchedPages } from '../src/outputs/digest.js';
import {
  rebuildBattlecard,
  runBattlecardStage,
  battlecardPath,
} from '../src/outputs/battlecards.js';
import type { PageOutcome } from '../src/run.js';
import { emptyState } from '../src/snapshot/state.js';
import { FilesystemStorage } from '../src/storage/filesystem.js';

const config = parseConfig(`
company: {name: Acme, description: Anvils, positioning: Cheap}
competitors:
  - name: Rival
    pages:
      - {type: pricing, url: "https://rival.io/pricing"}
  - name: Other Co
    pages:
      - {type: homepage, url: "https://other.io"}
`);

const analysis = {
  what_changed: 'Pro rose to $45.',
  why_it_matters: 'Likely margin.',
  impact_on_us: 'We look cheaper.',
  suggested_response: 'Sales: lead with price.',
  confidence: 'medium' as const,
};

const outcome = (o: Partial<PageOutcome>): PageOutcome => ({
  competitor: 'Rival',
  slug: 'rival',
  pageId: 'pricing',
  pageType: 'pricing',
  url: 'https://rival.io/pricing',
  status: 'unchanged',
  keywordHits: [],
  ...o,
});

const digest = (outcomes: PageOutcome[], extra: Partial<Parameters<typeof buildDigest>[0]> = {}) =>
  buildDigest({
    date: '2026-11-02',
    outcomes,
    battlecards: [],
    config,
    state: emptyState(),
    links: localLinks,
    ...extra,
  });

describe('digest', () => {
  it('headline: counts, singular/plural, competitors with changes', () => {
    const m = outcome({
      status: 'material',
      classification: { significance: 'material', summary: 'Pro up', analysis },
    });
    const n = outcome({
      status: 'minor',
      slug: 'other-co',
      competitor: 'Other Co',
      pageType: 'homepage',
      pageId: 'homepage',
      classification: { significance: 'minor', summary: 'Tagline tweak' },
    });
    expect(digest([m, n])).toContain('**1 material, 1 minor changes across 2 competitors**');
    expect(digest([m])).toContain('**1 material change across 1 competitor**');
  });

  it('puts material first with full analysis, links and keyword triggers; minor as one-liners', () => {
    const m = outcome({
      status: 'material',
      keywordHits: [{ keyword: 'free plan', change: 'removed' }],
      classification: { significance: 'material', summary: 'Pro up', analysis },
    });
    const n = outcome({
      status: 'minor',
      pageType: 'homepage',
      pageId: 'homepage',
      classification: { significance: 'minor', summary: 'Tagline tweak' },
    });
    const d = digest([n, m]);
    expect(d.indexOf('## Material changes')).toBeLessThan(d.indexOf('## Minor changes'));
    for (const s of [
      '### Rival — pricing',
      '**Pro up**',
      'https://rival.io/pricing',
      '[change history](../snapshots/rival/pricing.md)',
      'Keyword trigger: "free plan" removed',
      '**What changed:** Pro rose to $45.',
      '**Why it matters:** Likely margin.',
      '**Impact on us:** We look cheaper.',
      '**Suggested response:** Sales: lead with price. _(confidence: medium)_',
      '- **Rival** (homepage): Tagline tweak',
    ])
      expect(d).toContain(s);
  });

  it('first run: baseline headline and links to the new battlecards', () => {
    const d = digest(
      [
        outcome({ status: 'baseline' }),
        outcome({
          status: 'baseline',
          slug: 'other-co',
          competitor: 'Other Co',
          pageId: 'homepage',
          pageType: 'homepage',
        }),
      ],
      {
        battlecards: [
          { slug: 'rival', competitor: 'Rival', action: 'created' },
          { slug: 'other-co', competitor: 'Other Co', action: 'created' },
        ],
      },
    );
    expect(d).toContain('**Baseline created for 2 competitors, 2 pages**');
    expect(d).toContain('[Rival](../battlecards/rival.md)');
  });

  it('nothing changed: a short digest', () => {
    const d = digest([outcome({ status: 'unchanged' })]);
    expect(d).toContain('**No meaningful changes**');
    expect(d).toContain('1 page checked with nothing worth reporting.');
    expect(d.split('\n').length).toBeLessThan(12);
  });

  it('lists failed, blocked, deferred, battlecard problems and unwatched pages', () => {
    const state = emptyState();
    state.pages['gone-co/pricing'] = {
      url: 'u',
      hash: 'h',
      last_checked: null,
      last_changed: null,
      last_status: 'ok',
      last_error: null,
    };
    const d = digest(
      [
        outcome({ status: 'error', detail: 'HTTP 500 (after 3 attempts)' }),
        outcome({
          status: 'blocked',
          detail: 'disallowed by robots.txt',
          pageType: 'blog',
          pageId: 'blog',
        }),
        outcome({
          status: 'deferred',
          detail: 'cost cap reached',
          keywordHits: [{ keyword: 'sso', change: 'appeared' }],
        }),
      ],
      {
        state,
        battlecards: [
          {
            slug: 'rival',
            competitor: 'Rival',
            action: 'failed',
            detail: 'battlecard update failed: bad layout; kept the old battlecard',
          },
        ],
      },
    );
    for (const s of [
      'failed: HTTP 500',
      'Previous snapshot kept',
      'blocked: disallowed by robots.txt',
      'not analyzed: cost cap reached',
      'picked up next run',
      'Keyword trigger: "sso" appeared',
      'kept the old battlecard',
      '`gone-co/pricing` is no longer watched',
    ]) {
      expect(d).toContain(s);
    }
  });

  it('shows cost and whether the cap was hit', () => {
    const t = new CostTracker(0.5, DEFAULT_PRICES);
    t.record('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 100 });
    t.capHit = true;
    expect(digest([], { cost: t.summary() })).toMatch(
      /Cost: \$0\.0001 of \$0\.50 cap.*COST CAP HIT/,
    );
  });

  it('unwatchedPages ignores pages that are still configured', () => {
    const state = emptyState();
    const entry = {
      url: 'u',
      hash: 'h',
      last_checked: null,
      last_changed: null,
      last_status: 'ok' as const,
      last_error: null,
    };
    state.pages['rival/pricing'] = entry;
    state.pages['rival/old'] = entry;
    expect(unwatchedPages(config, state)).toEqual(['rival/old']);
  });
});

describe('digest paths and links', () => {
  it('picks the next free name for same-day runs', async () => {
    const s = new FilesystemStorage(mkdtempSync(join(tmpdir(), 'cw-dg-')));
    expect(await nextDigestPath(s, '2026-11-02')).toBe('digests/2026-11-02.md');
    await s.write('digests/2026-11-02.md', 'a');
    expect(await nextDigestPath(s, '2026-11-02')).toBe('digests/2026-11-02-2.md');
    await s.write('digests/2026-11-02-2.md', 'b');
    expect(await nextDigestPath(s, '2026-11-02')).toBe('digests/2026-11-02-3.md');
    expect(await nextDigestPath(s, '2026-11-03')).toBe('digests/2026-11-03.md');
  });

  it('inside Actions: GitHub commit-history and blob links', () => {
    const ctx = detectGithub({
      GITHUB_ACTIONS: 'true',
      GITHUB_SERVER_URL: 'https://github.com/',
      GITHUB_REPOSITORY: 'me/watch',
    });
    const links = createLinks(ctx, 'data');
    expect(links.snapshotHistory('rival', 'pricing')).toBe(
      'https://github.com/me/watch/commits/HEAD/data/snapshots/rival/pricing.md',
    );
    expect(links.battlecard('rival')).toBe(
      'https://github.com/me/watch/blob/HEAD/data/battlecards/rival.md',
    );
    expect(createLinks(ctx, '.').battlecard('x')).toBe(
      'https://github.com/me/watch/blob/HEAD/battlecards/x.md',
    );
  });

  it('locally, or when the Actions env is incomplete: relative paths', () => {
    expect(createLinks(detectGithub({}), 'data')).toBe(localLinks);
    expect(createLinks(detectGithub({ GITHUB_ACTIONS: 'true' }), 'data')).toBe(localLinks);
    expect(localLinks.snapshotHistory('a', 'b')).toBe('../snapshots/a/b.md');
  });

  it('repoRelativeDataDir is relative to the workspace', () => {
    expect(repoRelativeDataDir('/ws/data', { GITHUB_WORKSPACE: '/ws' })).toBe('data');
    expect(repoRelativeDataDir('/ws', { GITHUB_WORKSPACE: '/ws' })).toBe('.');
  });
});

// ---- battlecard stage with a scripted LLM ----
const create = {
  overview: 'O',
  pricing: '- Pro $30',
  positioning: 'P',
  strengths: 'S',
  handling: 'H',
};
function stageEnv(replies: (string | Error)[]) {
  const calls: { model: string; system: string; user: string }[] = [];
  const api = {
    create: async (p: { model: string; system: string; messages: { content: string }[] }) => {
      calls.push({ model: p.model, system: p.system, user: p.messages[0]!.content });
      const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
      if (r instanceof Error) throw r;
      return {
        content: [{ type: 'text', text: r }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 500, output_tokens: 300 },
      };
    },
  } as unknown as MessagesApi;
  const tracker = new CostTracker(1, DEFAULT_PRICES);
  const llm = createLlm({ api, tracker, models: { ...DEFAULT_MODELS } });
  const storage = new FilesystemStorage(mkdtempSync(join(tmpdir(), 'cw-bc-')));
  return { calls, llm, storage, tracker };
}
const now = new Date('2026-11-02T03:00:00Z');
const material = outcome({
  status: 'material',
  classification: { significance: 'material', category: 'pricing', summary: 'Pro up', analysis },
  diffText: '-Pro $30\n+Pro $45',
});

describe('battlecard stage', () => {
  it('creates a battlecard from snapshots when none exists; skips competitors with no snapshots', async () => {
    const e = stageEnv([JSON.stringify(create)]);
    await e.storage.write('snapshots/rival/pricing.md', 'Pro $30');
    const r = await runBattlecardStage({
      config,
      storage: e.storage,
      llm: e.llm,
      outcomes: [],
      now,
    });
    expect(r).toEqual([{ slug: 'rival', competitor: 'Rival', action: 'created' }]);
    expect(e.calls).toHaveLength(1);
    expect(e.calls[0]!.model).toBe('claude-opus-5-5');
    expect(e.calls[0]!.user).toContain('Pro $30');
    const card = (await e.storage.read(battlecardPath('rival')))!;
    expect(sectionBody(card, 'pricing')).toBe('- Pro $30');
    expect(card).toContain('_Last updated: 2026-11-02_');
  });

  it('does nothing for a competitor whose battlecard exists and had no changes', async () => {
    const e = stageEnv([JSON.stringify(create)]);
    await e.storage.write('snapshots/rival/pricing.md', 'Pro $30');
    await runBattlecardStage({ config, storage: e.storage, llm: e.llm, outcomes: [], now });
    e.calls.length = 0;
    const r = await runBattlecardStage({
      config,
      storage: e.storage,
      llm: e.llm,
      outcomes: [outcome({ status: 'noise' })],
      now,
    });
    expect(r).toEqual([]);
    expect(e.calls).toHaveLength(0);
  });

  it('updates only affected sections (null = untouched) and logs the change', async () => {
    const e = stageEnv([
      JSON.stringify(create),
      JSON.stringify({
        overview: null,
        pricing: '- Pro $45',
        positioning: null,
        strengths: null,
        handling: null,
      }),
    ]);
    await e.storage.write('snapshots/rival/pricing.md', 'Pro $30');
    await runBattlecardStage({ config, storage: e.storage, llm: e.llm, outcomes: [], now });
    const before = (await e.storage.read(battlecardPath('rival')))!;
    const r = await runBattlecardStage({
      config,
      storage: e.storage,
      llm: e.llm,
      outcomes: [material],
      now: new Date('2026-11-09T03:00:00Z'),
    });
    expect(r[0]).toMatchObject({ action: 'updated' });
    const after = (await e.storage.read(battlecardPath('rival')))!;
    expect(sectionBody(after, 'pricing')).toBe('- Pro $45');
    for (const k of ['overview', 'positioning', 'strengths', 'handling'] as const) {
      expect(sectionBody(after, k)).toBe(sectionBody(before, k));
    }
    expect(recentEntries(after)).toEqual([
      '- **2026-11-09** — [material · pricing] Pro rose to $45. ([pricing](https://rival.io/pricing))',
    ]);
    expect(e.calls[1]!.user).toContain('+Pro $45'); // the diff reaches the model
  });

  it('an invalid model response keeps the old card and reports failure', async () => {
    const e = stageEnv([JSON.stringify(create), '{"overview": 5}']);
    await e.storage.write('snapshots/rival/pricing.md', 'Pro $30');
    await runBattlecardStage({ config, storage: e.storage, llm: e.llm, outcomes: [], now });
    const before = await e.storage.read(battlecardPath('rival'));
    const r = await runBattlecardStage({
      config,
      storage: e.storage,
      llm: e.llm,
      outcomes: [material],
      now,
    });
    expect(r[0]).toMatchObject({ action: 'failed' });
    expect(r[0]!.detail).toMatch(/battlecard update failed/);
    expect(await e.storage.read(battlecardPath('rival'))).toBe(before);
  });

  it('a hand-damaged card is left alone and the failure names the fix', async () => {
    const e = stageEnv([
      JSON.stringify({
        overview: null,
        pricing: 'x',
        positioning: null,
        strengths: null,
        handling: null,
      }),
    ]);
    await e.storage.write(battlecardPath('rival'), '# Rival\n\nno sections here\n');
    const r = await runBattlecardStage({
      config,
      storage: e.storage,
      llm: e.llm,
      outcomes: [material],
      now,
    });
    expect(r[0]).toMatchObject({ action: 'failed' });
    expect(r[0]!.detail).toContain('--rebuild');
    expect(await e.storage.read(battlecardPath('rival'))).toBe('# Rival\n\nno sections here\n');
  });

  it('hitting the cost cap skips the battlecard instead of failing the run', async () => {
    const e = stageEnv([JSON.stringify(create)]);
    const tiny = createLlm({
      api: {
        create: async () => {
          throw new Error('should not be called');
        },
      } as unknown as MessagesApi,
      tracker: new CostTracker(0.001, DEFAULT_PRICES),
      models: { ...DEFAULT_MODELS },
    });
    await e.storage.write('snapshots/rival/pricing.md', 'Pro $30');
    const r = await runBattlecardStage({
      config,
      storage: e.storage,
      llm: tiny,
      outcomes: [],
      now,
    });
    expect(r[0]).toMatchObject({ action: 'skipped' });
    expect(await e.storage.read(battlecardPath('rival'))).toBeNull();
  });

  it('--only limits the stage to one competitor', async () => {
    const e = stageEnv([JSON.stringify(create)]);
    await e.storage.write('snapshots/rival/pricing.md', 'a');
    await e.storage.write('snapshots/other-co/homepage.md', 'b');
    const r = await runBattlecardStage({
      config,
      storage: e.storage,
      llm: e.llm,
      outcomes: [],
      now,
      only: 'other-co',
    });
    expect(r.map((x) => x.slug)).toEqual(['other-co']);
  });
});

describe('battlecard --rebuild', () => {
  it('regenerates model sections but carries over the Recent changes log', async () => {
    const e = stageEnv([
      JSON.stringify(create),
      JSON.stringify({ ...create, pricing: '- Pro $99' }),
    ]);
    await e.storage.write('snapshots/rival/pricing.md', 'Pro $99');
    await rebuildBattlecard({ config, storage: e.storage, llm: e.llm, slug: 'rival', now });
    const withLog = updateCard(
      (await e.storage.read(battlecardPath('rival')))!,
      {},
      ['- **2026-11-01** old change'],
      '2026-11-01',
    );
    await e.storage.write(battlecardPath('rival'), withLog);
    const card = await rebuildBattlecard({
      config,
      storage: e.storage,
      llm: e.llm,
      slug: 'rival',
      now,
    });
    expect(sectionBody(card, 'pricing')).toBe('- Pro $99');
    expect(recentEntries(card)).toEqual(['- **2026-11-01** old change']);
  });

  it('errors clearly for unknown slugs and when there are no snapshots', async () => {
    const e = stageEnv([JSON.stringify(create)]);
    await expect(
      rebuildBattlecard({ config, storage: e.storage, llm: e.llm, slug: 'nope', now }),
    ).rejects.toThrow(/No competitor/);
    await expect(
      rebuildBattlecard({ config, storage: e.storage, llm: e.llm, slug: 'rival', now }),
    ).rejects.toThrow(/No snapshots/);
  });

  it('rebuilds even when the old card is damaged', async () => {
    const e = stageEnv([JSON.stringify(create)]);
    await e.storage.write('snapshots/rival/pricing.md', 'a');
    await e.storage.write(battlecardPath('rival'), 'garbage');
    const card = await rebuildBattlecard({
      config,
      storage: e.storage,
      llm: e.llm,
      slug: 'rival',
      now,
    });
    expect(card).toContain('## Overview');
  });
});
