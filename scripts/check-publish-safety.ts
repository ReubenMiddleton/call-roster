/**
 * Answers one question before the repository is ever pushed: **what would actually be published?**
 *
 * The first push is the single most irreversible action in this project. The repository is public,
 * and `private/` holds the project brief, the research reports, the roster images, the diary
 * photograph and the D01–D13 name mapping — thirteen identifiable people's movements over two years.
 * A push cannot be undone: GitHub retains unreferenced objects, forks keep copies, and crawlers are
 * fast.
 *
 * `HANDOFF.md` has said *"check `git status` shows no `private/` content before the first push"*
 * since Track B was written. **That check has never been runnable**, because there is no `.git`
 * directory yet — `git init` is deliberately the owner's call. So this walks the tree and applies
 * the ignore rules directly, and can be run **before** the repository exists.
 *
 * ## What it is not
 *
 * Not a replacement for `names:check` or `gitleaks`, which look *inside* files for real surnames and
 * for secrets. This looks at *which files would be included at all*, which is the failure those two
 * cannot catch: a JPEG of a roster sheet contains no matchable text and no secret pattern, and
 * publishing it would expose exactly what the data boundary exists to protect.
 *
 * Run with:
 *   npm run publish:check
 *
 * **Fails loudly**, and it is in the gate. A rule that is only checked when someone remembers is
 * not a boundary.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Directories never published, mirroring `.gitignore`.
 *
 * Deliberately a **separate list rather than a `.gitignore` parser.** Two independent statements of
 * the same boundary catch an edit to one of them; a parser would agree with `.gitignore` by
 * construction, including when `.gitignore` is wrong. `check-gitignore-agreement` below asserts the
 * two still line up.
 */
const NEVER_PUBLISHED = [
  'private',
  '.tools',
  'node_modules',
  '.next',
  'coverage',
  '.git',
  '.hypothesis',
  '.ruff_cache',
  '.pytest_cache',
];

/** Paths inside otherwise-published directories that are excluded. */
const EXCLUDED_SUBPATHS = [
  'solver/.venv',
  'solver/.hypothesis',
  'test-results',
  'playwright-report',
];

/** Tool caches, ignored wherever they appear -- `.gitignore` writes these unanchored too. */
const TOOL_CACHE_DIRECTORIES = new Set([
  '__pycache__',
  '.pytest_cache',
  '.ruff_cache',
  '.hypothesis',
]);

/** Only these three files under `graphify-out/` are published. See docs/GRAPHIFY.md. */
const GRAPHIFY_ALLOWED = new Set(['graph.json', 'GRAPH_REPORT.md', 'manifest.json']);

/**
 * Extensions that should never appear in a published file.
 *
 * Images are the case that matters and the one the text checks cannot see: every roster sheet in
 * `private/source-artifacts/` is a JPEG, and a stray copy outside `private/` would publish thirteen
 * doctors' names in a form no grep will ever match.
 */
const SUSPICIOUS_EXTENSIONS = new Set([
  '.jpeg',
  '.jpg',
  '.png',
  '.heic',
  '.pdf',
  '.docx',
  '.doc',
  '.xlsx',
  '.bak',
  '.pem',
  '.key',
  '.p12',
  // Added 2026-09-08, when a downloaded Supabase CA landed in the repo root and this script
  // counted it as publishable -- `.pem`, `.key` and `.p12` were already here and `.crt` is the
  // same family. The CA itself is a public root certificate and not a secret, but a `.crt` is
  // exactly the shape of thing that is sometimes a private key with a confusing extension.
  '.crt',
  '.env',
]);

/**
 * Root files never published, mirroring the `.gitignore` rules that exclude them. Same reasoning
 * as `NEVER_PUBLISHED`: a second, independent statement of the boundary rather than a parser.
 *
 * These are Supabase's CA certificate under the names `scripts/db-remote.ts` looks for. They are
 * per-machine setup that every developer downloads for themselves, and a stale committed copy is
 * worse than none.
 */
const NEVER_PUBLISHED_FILES = ['prod-ca-2021.crt', 'supabase-ca.crt', 'supabase-ca-bundle.crt'];

/** Files allowed to carry a suspicious extension, with the reason. */
const ALLOWED_SUSPICIOUS: Readonly<Record<string, string>> = {};

function isIgnored(relative: string): boolean {
  const parts = relative.split('/');
  const [first] = parts;
  if (first !== undefined && NEVER_PUBLISHED.includes(first)) {
    return true;
  }
  if (
    EXCLUDED_SUBPATHS.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`))
  ) {
    return true;
  }
  // Matched at ANY depth, not just the repository root. `.gitignore` writes these as bare
  // `.ruff_cache/` etc., which git matches at every level -- listing them in `NEVER_PUBLISHED`
  // only catches a top-level one. Measured 2026-09-08 at `git init`: this script reported 266
  // publishable files against git's 258, and the whole difference was `solver/.ruff_cache/`.
  // Over-reporting is the safe direction, but the two statements of the boundary are supposed to
  // agree, and a disagreement nobody chases is how the unsafe direction eventually ships.
  if (parts.some((part) => TOOL_CACHE_DIRECTORIES.has(part))) {
    return true;
  }
  if (relative.startsWith('graphify-out/')) {
    // Everything under graphify-out/ is ignored except three named files at its root.
    return parts.length !== 2 || !GRAPHIFY_ALLOWED.has(parts[1] ?? '');
  }
  const name = parts[parts.length - 1] ?? '';
  if (name.startsWith('.env')) {
    return true;
  }
  if (parts.length === 1 && NEVER_PUBLISHED_FILES.includes(name)) {
    return true;
  }
  if (name.endsWith('.tsbuildinfo') || name === 'next-env.d.ts') {
    return true;
  }
  return false;
}

function walk(directory: string, base: string, found: string[]): void {
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    const relative = path.relative(base, absolute).split(path.sep).join('/');
    if (isIgnored(relative)) {
      continue;
    }
    if (statSync(absolute).isDirectory()) {
      walk(absolute, base, found);
    } else {
      found.push(relative);
    }
  }
}

/** The two statements of the boundary must agree. */
function checkGitignoreAgreement(problems: string[]): void {
  const gitignore = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8') : '';
  if (gitignore === '') {
    problems.push('.gitignore is missing entirely. private/ would be published.');
    return;
  }
  const firstRule = gitignore
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('#'));
  if (firstRule !== 'private/') {
    problems.push(
      `the first rule in .gitignore is "${String(firstRule)}", not "private/". It is first on ` +
        'purpose — see the comment above it.',
    );
  }
  for (const directory of NEVER_PUBLISHED) {
    if (directory === '.git') {
      continue;
    }
    if (!gitignore.includes(`${directory}/`)) {
      problems.push(`"${directory}/" is excluded by this script but not by .gitignore.`);
    }
  }
  // The CA files are excluded here by name; `.gitignore` excludes them by extension. Neither is
  // load-bearing alone -- this asserts the pair still agree, the same way the directories do.
  if (!gitignore.includes('*.crt')) {
    problems.push(
      'this script skips the Supabase CA certificates but .gitignore has no "*.crt" rule, so ' +
        'git would commit one.',
    );
  }
}

function main(): void {
  const base = process.cwd();
  const published: string[] = [];
  walk(base, base, published);
  published.sort();

  const problems: string[] = [];
  checkGitignoreAgreement(problems);

  for (const file of published) {
    if (file.startsWith('private/')) {
      problems.push(`${file} — under private/, which is never published.`);
      continue;
    }
    const extension = path.extname(file).toLowerCase();
    if (SUSPICIOUS_EXTENSIONS.has(extension) && ALLOWED_SUSPICIOUS[file] === undefined) {
      problems.push(
        `${file} — a ${extension} file would be published. Images and documents are the case ` +
          'names:check and gitleaks cannot see inside.',
      );
    }
  }

  const bytes = published.reduce((sum, file) => sum + statSync(path.join(base, file)).size, 0);
  console.log(
    `check-publish-safety: ${String(published.length)} file(s) would be published, ` +
      `${(bytes / 1024).toFixed(0)} KB.`,
  );
  const topLevel = [...new Set(published.map((file) => file.split('/')[0] ?? file))].sort();
  console.log(`  top level: ${topLevel.join(', ')}`);

  if (problems.length > 0) {
    console.error('');
    console.error(`check-publish-safety: ${String(problems.length)} problem(s):`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    console.error('');
    console.error('  A push cannot be undone. Fix these before `git init`.');
    process.exitCode = 1;
    return;
  }
  console.log('  nothing under private/, no images or documents, .gitignore agrees.');
  console.log('');
}

main();
