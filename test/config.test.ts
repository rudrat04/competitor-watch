import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigError, notConfiguredReason, parseConfig, slugify } from '../src/config.js';

const valid = `
company:
  name: "Acme"
  description: "We sell anvils."
competitors:
  - name: "Rival Inc"
    pages:
      - type: pricing
        url: "https://rival.io/pricing"
`;

describe('parseConfig', () => {
  it('accepts a minimal config and applies defaults', () => {
    const c = parseConfig(valid);
    expect(c.settings.max_cost_usd).toBe(1);
    expect(c.settings.min_change_chars).toBe(40);
    expect(c.settings.allow_public_repo).toBe(false);
    expect(c.settings.notify.github_issue).toBe(true);
    expect(c.competitors[0]?.pages[0]?.render).toBe(false);
  });

  it('parses the shipped example file', () => {
    const c = parseConfig(readFileSync('competitors.example.yaml', 'utf8'));
    expect(c.competitors).toHaveLength(1);
  });

  it('reports invalid YAML', () => {
    expect(() => parseConfig('a: [')).toThrow(ConfigError);
  });

  it('gives field-specific errors', () => {
    const bad = valid
      .replace('https://rival.io/pricing', 'ftp://rival.io')
      .replace('pricing', 'nope');
    try {
      parseConfig(bad);
      expect.unreachable();
    } catch (err) {
      const issues = (err as ConfigError).issues.join('\n');
      expect(issues).toContain('competitors[0].pages[0].type');
      expect(issues).toContain('competitors[0].pages[0].url');
    }
  });

  it('rejects non-http URLs', () => {
    expect(() =>
      parseConfig(valid.replace('https://rival.io/pricing', 'ftp://rival.io/x')),
    ).toThrow(/http/);
  });

  it('rejects an empty competitors list', () => {
    expect(() => parseConfig('company: {name: A, description: B}\ncompetitors: []')).toThrow(
      /at least one competitor/,
    );
  });

  it('rejects a competitor with no pages', () => {
    expect(() =>
      parseConfig('company: {name: A, description: B}\ncompetitors: [{name: X, pages: []}]'),
    ).toThrow(/at least one page/);
  });

  it('rejects duplicate slugs', () => {
    const dup =
      valid +
      `  - name: "rival inc!"\n    pages:\n      - type: blog\n        url: "https://x.io"\n`;
    expect(() => parseConfig(dup)).toThrow(/same id/);
  });

  it('rejects empty alert_on keywords and unknown keys', () => {
    expect(() =>
      parseConfig(valid.replace('type: pricing', 'type: pricing\n        alert_on: [""]')),
    ).toThrow(/non-empty/);
    expect(() => parseConfig(valid + 'extra: 1\n')).toThrow(ConfigError);
  });
});

describe('notConfiguredReason', () => {
  it('flags the placeholder company name', () => {
    const c = parseConfig(valid.replace('Acme', 'YOUR COMPANY'));
    expect(notConfiguredReason(c)).toMatch(/YOUR COMPANY/);
  });

  it('flags example.com URLs, including subdomains', () => {
    expect(notConfiguredReason(parseConfig(valid.replace('rival.io', 'example.com')))).toMatch(
      /example\.com/,
    );
    expect(
      notConfiguredReason(parseConfig(valid.replace('rival.io', 'www.example.com'))),
    ).not.toBeNull();
  });

  it('does not flag lookalike hosts or real configs', () => {
    expect(notConfiguredReason(parseConfig(valid))).toBeNull();
    expect(
      notConfiguredReason(parseConfig(valid.replace('rival.io', 'notexample.com'))),
    ).toBeNull();
  });

  it('flags the shipped example file as not configured', () => {
    const c = parseConfig(readFileSync('competitors.example.yaml', 'utf8'));
    expect(notConfiguredReason(c)).not.toBeNull();
  });
});

describe('slugify', () => {
  it('builds stable slugs', () => {
    expect(slugify('Example Competitor')).toBe('example-competitor');
    expect(slugify('  Café & Co. ')).toBe('cafe-co');
    expect(slugify('!!!')).toBe('');
  });
});
