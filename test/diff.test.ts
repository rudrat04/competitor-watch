import { describe, expect, it } from 'vitest';
import { diffSnapshots, formatHunks } from '../src/diff/differ.js';
import {
  countOccurrences,
  describeHit,
  findKeywordHits,
  mergeKeywords,
} from '../src/diff/keywords.js';
import { isTrivial } from '../src/diff/threshold.js';
import { extractMarkdown } from '../src/fetch/extract.js';
import { normalize } from '../src/snapshot/normalize.js';
import { fixture } from './helpers.js';

const snap = (name: string) =>
  normalize(extractMarkdown(fixture(name), 'https://rival.io/pricing'));

describe('diffSnapshots', () => {
  it('returns no hunks for identical text', () => {
    const d = diffSnapshots('a\nb\n', 'a\nb\n');
    expect(d.hunks).toEqual([]);
    expect(d.changedChars).toBe(0);
  });

  it('counts added + removed line characters and keeps context', () => {
    const old = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n';
    const d = diffSnapshots(old, old.replace('five', 'FIVE!'), 1);
    expect(d.removedChars).toBe(4);
    expect(d.addedChars).toBe(5);
    expect(d.changedChars).toBe(9);
    expect(d.hunks[0]?.lines).toEqual([' four', '-five', '+FIVE!', ' six']);
    expect(formatHunks(d)).toContain('@@ -4 +4 @@');
  });

  it('pricing fixture: hunks contain the new price and plan', () => {
    const d = diffSnapshots(snap('pricing-before.html'), snap('pricing-after.html'));
    const text = formatHunks(d);
    expect(text).toContain('+$45 per user per month');
    expect(text).toContain('+## Enterprise');
    expect(isTrivial(d, 40)).toBe(false);
  });

  it("copy-tweak fixture: a real diff that still needs triage (noise is the LLM's call)", () => {
    const d = diffSnapshots(snap('pricing-before.html'), snap('copy-after.html'));
    expect(d.hunks.length).toBe(1);
    expect(isTrivial(d, 40)).toBe(false);
  });

  it('volatile-only fixture normalizes to identical text', () => {
    expect(snap('volatile-after.html')).toBe(snap('pricing-before.html'));
  });
});

describe('isTrivial', () => {
  it('is true strictly below the threshold', () => {
    const d = diffSnapshots('a\n', 'b\n');
    expect(d.changedChars).toBe(2);
    expect(isTrivial(d, 3)).toBe(true);
    expect(isTrivial(d, 2)).toBe(false);
  });
});

describe('keywords', () => {
  it('merges global and per-page lists case-insensitively', () => {
    expect(mergeKeywords(['Free plan', 'SSO'], ['free PLAN', 'enterprise'])).toEqual([
      'Free plan',
      'SSO',
      'enterprise',
    ]);
    expect(mergeKeywords(undefined, ['x'])).toEqual(['x']);
  });

  it('matches case-insensitively and by whole word only', () => {
    expect(countOccurrences('Free Plan, free plan', 'free plan')).toBe(2);
    expect(countOccurrences('freeplan', 'free plan')).toBe(0);
    expect(countOccurrences('the cat scatters', 'cat')).toBe(1);
    expect(countOccurrences('SSO-ready', 'sso')).toBe(1);
  });

  it('handles keywords with punctuation and treats regex characters literally', () => {
    expect(countOccurrences('only $99 today', '$99')).toBe(1);
    expect(countOccurrences('we love C++ a lot', 'C++')).toBe(1);
    expect(countOccurrences('abc', 'a.c')).toBe(0);
  });

  it('flags appeared and removed', () => {
    expect(findKeywordHits('basic', 'basic and enterprise', ['enterprise'])).toEqual([
      { keyword: 'enterprise', change: 'appeared' },
    ]);
    const hits = findKeywordHits('has Free Plan', 'nothing', ['free plan']);
    expect(hits).toEqual([{ keyword: 'free plan', change: 'removed' }]);
    expect(describeHit(hits[0]!)).toBe('Keyword trigger: "free plan" removed');
  });

  it('a count change without appearing/disappearing is not a hit', () => {
    expect(findKeywordHits('sso', 'sso sso sso', ['sso'])).toEqual([]);
    expect(findKeywordHits('sso sso', 'sso', ['sso'])).toEqual([]);
    expect(findKeywordHits('none', 'none', ['sso'])).toEqual([]);
  });
});
