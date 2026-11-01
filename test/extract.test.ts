import { describe, expect, it } from 'vitest';
import { EmptyContentError, IncludeNoMatchError, extractMarkdown } from '../src/fetch/extract.js';
import { fixture } from './helpers.js';

const URL_ = 'https://rival.io/pricing';

describe('extractMarkdown', () => {
  it('without include: strips nav, footer, cookie banner, scripts; keeps content', () => {
    const md = extractMarkdown(fixture('pricing-before.html'), URL_);
    expect(md).toContain('Starter');
    expect(md).toContain('$30 per user per month');
    expect(md).not.toContain('We use cookies');
    expect(md).not.toContain('Rival Inc');
    expect(md).not.toContain('csrf');
  });

  it('absolutizes relative links', () => {
    const md = extractMarkdown(fixture('pricing-before.html'), URL_);
    expect(md).toContain('(https://rival.io/signup');
  });

  it('include: keeps only matches, in document order, skipping Readability', () => {
    const md = extractMarkdown(fixture('pricing-before.html'), URL_, {
      include: ['.pricing-table'],
    });
    expect(md.indexOf('Starter')).toBeLessThan(md.indexOf('Pro'));
    expect(md).not.toContain('Simple plans');
    expect(md).not.toContain('Loved by teams');
  });

  it('include: multiple selectors still come out in document order', () => {
    const md = extractMarkdown(fixture('pricing-before.html'), URL_, {
      include: ['h2:last-of-type', '.pricing-table h2'],
    });
    expect(md.indexOf('Starter')).toBeLessThan(md.indexOf('Pro'));
  });

  it('include: nested matches are not duplicated', () => {
    const html = '<div class="a"><p class="b">only once</p></div>';
    const md = extractMarkdown(html, URL_, { include: ['.a', '.b'] });
    expect(md.match(/only once/g)).toHaveLength(1);
  });

  it('include: works for elements inside nav/footer', () => {
    const html = '<footer><div class="price">$5</div></footer>';
    expect(extractMarkdown(html, URL_, { include: ['.price'] })).toContain('$5');
  });

  it('include matching nothing is an error', () => {
    expect(() =>
      extractMarkdown(fixture('pricing-before.html'), URL_, { include: ['.nope'] }),
    ).toThrow(IncludeNoMatchError);
  });

  it('ignore removes elements', () => {
    const md = extractMarkdown(fixture('pricing-before.html'), URL_, { ignore: ['.testimonial'] });
    expect(md).not.toContain('Loved by teams');
  });

  it('an invalid ignore selector is skipped, not fatal', () => {
    expect(() =>
      extractMarkdown(fixture('pricing-before.html'), URL_, { ignore: ['[['] }),
    ).not.toThrow();
  });

  it('falls back to body text when Readability finds nothing', () => {
    const md = extractMarkdown('<html><body><p>Tiny page</p></body></html>', URL_);
    expect(md).toContain('Tiny page');
  });

  it('empty page is an error, never an empty snapshot', () => {
    expect(() => extractMarkdown('<html><body><script>x</script></body></html>', URL_)).toThrow(
      EmptyContentError,
    );
  });
});
