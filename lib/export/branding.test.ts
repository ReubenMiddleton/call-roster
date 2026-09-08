import { describe, expect, it } from 'vitest';
import {
  buildExportDocument,
  type ExportBranding,
  monthLabel,
  SYNTHETIC_BRANDING,
  validateBranding,
} from './branding.ts';
import { type LayoutDay, layoutMonth } from './calendar-layout.ts';

function grid(month: string, days: readonly LayoutDay[] = []) {
  return layoutMonth({ month, days });
}

describe('monthLabel', () => {
  it('prints the form the practice’s title band uses', () => {
    expect(monthLabel('2024-05')).toBe('May 2024');
    expect(monthLabel('2023-12')).toBe('December 2023');
  });

  it('rejects a malformed month rather than printing rubbish in the banner', () => {
    expect(() => monthLabel('2024')).toThrow(/not an ISO month/);
    expect(() => monthLabel('2024-13')).toThrow(/not an ISO month/);
    expect(() => monthLabel('2024-XX')).toThrow(/not an ISO month/);
  });
});

describe('the committed default branding', () => {
  it('is valid', () => {
    expect(validateBranding(SYNTHETIC_BRANDING)).toEqual([]);
  });

  it('names nobody real and embeds no logo', () => {
    // The data boundary, asserted rather than trusted: this repository is public and a screenshot
    // of a test must not identify a practice. See AGENTS.md.
    expect(SYNTHETIC_BRANDING.practiceName).toContain('EXAMPLE');
    expect(SYNTHETIC_BRANDING.logo).toBeUndefined();
  });

  it('does not mark holidays, because no house style has been confirmed', () => {
    // `none` is a deliberate choice. Guessing a colour would be inventing the practice's style.
    expect(SYNTHETIC_BRANDING.holidayMarking).toBe('none');
  });
});

describe('validateBranding', () => {
  it('catches an empty practice name', () => {
    expect(validateBranding({ ...SYNTHETIC_BRANDING, practiceName: '   ' })).toContainEqual(
      expect.stringContaining('practiceName is empty'),
    );
  });

  it('catches a colour that is not six-digit hex', () => {
    // An invalid colour renders transparent, which on a printed roster reads as a design fault
    // rather than a misconfiguration — so it must be caught at the settings screen.
    const problems = validateBranding({ ...SYNTHETIC_BRANDING, titleBandColour: 'grey' });
    expect(problems).toContainEqual(expect.stringContaining('titleBandColour is "grey"'));
  });

  it('rejects an external logo URL', () => {
    // An external image fails offline, fails in a PDF, and leaks a request to whoever hosts it.
    const problems = validateBranding({
      ...SYNTHETIC_BRANDING,
      logo: { dataUri: 'https://example.invalid/logo.png', alt: 'Logo' },
    });
    expect(problems).toContainEqual(expect.stringContaining('must be a data: URI'));
  });

  it('requires alternative text on a logo', () => {
    const problems = validateBranding({
      ...SYNTHETIC_BRANDING,
      logo: { dataUri: 'data:image/png;base64,AAAA', alt: '' },
    });
    expect(problems).toContainEqual(expect.stringContaining('logo.alt is empty'));
  });

  it('accepts a valid data-URI logo', () => {
    expect(
      validateBranding({
        ...SYNTHETIC_BRANDING,
        logo: { dataUri: 'data:image/svg+xml,%3Csvg%2F%3E', alt: 'Practice logo' },
      }),
    ).toEqual([]);
  });
});

describe('buildExportDocument', () => {
  it('prints doctor codes by default', () => {
    // A renderer given codes prints codes. Correct for a test, a demo or a screenshot, and it means
    // the code-to-name mapping never has to exist in this layer.
    const document = buildExportDocument({ grid: grid('2025-02') });
    expect(document.labelFor('D01')).toBe('D01');
    expect(document.labelStyle).toBe('code');
    expect(document.branding).toBe(SYNTHETIC_BRANDING);
  });

  it('takes a tenant’s own label resolver', () => {
    const document = buildExportDocument({
      grid: grid('2025-02'),
      labelFor: (doctor) => (doctor === 'D01' ? 'Example' : doctor),
      labelStyle: 'surname',
    });
    expect(document.labelFor('D01')).toBe('Example');
    expect(document.labelStyle).toBe('surname');
  });

  it('derives the month label from the grid', () => {
    expect(buildExportDocument({ grid: grid('2024-05') }).monthLabel).toBe('May 2024');
  });

  it('refuses to build with invalid branding rather than rendering it', () => {
    const broken: ExportBranding = { ...SYNTHETIC_BRANDING, accentBandColour: 'blue' };
    expect(() => buildExportDocument({ grid: grid('2025-02'), branding: broken })).toThrow(
      /invalid export branding/,
    );
  });

  it('carries the draft flag and its deadline through', () => {
    // The renderer has to make a draft unmistakable — see lifecycle.md. Somebody glancing at a
    // phone screenshot in a group chat must tell in one second which one they hold.
    const document = buildExportDocument({
      grid: grid('2025-02'),
      draft: { reviewDeadline: '2025-01-25' },
    });
    expect(document.draft?.reviewDeadline).toBe('2025-01-25');
  });

  it('omits the draft flag entirely for a final version', () => {
    expect(buildExportDocument({ grid: grid('2025-02') }).draft).toBeUndefined();
  });
});
