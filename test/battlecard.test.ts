import { describe, expect, it } from 'vitest';
import {
  CardError,
  MAX_RECENT_CHANGES,
  SECTION_HEADINGS,
  mergeRecent,
  parseCard,
  recentEntries,
  renderCard,
  sanitizeBody,
  sectionBody,
  updateCard,
} from '../src/llm/battlecard-doc.js';
import { buildCreateMessage, buildUpdateMessage } from '../src/llm/battlecard.js';

const content = {
  overview: 'Rival sells anvils.',
  pricing: '- Starter $10\n- Pro $30',
  positioning: 'Simple and cheap.',
  strengths: 'Strong brand.',
  handling: 'Lead with support.',
};
const card = () => renderCard('Rival Inc', content, [], '2026-11-01');

describe('battlecard document', () => {
  it('renders every required section in plan order, with a last-updated footer', () => {
    const md = card();
    const headings = [...md.matchAll(/^## (.*)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      'Overview',
      'Pricing & packaging',
      'Positioning & messaging',
      'Recent changes',
      "Where they're strong / where we win",
      'How to handle them in a sales conversation',
    ]);
    expect(md.startsWith('# Rival Inc — Battlecard')).toBe(true);
    expect(md.trimEnd().endsWith('_Last updated: 2026-11-01_')).toBe(true);
    expect(sectionBody(md, 'recent')).toBe('_No changes recorded yet._');
  });

  it('updating one section leaves every other section byte-identical', () => {
    const md = card();
    const out = updateCard(md, { pricing: '- Starter $10\n- Pro $45' }, [], '2026-11-02');
    const before = parseCard(md).sections;
    const after = parseCard(out).sections;
    for (const [i, s] of before.entries()) {
      if (s.heading === SECTION_HEADINGS.pricing) {
        expect(after[i]!.raw).not.toBe(s.raw);
        expect(after[i]!.raw).toContain('$45');
      } else {
        expect(after[i]!.raw).toBe(s.raw);
      }
    }
    expect(out).toContain('_Last updated: 2026-11-02_');
  });

  it('preserves hand edits in untouched sections, including odd whitespace', () => {
    const md = card().replace('Strong brand.', 'Strong brand.   \n\n\n- my own note\n');
    const out = updateCard(md, { overview: 'New overview.' }, [], '2026-11-02');
    const pick = (m: string) =>
      parseCard(m).sections.find((s) => s.heading.startsWith('Where'))!.raw;
    expect(pick(out)).toBe(pick(md));
    expect(pick(out)).toContain('my own note');
  });

  it('the last section is byte-identical too (footer stripping must not touch it)', () => {
    const md = card();
    const last = (m: string) => parseCard(m).sections.at(-1)!.raw;
    expect(last(updateCard(md, { overview: 'x' }, [], '2026-11-02'))).toBe(last(md));
  });

  it('null, undefined and blank updates leave sections untouched', () => {
    const md = card();
    const out = updateCard(
      md,
      { overview: null, pricing: '   ', handling: undefined },
      [],
      '2026-11-01',
    );
    expect(out).toBe(md);
  });

  it('no updates and no entries only bumps the date', () => {
    const out = updateCard(card(), {}, [], '2026-12-25');
    expect(out).toBe(card().replace('2026-11-01', '2026-12-25'));
  });

  it('model text cannot create new headings', () => {
    expect(sanitizeBody('# Hacked\nok\n### Sub')).toBe('**Hacked**\nok\n**Sub**');
    const out = updateCard(card(), { positioning: '## Injected\ntext' }, [], '2026-11-02');
    expect([...out.matchAll(/^## /gm)]).toHaveLength(6);
  });

  it('refuses to update a card that is missing a required section', () => {
    const broken = card().replace('## Positioning & messaging', '## Something else');
    expect(() => updateCard(broken, { overview: 'x' }, [], '2026-11-02')).toThrow(CardError);
    expect(() => parseCard('just text')).toThrow(/no "##" sections/);
  });

  it('recent changes: newest first, existing kept, de-duplicated, capped at 15', () => {
    let md = card();
    for (let i = 1; i <= 20; i++) {
      md = updateCard(
        md,
        {},
        [`- **2026-11-${String(i).padStart(2, '0')}** change ${i}`],
        '2026-11-30',
      );
    }
    const entries = recentEntries(md);
    expect(entries).toHaveLength(MAX_RECENT_CHANGES);
    expect(entries[0]).toContain('change 20');
    expect(entries.at(-1)).toContain('change 6');
    expect(mergeRecent(['- a', '- b'], ['- b', '- c'])).toEqual(['- a', '- b', '- c']);
  });

  it('recent-only updates leave the model-written sections byte-identical', () => {
    const md = card();
    const out = updateCard(md, {}, ['- **2026-11-02** [material · pricing] Pro up'], '2026-11-02');
    const keep = (m: string) =>
      parseCard(m)
        .sections.filter((s) => s.heading !== 'Recent changes')
        .map((s) => s.raw);
    expect(keep(out)).toEqual(keep(md));
    expect(sectionBody(out, 'recent')).toBe('- **2026-11-02** [material · pricing] Pro up');
  });
});

describe('battlecard prompts', () => {
  const company = { name: 'Acme', description: 'Anvils', positioning: 'Cheap' };

  it('create message includes company and every page, and flags truncation explicitly', () => {
    const m = buildCreateMessage(company, 'Rival', [
      { pageType: 'pricing', url: 'https://r.io/p', markdown: 'Pro $30' },
      { pageType: 'homepage', url: 'https://r.io', markdown: 'x'.repeat(20_000) },
    ]);
    for (const s of [
      'Name: Acme',
      'Competitor: Rival',
      'Type: pricing',
      'Pro $30',
      'Type: homepage',
    ]) {
      expect(m).toContain(s);
    }
    expect(m).toMatch(/page text truncated: 8000 more characters not shown/);
  });

  it('update message includes the card, summaries, analysis and diff', () => {
    const m = buildUpdateMessage(company, 'Rival', '# card', [
      {
        pageType: 'pricing',
        url: 'https://r.io/p',
        significance: 'material',
        category: 'pricing',
        summary: 'Pro up',
        diffText: '-Pro $30\n+Pro $45',
        analysis: {
          what_changed: 'W',
          why_it_matters: 'Y',
          impact_on_us: 'I',
          suggested_response: 'S',
          confidence: 'low',
        },
      },
    ]);
    for (const s of [
      '# card',
      'Summary: Pro up',
      'What changed: W',
      '+Pro $45',
      'material / pricing',
    ]) {
      expect(m).toContain(s);
    }
  });
});
