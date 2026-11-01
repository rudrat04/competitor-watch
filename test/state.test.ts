import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { FilesystemStorage } from '../src/storage/filesystem.js';
import { emptyState, loadState, pageIdsFor, saveState } from '../src/snapshot/state.js';

const cfg = (pages: string) =>
  parseConfig(`
company: {name: Acme, description: Anvils}
competitors:
  - name: Rival
    pages:
${pages}
`).competitors[0]!;

describe('state.json', () => {
  const store = () => new FilesystemStorage(mkdtempSync(join(tmpdir(), 'cw-state-')));

  it('returns an empty state when missing', async () => {
    expect(await loadState(store())).toEqual(emptyState());
  });

  it('round-trips', async () => {
    const s = store();
    const st = emptyState();
    st.last_run = '2026-11-02T03:00:00Z';
    await saveState(s, st);
    expect(await loadState(s)).toEqual(st);
  });

  it('rejects unknown schema versions and corrupt files', async () => {
    const s = store();
    await s.write('state.json', '{"schema_version": 2}');
    await expect(loadState(s)).rejects.toThrow(/schema_version 2/);
    await s.write('state.json', 'nope');
    await expect(loadState(s)).rejects.toThrow(/not valid JSON/);
  });
});

describe('pageIdsFor', () => {
  it('uses the bare type when unique', () => {
    const c = cfg(
      `      - {type: pricing, url: "https://r.io/p"}\n      - {type: homepage, url: "https://r.io"}`,
    );
    expect(pageIdsFor(c)).toEqual(['pricing', 'homepage']);
  });

  it('adds a URL hash when a type repeats, and is stable across calls and reordering', () => {
    const a = `      - {type: pricing, url: "https://r.io/p"}\n      - {type: pricing, url: "https://r.io/plans"}`;
    const b = `      - {type: pricing, url: "https://r.io/plans"}\n      - {type: pricing, url: "https://r.io/p"}`;
    const ids = pageIdsFor(cfg(a));
    expect(ids[0]).toMatch(/^pricing-[0-9a-f]{8}$/);
    expect(ids[0]).not.toBe(ids[1]);
    expect(pageIdsFor(cfg(a))).toEqual(ids);
    expect(pageIdsFor(cfg(b))).toEqual([ids[1], ids[0]]);
  });
});
