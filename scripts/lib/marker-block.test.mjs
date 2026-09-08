import { describe, expect, it } from 'vitest';
import { escapeRegExp, extractBlock } from './marker-block.mjs';

describe('extractBlock', () => {
  it('extracts one entry per line, in order', () => {
    const markdown = [
      '# heading',
      '<!-- SURNAMES:BEGIN -->',
      'Alpha',
      'Bravo',
      'Charlie',
      '<!-- SURNAMES:END -->',
      'trailing prose',
    ].join('\n');

    expect(extractBlock(markdown, 'SURNAMES')).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('keeps multi-word entries intact', () => {
    const markdown = '<!-- SURNAMES:BEGIN -->\nVan der Example\nde Sample\n<!-- SURNAMES:END -->';
    expect(extractBlock(markdown, 'SURNAMES')).toEqual(['Van der Example', 'de Sample']);
  });

  it('trims surrounding whitespace and drops blank lines', () => {
    const markdown = '<!-- ALLOW:BEGIN -->\n\n  Padded Entry  \n\n\nSecond\n<!-- ALLOW:END -->';
    expect(extractBlock(markdown, 'ALLOW')).toEqual(['Padded Entry', 'Second']);
  });

  it('ignores comment lines inside the block', () => {
    const markdown = [
      '<!-- ALLOW:BEGIN -->',
      '<!-- a note to a human -->',
      'Real Entry',
      '<!-- ALLOW:END -->',
    ].join('\n');
    expect(extractBlock(markdown, 'ALLOW')).toEqual(['Real Entry']);
  });

  it('tolerates loose spacing in the markers', () => {
    const markdown = '<!--SURNAMES:BEGIN-->\nAlpha\n<!--   SURNAMES:END   -->';
    expect(extractBlock(markdown, 'SURNAMES')).toEqual(['Alpha']);
  });

  it('selects the requested block when several are present', () => {
    const markdown = [
      '<!-- SURNAMES:BEGIN -->',
      'Name',
      '<!-- SURNAMES:END -->',
      '<!-- ALLOW:BEGIN -->',
      'Allowed Literal',
      '<!-- ALLOW:END -->',
    ].join('\n');

    expect(extractBlock(markdown, 'SURNAMES')).toEqual(['Name']);
    expect(extractBlock(markdown, 'ALLOW')).toEqual(['Allowed Literal']);
  });

  // The following four cases are the ones that matter. Each returns an empty list, and
  // an empty surname list means the data-boundary check would pass everything. The
  // caller is responsible for treating "no surnames parsed" as a failure rather than a
  // clean result — see the guard in scripts/check-no-real-names.mjs.
  it('returns empty when the block is absent', () => {
    expect(extractBlock('# just a heading', 'SURNAMES')).toEqual([]);
  });

  it('returns empty when the END marker is missing', () => {
    expect(extractBlock('<!-- SURNAMES:BEGIN -->\nAlpha\n', 'SURNAMES')).toEqual([]);
  });

  it('returns empty when the block is present but empty', () => {
    expect(extractBlock('<!-- SURNAMES:BEGIN -->\n\n<!-- SURNAMES:END -->', 'SURNAMES')).toEqual(
      [],
    );
  });

  it('returns empty for non-string or empty input', () => {
    expect(extractBlock(undefined, 'SURNAMES')).toEqual([]);
    expect(extractBlock('<!-- SURNAMES:BEGIN -->\nA\n<!-- SURNAMES:END -->', '')).toEqual([]);
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters so a name is matched literally', () => {
    expect(escapeRegExp('a.b*c+d?e')).toBe('a\\.b\\*c\\+d\\?e');
    expect(escapeRegExp('O(Brien)')).toBe('O\\(Brien\\)');
  });

  it('leaves ordinary letters, spaces and hyphens alone', () => {
    expect(escapeRegExp('Van der Example-Name')).toBe('Van der Example-Name');
  });

  it('makes an escaped value match its literal source', () => {
    const literal = 'Smith-Jones (Jr.)';
    expect(new RegExp(escapeRegExp(literal)).test(literal)).toBe(true);
  });
});
