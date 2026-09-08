/**
 * Builds a tenant branding file from a logo image on disk.
 *
 * The logo is embedded as a data URI rather than referenced by path, because the export has to
 * render identically offline, inside a PDF, and in a WhatsApp screenshot — three contexts where an
 * external image request either fails or leaks a request to whoever hosts it.
 *
 * ⚠️ **Writes into `private/` and must stay there.** A tenant's name and logo are exactly what the
 * data boundary keeps out of the repository; `npm run publish:check` fails on any image anywhere.
 *
 *   node scripts/make-branding.mjs "PRACTICE NAME" private/template/logo.png
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const [, , practiceName, logoPath, outPath = 'private/template/branding.json'] = process.argv;

if (practiceName === undefined || logoPath === undefined) {
  console.error('usage: node scripts/make-branding.mjs "PRACTICE NAME" <logo.png> [out.json]');
  process.exit(1);
}

if (!outPath.startsWith('private/') && !outPath.startsWith('private\\')) {
  console.error(
    `refusing to write branding to "${outPath}". A tenant's name and logo live only under private/.`,
  );
  process.exit(1);
}

const extension = path.extname(logoPath).toLowerCase();
const mime =
  extension === '.svg' ? 'image/svg+xml' : extension === '.jpg' ? 'image/jpeg' : 'image/png';
const bytes = await readFile(logoPath);

// Measured from the source .docx: accent band #76C5EF, title band #7F7F7F, white title text, and
// no holiday marking anywhere in the file.
const branding = {
  practiceName,
  logo: {
    dataUri: `data:${mime};base64,${bytes.toString('base64')}`,
    alt: `${practiceName} logo`,
  },
  accentBandColour: '#76c5ef',
  titleBandColour: '#7f7f7f',
  titleTextColour: '#ffffff',
  holidayMarking: 'none',
};

await writeFile(outPath, `${JSON.stringify(branding, null, 2)}\n`, 'utf8');
console.log(`wrote ${outPath} — logo ${(bytes.length / 1024).toFixed(0)} KB embedded`);
