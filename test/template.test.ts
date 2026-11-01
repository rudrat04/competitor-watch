import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { notConfiguredReason, parseConfig } from '../src/config.js';
import { PACKAGE_NAME } from '../src/constants.js';

const read = (p: string) => readFileSync(`template/${p}`, 'utf8');

describe('template/ workflow', () => {
  const text = read('.github/workflows/outflank.yml');
  const wf = parse(text) as {
    on: { schedule: { cron: string }[]; workflow_dispatch: unknown };
    permissions: Record<string, string>;
    concurrency: { group: string; 'cancel-in-progress': boolean };
    env: { CW_PACKAGE: string };
    jobs: {
      watch: {
        if: string;
        steps: { name: string; run?: string; env?: Record<string, string>; id?: string }[];
      };
    };
  };
  const steps = wf.jobs.watch.steps;
  const step = (name: string) => steps.find((s) => s.name.startsWith(name))!;

  it('is valid YAML and references the right package name, as latest 1.x', () => {
    expect(wf.env.CW_PACKAGE).toBe(`${PACKAGE_NAME}@1`);
    expect(text).toContain('latest 1.x');
  });

  it('runs weekly on Monday 03:17 UTC and on demand', () => {
    expect(wf.on.schedule[0]?.cron).toBe('17 3 * * 1');
    expect('workflow_dispatch' in wf.on).toBe(true);
  });

  it('has the planned permissions, concurrency and template-repo skip', () => {
    expect(wf.permissions).toEqual({ contents: 'write', issues: 'write' });
    expect(wf.concurrency).toEqual({ group: 'outflank', 'cancel-in-progress': false });
    expect(wf.jobs.watch.if).toBe("github.repository != 'rudrat04/outflank-template'");
  });

  it('installs without saving, adds a browser only when needed, and runs with the secrets', () => {
    expect(step('Install Outflank').run).toBe('npm install --no-save "$CW_PACKAGE"');
    const browser = step('Install a browser').run!;
    expect(browser).toContain('outflank info --needs-browser');
    expect(browser).toContain('playwright install --with-deps chromium');
    // A separate `npm install --no-save playwright` would prune the engine (verified with npm 10).
    expect(browser).toContain('npm install --no-save "$CW_PACKAGE" playwright');
    expect(browser).not.toMatch(/npm install --no-save playwright/);
    const run = step('Run');
    expect(run.run).toContain('outflank run');
    expect(Object.keys(run.env!).sort()).toEqual([
      'ANTHROPIC_API_KEY',
      'DISCORD_WEBHOOK_URL',
      'GITHUB_TOKEN',
      'SLACK_WEBHOOK_URL',
    ]);
  });

  it('commits only data/ as github-actions[bot], skipping when nothing changed', () => {
    const c = step('Commit data');
    expect(c.run).toContain('git add data/');
    expect(c.run).not.toMatch(/git add (-A|\.|--all)/);
    expect(c.run).toContain('github-actions[bot]');
    expect(c.run).toContain('git diff --cached --quiet');
    // The step output goes through env, never interpolated into the script.
    expect(c.env?.MESSAGE).toContain('steps.run.outputs.summary');
    expect(c.run).not.toContain('${{');
  });
});

describe('template/ files', () => {
  it('placeholder config triggers "not configured yet"', () => {
    expect(notConfiguredReason(parseConfig(read('competitors.yaml')))).not.toBeNull();
  });

  it('gitignores node_modules and .env, and keeps an empty data/', () => {
    const gi = read('.gitignore').split('\n');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('.env');
    expect(existsSync('template/data/.gitkeep')).toBe(true);
  });

  it('README has the setup steps and links to the engine docs', () => {
    const md = read('README.md');
    expect(md).toContain('Use this template');
    expect(md).toContain('ANTHROPIC_API_KEY');
    expect(md).toContain('https://github.com/rudrat04/outflank');
  });
});
