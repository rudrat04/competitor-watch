import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { digestLocation, visibilityGuard } from '../src/github/context.js';
import { discordContent, sendDiscord } from '../src/outputs/notify/discord.js';
import { ISSUE_LABEL, createDigestIssue, issueBody } from '../src/outputs/notify/github-issue.js';
import {
  notifyAll,
  shouldNotify,
  summarize,
  type NotifySummary,
} from '../src/outputs/notify/index.js';
import { sendSlack, slackText } from '../src/outputs/notify/slack.js';
import type { PageOutcome, RunResult } from '../src/run.js';
import { emptyState } from '../src/snapshot/state.js';

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };
/** fetch mock: `handler` returns [status, json] for each request; all calls are recorded. */
function mockFetch(
  handler: (url: string, body: Record<string, unknown>) => [number, unknown] | Error,
) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, init, body });
    const r = handler(url, body);
    if (r instanceof Error) throw r;
    return new Response(r[0] === 204 ? null : JSON.stringify(r[1] ?? {}), {
      status: r[0],
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

const ACTIONS = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'me/watch',
  GITHUB_TOKEN: 'ghs_test',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_API_URL: 'https://api.github.com',
};

describe('visibility guard', () => {
  it('does nothing outside GitHub Actions (no API call)', async () => {
    const f = mockFetch(() => [200, { private: false }]);
    expect(await visibilityGuard({ allowPublicRepo: false, env: {}, fetchImpl: f.impl })).toEqual({
      ok: true,
    });
    expect(f.calls).toHaveLength(0);
  });

  it('allows a private repo, calling the API with the token', async () => {
    const f = mockFetch(() => [200, { private: true }]);
    expect(
      await visibilityGuard({ allowPublicRepo: false, env: ACTIONS, fetchImpl: f.impl }),
    ).toEqual({ ok: true });
    expect(f.calls[0]?.url).toBe('https://api.github.com/repos/me/watch');
    expect((f.calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer ghs_test',
    );
  });

  it("blocks a public repo with the plan's explanation", async () => {
    const f = mockFetch(() => [200, { private: false, visibility: 'public' }]);
    const r = await visibilityGuard({ allowPublicRepo: false, env: ACTIONS, fetchImpl: f.impl });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain(
        'This repo is public, so your competitor data would be visible to everyone.',
      );
      expect(r.message).toContain('allow_public_repo: true');
    }
  });

  it('allows a public repo only with allow_public_repo, and warns', async () => {
    const f = mockFetch(() => [200, { private: false }]);
    const r = await visibilityGuard({ allowPublicRepo: true, env: ACTIONS, fetchImpl: f.impl });
    expect(r).toMatchObject({ ok: true, warning: expect.stringContaining('public repo') });
  });

  it('fails safe: API error, network error, or missing token are treated as public', async () => {
    for (const handler of [
      () => [404, {}] as [number, unknown],
      () => new Error('ECONNRESET'),
      () => [200, {}] as [number, unknown],
    ]) {
      const f = mockFetch(handler);
      const r = await visibilityGuard({ allowPublicRepo: false, env: ACTIONS, fetchImpl: f.impl });
      expect(r.ok).toBe(false);
    }
    const f = mockFetch(() => [200, { private: true }]);
    const noToken = await visibilityGuard({
      allowPublicRepo: false,
      env: { ...ACTIONS, GITHUB_TOKEN: '' },
      fetchImpl: f.impl,
    });
    expect(noToken).toMatchObject({
      ok: false,
      message: expect.stringContaining('GITHUB_TOKEN is not set'),
    });
    expect(f.calls).toHaveLength(0);
  });
});

// ---- notifications ----
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
const result = (outcomes: PageOutcome[], extra: Partial<RunResult> = {}): RunResult => ({
  outcomes,
  state: emptyState(),
  dryRun: false,
  battlecards: [],
  digest: '# Outflank — 2026-11-02\n\nbody\n',
  digestPath: 'digests/2026-11-02.md',
  ...extra,
});
const material = outcome({
  status: 'material',
  classification: { significance: 'material', summary: 'Pro rose to $45' },
});
const minor = outcome({
  status: 'minor',
  pageType: 'homepage',
  classification: { significance: 'minor', summary: 'New tagline' },
});
const cost = (capHit: boolean) => ({
  spentUsd: 0.5,
  capUsd: 0.5,
  calls: 3,
  inputTokens: 1,
  outputTokens: 1,
  capHit,
});

const config = (notify: string) =>
  parseConfig(
    `company: {name: A, description: B}\nsettings: {notify: ${notify}}\ncompetitors: [{name: Rival, pages: [{type: pricing, url: "https://rival.io/pricing"}]}]\n`,
  );

describe('when to notify', () => {
  it('on minor/material changes, baselines, or a hit cost cap; not on quiet runs', () => {
    expect(shouldNotify(result([material]))).toBe(true);
    expect(shouldNotify(result([minor]))).toBe(true);
    expect(shouldNotify(result([outcome({ status: 'baseline' })]))).toBe(true);
    expect(shouldNotify(result([outcome({ status: 'unchanged' })], { cost: cost(true) }))).toBe(
      true,
    );
    for (const status of [
      'unchanged',
      'noise',
      'trivial',
      'error',
      'blocked',
      'deferred',
    ] as const) {
      expect(shouldNotify(result([outcome({ status })], { cost: cost(false) }))).toBe(false);
    }
  });

  it('summary lists material first, caps the list, and mentions a hit cap', () => {
    const many = [minor, material, ...Array.from({ length: 6 }, () => minor)];
    const s = summarize(result(many, { cost: cost(true) }), '2026-11-02', 'https://x/d.md');
    expect(s.items[0]).toContain('🔴 Rival (pricing): Pro rose to $45');
    expect(s.items).toHaveLength(5);
    expect(s.more).toBe(3);
    expect(s.headline).toMatch(/1 material, 7 minor changes.*cost cap hit/);
  });
});

describe('github issue notifier', () => {
  it('creates one labeled issue whose body is the digest', async () => {
    const f = mockFetch((url) =>
      url.endsWith('/labels')
        ? [422, {}]
        : [201, { html_url: 'https://github.com/me/watch/issues/7' }],
    );
    const r = await createDigestIssue({
      title: 'T',
      digest: '# D',
      digestUrl: 'u',
      env: ACTIONS,
      fetchImpl: f.impl,
    });
    expect(r).toEqual({
      channel: 'github-issue',
      status: 'sent',
      detail: 'https://github.com/me/watch/issues/7',
    });
    const issue = f.calls.find((c) => c.url.endsWith('/issues'))!;
    expect(issue.url).toBe('https://api.github.com/repos/me/watch/issues');
    expect(issue.body).toEqual({ title: 'T', body: '# D', labels: [ISSUE_LABEL] });
  });

  it('never throws: disabled issues, missing permission and network errors become warnings', async () => {
    const cases: [ReturnType<Parameters<typeof mockFetch>[0]>, RegExp][] = [
      [[410, {}], /issues are disabled/],
      [[403, {}], /issues: write/],
      [new Error('socket hang up'), /socket hang up/],
    ];
    for (const [reply, msg] of cases) {
      const f = mockFetch(() => reply);
      const r = await createDigestIssue({
        title: 'T',
        digest: 'D',
        digestUrl: 'u',
        env: ACTIONS,
        fetchImpl: f.impl,
      });
      expect(r.status).toBe('failed');
      expect(r.detail).toMatch(msg);
    }
  });

  it('is skipped outside Actions, without any request', async () => {
    const f = mockFetch(() => [201, {}]);
    expect(
      (
        await createDigestIssue({
          title: 'T',
          digest: 'D',
          digestUrl: 'u',
          env: {},
          fetchImpl: f.impl,
        })
      ).status,
    ).toBe('skipped');
    expect(f.calls).toHaveLength(0);
  });

  it('truncates huge digests and links to the full one', () => {
    const body = issueBody(
      'x'.repeat(70_000),
      'https://github.com/me/watch/blob/HEAD/data/digests/d.md',
    );
    expect(body.length).toBeLessThan(65_536);
    expect(body).toContain(
      '[Read the full digest](https://github.com/me/watch/blob/HEAD/data/digests/d.md)',
    );
  });
});

describe('untrusted text in notifications', () => {
  it('issue body and title never @-mention anyone, but keep emails', async () => {
    const { defuseMentions } = await import('../src/outputs/notify/github-issue.js');
    expect(defuseMentions('ping @octocat and (@team) and mail sales@rival.io')).toBe(
      'ping @\u200boctocat and (@\u200bteam) and mail sales@rival.io',
    );
    expect(issueBody('@everyone look', 'u')).not.toMatch(/@everyone/);
    const f = mockFetch(() => [201, {}]);
    await createDigestIssue({
      title: 'hi @bob',
      digest: 'x',
      digestUrl: 'u',
      env: ACTIONS,
      fetchImpl: f.impl,
    });
    expect(f.calls.find((c) => c.url.endsWith('/issues'))?.body.title).toBe('hi @\u200bbob');
  });

  it('slack text escapes &, < and > so scraped text cannot ping or disguise links', async () => {
    const { escapeSlack } = await import('../src/outputs/notify/slack.js');
    expect(escapeSlack('<!channel> & <https://evil|ok>')).toBe(
      '&lt;!channel&gt; &amp; &lt;https://evil|ok&gt;',
    );
    const text = slackText({
      date: 'd',
      headline: 'h',
      items: ['<!here> free'],
      more: 0,
      digestUrl: 'https://x/d.md',
    });
    expect(text).not.toContain('<!here>');
    expect(text).toContain('<https://x/d.md|Read the full digest>'); // our own link still works
  });
});

describe('slack and discord notifiers', () => {
  const s: NotifySummary = {
    date: '2026-11-02',
    headline: '1 material change across 1 competitor',
    items: ['🔴 Rival (pricing): Pro rose to $45'],
    more: 0,
    digestUrl: 'https://github.com/me/watch/blob/HEAD/data/digests/2026-11-02.md',
  };

  it('slack: short summary with a link to the digest', async () => {
    expect(slackText(s)).toBe(
      '*Outflank — 2026-11-02*: 1 material change across 1 competitor\n• 🔴 Rival (pricing): Pro rose to $45\n<https://github.com/me/watch/blob/HEAD/data/digests/2026-11-02.md|Read the full digest>',
    );
    const f = mockFetch(() => [200, {}]);
    expect(await sendSlack('https://hooks.slack.com/services/SECRET', s, f.impl)).toEqual({
      channel: 'slack',
      status: 'sent',
    });
    expect(f.calls[0]?.body).toEqual({ text: slackText(s) });
  });

  it('local digest paths are shown as plain text, not as links', () => {
    expect(slackText({ ...s, digestUrl: 'data/digests/x.md' })).toContain(
      'Digest: data/digests/x.md',
    );
  });

  it('discord: fits in 2000 chars, never pings, keeps headline and link', async () => {
    const long = {
      ...s,
      items: Array.from({ length: 50 }, (_, i) => `🟡 item ${i} ${'x'.repeat(80)}`),
    };
    const c = discordContent(long);
    expect(c.length).toBeLessThanOrEqual(2000);
    expect(c.startsWith('**Outflank — 2026-11-02**')).toBe(true);
    expect(c).toContain('[Read the full digest]');
    const f = mockFetch(() => [204, null]);
    expect((await sendDiscord('https://discord.com/api/webhooks/SECRET', s, f.impl)).status).toBe(
      'sent',
    );
    expect(f.calls[0]?.body.allowed_mentions).toEqual({ parse: [] });
  });

  it('webhook failures are reported without leaking the URL', async () => {
    const f = mockFetch(() => [500, {}]);
    const r = await sendSlack('https://hooks.slack.com/services/SECRET', s, f.impl);
    expect(r).toMatchObject({ status: 'failed', detail: 'Slack returned HTTP 500' });
    expect(JSON.stringify(r)).not.toContain('SECRET');
  });
});

describe('notifyAll', () => {
  const env = {
    ...ACTIONS,
    SLACK_WEBHOOK_URL: 'https://hooks.slack.com/x',
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/x',
  };
  const okFetch = () =>
    mockFetch(() => [201, { html_url: 'https://github.com/me/watch/issues/1' }]);

  it('sends only the enabled channels', async () => {
    const f = okFetch();
    const r = await notifyAll({
      result: result([material]),
      config: config('{github_issue: true, slack: true, discord: false}'),
      date: '2026-11-02',
      digestUrl: 'u',
      env,
      fetchImpl: f.impl,
    });
    expect(r.map((x) => [x.channel, x.status])).toEqual([
      ['github-issue', 'sent'],
      ['slack', 'sent'],
    ]);
    expect(f.calls.some((c) => c.url.includes('discord'))).toBe(false);
  });

  it('nothing on a quiet run or a dry run', async () => {
    const f = okFetch();
    const all = config('{github_issue: true, slack: true, discord: true}');
    expect(
      await notifyAll({
        result: result([outcome({ status: 'unchanged' })]),
        config: all,
        date: 'd',
        digestUrl: 'u',
        env,
        fetchImpl: f.impl,
      }),
    ).toEqual([]);
    expect(
      await notifyAll({
        result: result([material], { dryRun: true }),
        config: all,
        date: 'd',
        digestUrl: 'u',
        env,
        fetchImpl: f.impl,
      }),
    ).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });

  it('an enabled channel without its secret is a warning, not a crash', async () => {
    const f = okFetch();
    const r = await notifyAll({
      result: result([material]),
      config: config('{github_issue: false, slack: true, discord: false}'),
      date: 'd',
      digestUrl: 'u',
      env: {},
      fetchImpl: f.impl,
    });
    expect(r).toEqual([
      {
        channel: 'slack',
        status: 'failed',
        detail: 'notify.slack is on but SLACK_WEBHOOK_URL is not set',
      },
    ]);
  });

  it('issue title carries the date and headline', async () => {
    const f = okFetch();
    await notifyAll({
      result: result([material]),
      config: config('{github_issue: true}'),
      date: '2026-11-02',
      digestUrl: 'u',
      env,
      fetchImpl: f.impl,
    });
    expect(f.calls.find((c) => c.url.endsWith('/issues'))?.body.title).toBe(
      'Outflank — 2026-11-02: 1 material change across 1 competitor',
    );
  });
});

describe('digestLocation', () => {
  it('GitHub URL inside Actions, local path otherwise', () => {
    const gh = { inActions: true, serverUrl: 'https://github.com', repository: 'me/watch' };
    expect(digestLocation(gh, 'data', 'digests/d.md')).toBe(
      'https://github.com/me/watch/blob/HEAD/data/digests/d.md',
    );
    expect(digestLocation({ inActions: false }, 'data', 'digests/d.md')).toBe('data/digests/d.md');
  });
});
