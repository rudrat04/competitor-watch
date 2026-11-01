import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = resolve('.');
const cli = join(root, 'dist/cli.js');

/**
 * The environment a spawned CLI sees: the parent's, minus anything that changes its behaviour.
 * Without this, tests running inside GitHub Actions (GITHUB_ACTIONS=true) would hit the
 * visibility guard, and could append to the real job's GITHUB_OUTPUT / GITHUB_STEP_SUMMARY.
 */
function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!/^(GITHUB_|RUNNER_|ANTHROPIC_|SLACK_|DISCORD_|CI$)/.test(k)) env[k] = v;
  }
  return { ...env, ...extra };
}

function run(cwd: string, ...args: string[]) {
  return spawnSync('node', [cli, ...args], { cwd, encoding: 'utf8', env: cleanEnv() });
}

beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' });
});

describe('cli', () => {
  it('exits 0 with "Not configured yet" on the placeholder config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-'));
    copyFileSync(join(root, 'competitors.example.yaml'), join(dir, 'competitors.yaml'));
    const r = run(dir, 'run');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Not configured yet');
  });

  it('exits 1 on an invalid config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-'));
    writeFileSync(join(dir, 'competitors.yaml'), 'company: {}\n');
    const r = run(dir, 'run');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('company.name');
  });

  it('exits 1 when competitors.yaml is missing', () => {
    const r = run(mkdtempSync(join(tmpdir(), 'cw-')), 'check');
    expect(r.status).toBe(1);
  });

  it('lists all planned commands', () => {
    const r = run(root, '--help');
    for (const cmd of ['init', 'check', 'run', 'battlecard', 'info'])
      expect(r.stdout).toContain(cmd);
  });
});

describe('cli info --needs-browser', () => {
  const write = (yaml: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-'));
    writeFileSync(join(dir, 'competitors.yaml'), yaml);
    return dir;
  };
  const base = `company: {name: Acme, description: Anvils}
competitors:
  - name: Rival
    pages:
      - {type: pricing, url: "https://rival.io/p"__RENDER__}
`;

  it('prints false when no page renders', () => {
    const r = run(write(base.replace('__RENDER__', '')), 'info', '--needs-browser');
    expect(r.stdout.trim()).toBe('false');
    expect(r.status).toBe(0);
  });

  it('prints true when a page has render: true', () => {
    const r = run(write(base.replace('__RENDER__', ', render: true')), 'info', '--needs-browser');
    expect(r.stdout.trim()).toBe('true');
  });

  it('prints a bare true/false even on the placeholder config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-'));
    copyFileSync(join(root, 'competitors.example.yaml'), join(dir, 'competitors.yaml'));
    expect(run(dir, 'info', '--needs-browser').stdout.trim()).toBe('true');
  });
});

describe('cli run without a key', () => {
  it('exits 1 with a clear message when ANTHROPIC_API_KEY is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-'));
    writeFileSync(
      join(dir, 'competitors.yaml'),
      'company: {name: Acme, description: Anvils}\ncompetitors:\n  - name: Rival\n    pages:\n      - {type: pricing, url: "https://rival.io/p"}\n',
    );
    const env = cleanEnv(); // no ANTHROPIC_API_KEY, and not "inside Actions"
    const r = spawnSync('node', [cli, 'run'], { cwd: dir, encoding: 'utf8', env });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ANTHROPIC_API_KEY');
  });
});

describe('cli visibility guard', () => {
  it('in Actions without a token (visibility unknown): exit 4, nothing written, no network', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-'));
    writeFileSync(
      join(dir, 'competitors.yaml'),
      'company: {name: Acme, description: Anvils}\ncompetitors:\n  - name: Rival\n    pages:\n      - {type: pricing, url: "https://rival.io/p"}\n',
    );
    // Inside Actions, but no GITHUB_TOKEN: visibility can't be checked.
    const env = cleanEnv({
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'me/watch',
      ANTHROPIC_API_KEY: 'sk-test',
    });
    const r = spawnSync('node', [cli, 'run'], { cwd: dir, encoding: 'utf8', env });
    expect(r.status).toBe(4);
    expect(r.stderr).toContain('::error::This repo is public');
    expect(readdirSync(dir)).toEqual(['competitors.yaml']);
  });

  it('placeholder config still exits 0 before the guard (template repos stay quiet)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-'));
    copyFileSync(join(root, 'competitors.example.yaml'), join(dir, 'competitors.yaml'));
    const env = cleanEnv({ GITHUB_ACTIONS: 'true' });
    const r = spawnSync('node', [cli, 'run'], { cwd: dir, encoding: 'utf8', env });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Not configured yet');
  });
});

describe('cli init', () => {
  it('creates competitors.yaml and .env, prints next steps, never overwrites', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-'));
    const r = run(dir, 'init');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Created competitors.yaml');
    expect(r.stdout).toContain('Created .env');
    expect(r.stdout).toContain('Next steps');
    expect(readFileSync(join(dir, 'competitors.yaml'), 'utf8')).toBe(
      readFileSync(join(root, 'competitors.example.yaml'), 'utf8'),
    );
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(
      readFileSync(join(root, '.env.example'), 'utf8'),
    );
    expect(statSync(join(dir, '.env')).mode & 0o077).toBe(0); // secrets file not world-readable

    writeFileSync(join(dir, 'competitors.yaml'), 'mine');
    const again = run(dir, 'init');
    expect(again.stdout).toContain('Kept existing competitors.yaml');
    expect(readFileSync(join(dir, 'competitors.yaml'), 'utf8')).toBe('mine');
    // ...and the fresh config is the placeholder, so run does nothing yet.
    const fresh = mkdtempSync(join(tmpdir(), 'cw-'));
    run(fresh, 'init');
    expect(run(fresh, 'run').stdout).toContain('Not configured yet');
  });
});

describe('npm package contents', () => {
  it('ships only dist/, prompts/, README.md, LICENSE and package.json', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
    });
    const files = (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path);
    for (const f of files) {
      expect(
        f === 'package.json' ||
          f === 'README.md' ||
          f === 'LICENSE' ||
          f.startsWith('dist/') ||
          f.startsWith('prompts/'),
        f,
      ).toBe(true);
    }
    expect(files).toContain('dist/cli.js');
    for (const p of ['triage', 'analyze', 'battlecard-create', 'battlecard-update']) {
      expect(files).toContain(`prompts/${p}.md`);
    }
    expect(
      files.some((f) => f.startsWith('test/') || f.startsWith('src/') || f.startsWith('template/')),
    ).toBe(false);
  });

  it('bin points at a file with a node shebang', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
    };
    expect(pkg.bin['competitor-watch']).toBe('dist/cli.js');
    expect(readFileSync(join(root, 'dist/cli.js'), 'utf8').startsWith('#!/usr/bin/env node')).toBe(
      true,
    );
  });
});
