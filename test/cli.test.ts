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
