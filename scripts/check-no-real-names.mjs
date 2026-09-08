/**
 * Fails the quality gate if a real doctor surname appears anywhere outside private/.
 *
 * Why this exists
 * ---------------
 * This repository is public. The practice's source material identifies thirteen real
 * doctors and shows, day by day, where each of them was for over a year. Under POPIA
 * that is personal information about identifiable living people who have not consented
 * to its publication. The rule is that real names never leave private/ — and this is
 * the only thing that will still be enforcing that rule in six months, when nobody is
 * thinking about it any more.
 *
 * The names themselves are NOT in this file. They are parsed from the marker block in
 * private/doctor-codes.md, which is gitignored, so committing this script leaks nothing.
 *
 * Matching is deliberately conservative: case-sensitive, word-boundary anchored, and
 * filtered through an allowlist of known-safe collisions. Several of the surnames are
 * ordinary English or Afrikaans words, or appear in academic sources the project cites.
 * A check that fires on innocent prose gets switched off by the first person it annoys,
 * and then it protects nothing at all. Under-matching a rare edge case is recoverable;
 * being disabled is not.
 */

import { constants } from 'node:fs';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { escapeRegExp, extractBlock } from './lib/marker-block.mjs';

const root = process.cwd();
const mappingFile = path.join(root, 'private', 'doctor-codes.md');
const selfPath = path.join('scripts', 'check-no-real-names.mjs');

const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.tools',
  'coverage',
  'dist',
  'node_modules',
  '.venv',
  'venv',
  'site-packages',
  'out',
  'playwright-report',
  'private',
  'test-results',
  '.pytest_cache',
  '.ruff_cache',
  '__pycache__',
]);

// Text formats worth scanning. Anything not listed is skipped rather than scanned as
// bytes — a false hit inside a PNG would be noise, and images live in private/ anyway.
const scannedExtensions = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.toml',
  '.css',
  '.scss',
  '.html',
  '.svg',
  '.py',
  '.ps1',
  '.sh',
  '.sql',
  '.env',
  '.example',
  '.ics',
  '.csv',
]);

const scannedFilenames = new Set([
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  'LICENSE',
  'Dockerfile',
]);

// Directories excluded by RELATIVE PATH rather than by name, so that a legitimately
// named directory elsewhere in the tree is still scanned. graphify-out/ itself must be
// scanned because graph.json, GRAPH_REPORT.md and manifest.json are committed - only
// its cache is not.
const ignoredRelativePaths = new Set([path.join('graphify-out', 'cache')]);

const MAX_BYTES = 2 * 1024 * 1024;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const relative = path.relative(root, full);
      if (!ignoredDirectories.has(entry.name) && !ignoredRelativePaths.has(relative)) {
        files.push(...(await collectFiles(full)));
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (scannedExtensions.has(ext) || scannedFilenames.has(entry.name)) files.push(full);
    }
  }
  return files;
}

/**
 * Ranges in `content` covered by an allowlisted literal, e.g. a cited author's name.
 *
 * Matching is **whitespace-insensitive across the literal's interior**, because a plain
 * `indexOf` is defeated by prose wrapping. Documents here wrap at 100 columns, so an
 * allowlisted phrase like `<author>'s monotone chain` stops matching the moment a line break
 * lands inside it — and the check then fires on a phrase that is already approved. That
 * happened three times before this fix, each time while *writing about the check*.
 *
 * This does not loosen anything: the surname patterns are matched separately and are
 * unaffected. It only lets an already-approved phrase be recognised when wrapped. A single
 * bare surname still fails, because a bare surname is not an allowlisted phrase.
 */
function allowedRanges(content, allowlist) {
  const ranges = [];
  for (const allowed of allowlist) {
    // Escape regex metacharacters, then let any run of whitespace stand in for each space.
    const pattern = new RegExp(
      allowed
        .trim()
        .split(/\s+/)
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s+'),
      'g',
    );
    for (const match of content.matchAll(pattern)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

try {
  await access(mappingFile, constants.F_OK);
} catch {
  // A contributor who is not the practice's design partner legitimately cannot hold the
  // mapping. Skipping is correct; failing would make the repo unusable for them.
  console.log(
    'check-no-real-names: private/doctor-codes.md not present — skipping.\n' +
      '  This is expected on a clone without the private material. The check only runs\n' +
      '  where the mapping exists, which is the machine that could actually leak a name.',
  );
  process.exit(0);
}

const mapping = await readFile(mappingFile, 'utf8');
const surnames = extractBlock(mapping, 'SURNAMES');
const allowlist = extractBlock(mapping, 'ALLOW');

if (surnames.length === 0) {
  console.error(
    'check-no-real-names: private/doctor-codes.md has no parseable <!-- SURNAMES:BEGIN --> block.\n' +
      '  Refusing to report success — an empty name list would silently pass everything.',
  );
  process.exitCode = 1;
} else {
  const patterns = surnames.map((surname) => ({
    surname,
    regex: new RegExp('\\b' + escapeRegExp(surname) + '\\b', 'g'),
  }));

  const violations = [];
  for (const file of await collectFiles(root)) {
    const relative = path.relative(root, file);
    if (relative === selfPath) continue;
    if ((await stat(file)).size > MAX_BYTES) continue;

    const content = await readFile(file, 'utf8');
    const allowed = allowedRanges(content, allowlist);

    for (const { surname, regex } of patterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (allowed.some(([from, to]) => start >= from && end <= to)) continue;
        const line = content.slice(0, start).split('\n').length;
        violations.push(`${relative}:${String(line)}  ${surname}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(`Real doctor surnames found outside private/ (${String(violations.length)}):\n`);
    for (const violation of violations) console.error(`  ${violation}`);
    console.error(
      '\nReplace each with its Dnn code from private/doctor-codes.md. If the match is\n' +
        'innocent — a cited author, an ordinary word — add the exact surrounding literal\n' +
        "to that file's <!-- ALLOW:BEGIN --> block instead of loosening this check.",
    );
    process.exitCode = 1;
  } else {
    console.log(
      `check-no-real-names: clean — ${String(surnames.length)} name patterns, ` +
        `${String(allowlist.length)} allowlisted literals, no matches outside private/.`,
    );
  }
}
