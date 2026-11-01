import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilesystemStorage } from '../src/storage/filesystem.js';

const make = () => new FilesystemStorage(mkdtempSync(join(tmpdir(), 'cw-store-')));

describe('FilesystemStorage', () => {
  it('returns null for missing files', async () => {
    expect(await make().read('nope.md')).toBeNull();
  });

  it('writes (creating directories) and reads back', async () => {
    const s = make();
    await s.write('snapshots/a/pricing.md', 'hello');
    expect(await s.read('snapshots/a/pricing.md')).toBe('hello');
  });

  it('lists recursively with "/" paths, sorted; empty for a missing prefix', async () => {
    const s = make();
    await s.write('snapshots/b/home.md', '1');
    await s.write('snapshots/a/pricing.md', '2');
    await s.write('state.json', '{}');
    expect(await s.list('snapshots')).toEqual(['snapshots/a/pricing.md', 'snapshots/b/home.md']);
    expect(await s.list('snapshots/')).toHaveLength(2);
    expect(await s.list('digests')).toEqual([]);
  });

  it('refuses paths that escape the root or are absolute', async () => {
    const s = make();
    await expect(s.write('../evil.txt', 'x')).rejects.toThrow(/escapes/);
    await expect(s.read('a/../../evil.txt')).rejects.toThrow(/escapes/);
    await expect(s.read('/etc/passwd')).rejects.toThrow();
  });
});
