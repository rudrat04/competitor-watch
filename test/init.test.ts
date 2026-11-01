import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { notConfiguredReason, parseConfig } from '../src/config.js';
import { EXAMPLE_CONFIG, EXAMPLE_ENV } from '../src/init.js';

describe('init templates', () => {
  it('stay identical to the example files in the repo', () => {
    expect(EXAMPLE_CONFIG).toBe(readFileSync('competitors.example.yaml', 'utf8'));
    expect(EXAMPLE_ENV).toBe(readFileSync('.env.example', 'utf8'));
    expect(readFileSync('template/competitors.yaml', 'utf8')).toBe(EXAMPLE_CONFIG);
  });

  it('the created config is valid but "not configured yet"', () => {
    expect(notConfiguredReason(parseConfig(EXAMPLE_CONFIG))).not.toBeNull();
  });
});
