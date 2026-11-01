import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = resolve('.');
const cli = join(root, 'dist/cli.js');

function run(cwd: string, ...args: string[]) {
  return spawnSync('node', [cli, ...args], { cwd, encoding: 'utf8' });
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
