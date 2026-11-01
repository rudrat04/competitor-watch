import { describe, expect, it } from 'vitest';
import {
  collapseWhitespace,
  normalize,
  normalizeQuotesAndDashes,
  stripCacheBustingTokens,
  stripCopyrightYears,
  stripCsrfStrings,
  stripLinkQueryAndFragments,
  stripLongRandomIds,
  stripRelativeTimestamps,
  stripUuids,
} from '../src/snapshot/normalize.js';

describe('normalization rules', () => {
  it('normalizeQuotesAndDashes', () => {
    expect(normalizeQuotesAndDashes('“Hi” it’s a–b—c… x y')).toBe('"Hi" it\'s a-b-c... x y');
  });

  it('stripRelativeTimestamps', () => {
    expect(stripRelativeTimestamps('Posted 3 hours ago, edited an hour ago, just now')).toBe(
      'Posted , edited , ',
    );
    expect(stripRelativeTimestamps('Updated 12 Jan 2025')).toBe('Updated 12 Jan 2025');
  });

  it('stripCopyrightYears', () => {
    expect(stripCopyrightYears('© 2025 Acme')).toBe('© Acme');
    expect(stripCopyrightYears('Copyright © 2019-2025 Acme')).toBe('Copyright © Acme');
    expect(stripCopyrightYears('(c) 2025 Acme')).toBe('(c) Acme');
    expect(stripCopyrightYears('Founded 2025')).toBe('Founded 2025');
  });

  it('stripLinkQueryAndFragments', () => {
    expect(stripLinkQueryAndFragments('[a](https://x.io/p?plan=1&u=2#top) and [b](/c#d)')).toBe(
      '[a](https://x.io/p) and [b](/c)',
    );
    expect(stripLinkQueryAndFragments('[a](https://x.io/p)')).toBe('[a](https://x.io/p)');
  });

  it('stripCacheBustingTokens', () => {
    expect(stripCacheBustingTokens('see https://x.io/app.js?v=1.2.3 now')).toBe(
      'see https://x.io/app.js now',
    );
    expect(stripCacheBustingTokens('https://x.io/?plan=pro')).toBe('https://x.io/?plan=pro');
  });

  it('stripCsrfStrings', () => {
    expect(stripCsrfStrings('x csrf_token: abc123 y')).toBe('x  y');
    expect(stripCsrfStrings('authenticity_token=zzz')).toBe('');
  });

  it('stripUuids', () => {
    expect(stripUuids('id 123e4567-e89b-12d3-a456-426614174000 end')).toBe('id  end');
  });

  it('stripLongRandomIds keeps ordinary words and numbers', () => {
    expect(stripLongRandomIds('session a1b2c3d4e5f6a7b8c9d0e1f2a3 ok')).toBe('session  ok');
    expect(stripLongRandomIds('internationalizationlocalization 2025')).toBe(
      'internationalizationlocalization 2025',
    );
    expect(stripLongRandomIds('$1234567890123456789012345')).toBe('$1234567890123456789012345');
  });

  it('collapseWhitespace', () => {
    expect(collapseWhitespace('a   b \t\n\n\n\n c  \r\n')).toBe('a b\n\n c\n');
  });
});

describe('normalize', () => {
  it('makes volatile-only differences identical', () => {
    const a = 'Posted 3 hours ago\n\n© 2024 Acme\n[x](https://a.io/p?v=1)';
    const b = 'Posted 5 days ago\n\n© 2025 Acme\n[x](https://a.io/p?v=2)';
    expect(normalize(a)).toBe(normalize(b));
  });

  it('keeps real changes', () => {
    expect(normalize('Pro $30')).not.toBe(normalize('Pro $40'));
  });
});
