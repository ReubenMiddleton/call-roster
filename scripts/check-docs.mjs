/**
 * Documentation-drift check. Wired into `npm run check`.
 *
 * "Documentation is part of the feature, not cleanup after it" is only enforceable if
 * something fails when the docs and the repo disagree. This is that something.
 *
 * Four checks, in increasing order of how much drift they catch:
 *
 *   1. Broken local Markdown links.
 *   2. docs/README.md is the index, so every document under docs/ must be listed in it.
 *      A doc added without an index line is exactly how an index rots into uselessness,
 *      and the index is what saves fifty file reads per session.
 *   3. Every H-nn / S-nn constraint ID referenced anywhere resolves to a definition in
 *      docs/domain/constraints.md. Those IDs appear in the solver model, in test names
 *      and in user-facing violation messages, so a dangling one is a real defect.
 *   4. Every ADR-nnnn reference resolves to a file in docs/architecture/decisions/.
 *
 * [NEEDS CLARIFICATION: ...] markers are counted and reported but never fail the gate.
 * They are a deliberate, greppable "I made this up, confirm it" token — the point is to
 * see them, not to be blocked by them.
 */

import { constants } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const docsDir = path.join(root, 'docs');
const indexFile = path.join(docsDir, 'README.md');
const constraintsFile = path.join(docsDir, 'domain', 'constraints.md');
const adrDir = path.join(docsDir, 'architecture', 'decisions');

const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.tools',
  'coverage',
  'dist',
  'graphify-out',
  'node_modules',
  '.venv',
  'venv',
  'site-packages',
  'out',
  'playwright-report',
  'private',
  'test-results',
]);

async function exists(target) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function collect(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...(await collect(full, predicate)));
    } else if (entry.isFile() && predicate(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const isMarkdown = (name) => name.endsWith('.md') || name.endsWith('.mdx');
const isText = (name) => /\.(md|mdx|ts|tsx|mts|js|jsx|mjs|cjs|py|json|yml|yaml|sql)$/.test(name);

const failures = [];
const notes = [];

// ── 1. Broken local Markdown links ───────────────────────────────────────────────
const markdownFiles = await collect(root, isMarkdown);
for (const file of markdownFiles) {
  const markdown = await readFile(file, 'utf8');
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = (match[1] ?? '')
      .trim()
      .replace(/^<|>$/g, '')
      .split(/\s+['"]/)[0];
    if (!raw || /^(?:https?:|mailto:|tel:|#)/i.test(raw)) continue;
    const decoded = decodeURIComponent(raw.split('#')[0] ?? '');
    if (!decoded) continue;
    if (!(await exists(path.resolve(path.dirname(file), decoded)))) {
      failures.push(`broken link   ${path.relative(root, file)} -> ${raw}`);
    }
  }
}

// ── 2. docs/README.md indexes every document under docs/ ─────────────────────────
if (await exists(indexFile)) {
  const linked = new Set();

  /**
   * Collects every local link in one index file.
   *
   * ⚠️ Nested indexes count, and that is deliberate. `docs/README.md` has a 200-line ceiling
   * (`AGENTS.md` records what it cost when the per-session floor was 1,970 lines) and the ADR list
   * is the one section that grows without bound — seventeen records and one per architectural
   * decision forever. On 7 September 2026 it pushed the index over, and the rule for a breached
   * ceiling is **split or archive, never shave prose**. So a `README.md` that the index links to is
   * itself an index, and a document listed there is indexed.
   *
   * One level only. Two would let a document hide behind a chain nobody reads, which is the thing
   * this check exists to prevent.
   */
  const collectLinks = async (file, follow) => {
    const body = await readFile(file, 'utf8');
    for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const raw = (match[1] ?? '').trim().split('#')[0];
      if (!raw || /^(?:https?:|mailto:|tel:)/i.test(raw)) continue;
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(raw));
      linked.add(resolved);
      if (follow && path.basename(resolved).toLowerCase() === 'readme.md') {
        if (await exists(resolved)) await collectLinks(resolved, false);
      }
    }
  };
  await collectLinks(indexFile, true);
  for (const doc of await collect(docsDir, isMarkdown)) {
    if (path.resolve(doc) === path.resolve(indexFile)) continue;
    if (!linked.has(path.resolve(doc))) {
      failures.push(`not indexed   ${path.relative(root, doc)} is missing from docs/README.md`);
    }
  }
} else {
  notes.push('docs/README.md does not exist yet — index completeness not checked.');
}

// ── 3. Constraint IDs resolve to a definition ────────────────────────────────────
if (await exists(constraintsFile)) {
  const catalogue = await readFile(constraintsFile, 'utf8');
  const defined = new Set();
  // Hard constraints are headings: "### H-04 No back-to-back night shifts".
  for (const match of catalogue.matchAll(/^#{1,6}\s+([HS]-\d{2})\b/gm)) {
    if (match[1]) defined.add(match[1]);
  }
  // Soft constraints are table rows: "| S-01 | Equalise ... |".
  for (const match of catalogue.matchAll(/^\|\s*([HS]-\d{2})\s*\|/gm)) {
    if (match[1]) defined.add(match[1]);
  }

  const referenced = new Map();
  for (const file of await collect(root, isText)) {
    if (path.resolve(file) === path.resolve(constraintsFile)) continue;
    const content = await readFile(file, 'utf8');
    for (const match of content.matchAll(/\b([HS]-\d{2})\b/g)) {
      const id = match[1];
      if (!id) continue;
      if (!referenced.has(id)) referenced.set(id, path.relative(root, file));
    }
  }

  for (const [id, where] of referenced) {
    if (!defined.has(id)) {
      failures.push(
        `undefined ID  ${id} referenced in ${where} but not defined in docs/domain/constraints.md`,
      );
    }
  }
  // ── Cited tests must exist ─────────────────────────────────────────────────────
  //
  // ⚠️ Added 3 September 2026, after H-03 was found to be enforced nowhere at all while its
  // catalogue entry cited `test_H03_membership_interval` — a test that had never been
  // written. Anyone checking whether the rule was covered read the citation and believed
  // it. A dangling test name is worse than no citation: it actively asserts coverage that
  // does not exist.
  const testNames = new Set();
  for (const file of await collect(root, (name) => /\.(test\.ts|test\.tsx|py)$/.test(name))) {
    const content = await readFile(file, 'utf8');
    for (const match of content.matchAll(/^\s*(?:def|async def)\s+(test_\w+)/gm)) {
      if (match[1]) testNames.add(match[1]);
    }
  }
  for (const match of catalogue.matchAll(/::(test_\w+)/g)) {
    const name = match[1];
    if (name && !testNames.has(name)) {
      failures.push(
        `missing test  docs/domain/constraints.md cites ${name}, which does not exist. ` +
          'A citation that names no test asserts coverage there is none of.',
      );
    }
  }

  notes.push(
    `${String(defined.size)} constraint IDs defined, ${String(referenced.size)} referenced elsewhere, ` +
      `${String(testNames.size)} Python test(s) available to cite.`,
  );
} else {
  notes.push('docs/domain/constraints.md does not exist yet — constraint IDs not checked.');
}

// ── 4. ADR references resolve to a file ──────────────────────────────────────────
if (await exists(adrDir)) {
  const adrNumbers = new Set(
    (await readdir(adrDir))
      .map((name) => /^(\d{4})-/.exec(name)?.[1])
      .filter((value) => value !== undefined),
  );
  for (const file of await collect(root, isText)) {
    const content = await readFile(file, 'utf8');
    for (const match of content.matchAll(/\bADR-(\d{4})\b/g)) {
      if (match[1] && !adrNumbers.has(match[1])) {
        failures.push(
          `missing ADR   ADR-${match[1]} referenced in ${path.relative(root, file)} has no file in docs/architecture/decisions/`,
        );
      }
    }
  }
}

// ── Non-failing: clarification markers ───────────────────────────────────────────
let clarifications = 0;
for (const file of markdownFiles) {
  const content = await readFile(file, 'utf8');
  clarifications += [...content.matchAll(/\[NEEDS CLARIFICATION:/g)].length;
}

for (const note of notes) console.log(`check-docs: ${note}`);
if (clarifications > 0) {
  console.log(
    `check-docs: ${String(clarifications)} [NEEDS CLARIFICATION] marker(s) outstanding — ` +
      'informational, see docs/NEEDS_YOUR_INPUT.md.',
  );
}

if (failures.length > 0) {
  console.error(`\nDocumentation drift (${String(failures.length)}):\n`);
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log('check-docs: no documentation drift detected.');
}
