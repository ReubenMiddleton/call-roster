/**
 * Per-tenant export branding, and the complete document a renderer consumes.
 *
 * **This is a seam, not a feature.** The renderer does not exist yet. It was waiting on the practice's
 * Word source, because a photograph cannot settle column widths, the font at print size, or how an
 * over-long name wraps; that arrived on 6 September 2026 and the measurements are in
 * [`docs/product/export.md`](../../docs/product/export.md). What exists here is the *shape* those
 * numbers fill, so the remaining work is rendering rather than redesigning.
 *
 * ## Why branding is a parameter and not a constant
 *
 * Two independent reasons, and they happen to agree.
 *
 * **Productisation** ([ADR-0010](../../docs/architecture/decisions/0010-productisation-seams-first.md)):
 * the second practice has a different name, logo and colours. Baking one tenant's identity into the
 * export is exactly the kind of seam that is cheap to build now and expensive to retrofit.
 *
 * **The data boundary** (AGENTS.md): this repository is public. **Nothing committed names the practice
 * or embeds its logo** — the defaults below are deliberately synthetic, and the real values live only
 * in tenant configuration. A screenshot of a test must not identify anybody.
 */

import type { MonthGrid } from './calendar-layout.ts';

/**
 * An image supplied by a tenant, as a data URI.
 *
 * A data URI rather than a URL because the export has to render identically offline, in a PDF, and in
 * a WhatsApp screenshot — three contexts where an external image request either fails or leaks a
 * request to whoever hosts it.
 */
export interface BrandingImage {
  /** `data:image/png;base64,…` or `data:image/svg+xml,…`. */
  readonly dataUri: string;
  /** Alternative text. Required — the export is a document, not decoration. */
  readonly alt: string;
}

/**
 * The look of one tenant's export.
 *
 * Field names describe what the reader sees, not the markup: a practice has a *name* and an
 * *accent band*, not a `headerConfig`.
 */
export interface ExportBranding {
  /** As printed in the banner. Bold caps on the practice's own sheets. */
  readonly practiceName: string;
  /** Top-left of the banner. Optional: a tenant without a logo still gets a clean export. */
  readonly logo?: BrandingImage;
  /** The upper band. `#5BB8E8`-ish on the practice's sheets. */
  readonly accentBandColour: string;
  /** The lower band carrying the name and the month. Mid-grey on the practice's sheets. */
  readonly titleBandColour: string;
  /** Text on the title band. */
  readonly titleTextColour: string;
  /**
   * How a public holiday is marked in a cell.
   *
   * `none` is a legitimate choice and is the current default, because the practice's sheets do not
   * obviously mark them and guessing a colour would be inventing house style.
   */
  readonly holidayMarking: 'none' | 'bold' | 'tint';
}

/**
 * A deliberately synthetic default, safe to commit and safe to screenshot.
 *
 * **Not the practice's branding.** The name is invented and there is no logo. Its purpose is to make
 * every test, fixture and demo render something plausible without identifying anybody — see the data
 * boundary in AGENTS.md.
 */
export const SYNTHETIC_BRANDING: ExportBranding = {
  practiceName: 'EXAMPLE EMERGENCY PRACTICE',
  accentBandColour: '#5bb8e8',
  titleBandColour: '#808080',
  titleTextColour: '#ffffff',
  holidayMarking: 'none',
};

/**
 * How a doctor is printed in a cell.
 *
 * The practice's sheets print **surnames only**. That is a rendering choice belonging to the tenant,
 * not a property of the data — the ledger and the solver never see anything but a code.
 */
export type DoctorLabelStyle = 'surname' | 'code' | 'full-name';

export interface ExportDocument {
  readonly branding: ExportBranding;
  readonly grid: MonthGrid;
  /** `May 2024` — as printed at the right of the title band. */
  readonly monthLabel: string;
  /**
   * Resolves a doctor code to what the cell prints.
   *
   * **A function rather than a map, so the mapping never has to exist in this layer.** Real names live
   * only in tenant configuration, and a renderer given codes prints codes — which is the correct
   * behaviour for a demo, a test, or a screenshot.
   */
  readonly labelFor: (doctor: string) => string;
  readonly labelStyle: DoctorLabelStyle;
  /**
   * Set when the roster is a draft rather than the final version.
   *
   * The renderer must make this unmistakable — a diagonal watermark and the review deadline in the
   * header, per [`lifecycle.md`](../../docs/product/lifecycle.md). Somebody glancing at a phone
   * screenshot in a WhatsApp group has to tell in one second which one they are holding.
   */
  readonly draft?: { readonly reviewDeadline: string };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** `2024-05` becomes `May 2024`, the form the practice's title band uses. */
export function monthLabel(month: string): string {
  const parts = month.split('-');
  const [year, monthNumber] = parts;
  if (parts.length !== 2 || year === undefined || monthNumber === undefined) {
    throw new Error(`not an ISO month: "${month}"`);
  }
  const name = MONTH_NAMES[Number(monthNumber) - 1];
  if (name === undefined) {
    throw new Error(`not an ISO month: "${month}"`);
  }
  return `${name} ${year}`;
}

/**
 * Checks branding before it reaches a renderer.
 *
 * Returns problems rather than throwing, so a settings screen can show all of them at once. An
 * invalid colour would render as transparent, which on a printed roster reads as a design fault
 * rather than a misconfiguration.
 */
export function validateBranding(branding: ExportBranding): readonly string[] {
  const problems: string[] = [];

  if (branding.practiceName.trim() === '') {
    problems.push('practiceName is empty; the title band would print blank');
  }

  const colours: readonly [string, string][] = [
    ['accentBandColour', branding.accentBandColour],
    ['titleBandColour', branding.titleBandColour],
    ['titleTextColour', branding.titleTextColour],
  ];
  for (const [field, value] of colours) {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
      problems.push(`${field} is "${value}"; expected a six-digit hex colour like #5bb8e8`);
    }
  }

  if (branding.logo !== undefined) {
    if (!branding.logo.dataUri.startsWith('data:image/')) {
      problems.push(
        'logo.dataUri must be a data: URI. An external URL fails offline, in a PDF, and leaks a request to whoever hosts it',
      );
    }
    if (branding.logo.alt.trim() === '') {
      problems.push('logo.alt is empty; the export is a document, not decoration');
    }
  }

  return problems;
}

/** Assembles a document. The one place branding, grid and labelling meet. */
export function buildExportDocument(options: {
  readonly grid: MonthGrid;
  readonly branding?: ExportBranding;
  readonly labelFor?: (doctor: string) => string;
  readonly labelStyle?: DoctorLabelStyle;
  readonly draft?: { readonly reviewDeadline: string };
}): ExportDocument {
  const branding = options.branding ?? SYNTHETIC_BRANDING;
  const problems = validateBranding(branding);
  if (problems.length > 0) {
    throw new Error(`invalid export branding: ${problems.join('; ')}`);
  }
  return {
    branding,
    grid: options.grid,
    monthLabel: monthLabel(options.grid.month),
    // Identity by default: a renderer given codes prints codes, which is right for a test or a demo.
    labelFor: options.labelFor ?? ((doctor) => doctor),
    labelStyle: options.labelStyle ?? 'code',
    ...(options.draft === undefined ? {} : { draft: options.draft }),
  };
}
