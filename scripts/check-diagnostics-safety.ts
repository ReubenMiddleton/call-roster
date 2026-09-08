/**
 * L0, "redaction by construction" (`docs/ops/diagnostics.md`): the gate step that keeps the
 * command journal's typed shape honest rather than merely conventional.
 *
 * It fails on two things the design doc names explicitly:
 *
 * 1. **A free-text column in a diagnostics table.** Parses `command_journal`'s definition out of
 *    `supabase/migrations/0009_command_journal.sql` and fails on any `text` column not on the
 *    small, explicit allowlist below -- each entry there is a documented, deliberate exception
 *    (`command_type`: a closed vocabulary just not DB-enforced; `reason`: the one column ECTA
 *    s15(4) requires, see the migration's own comment), not the rule being loosened generally.
 * 2. **A string literal in an identity position at a call site.** Every call to
 *    `writeCommandJournal(...)` is a real risk: if someone writes `doctorName: someValue` (a
 *    person's *display* name, not their id) into `before`/`after`, the audit trail would hold
 *    exactly what the data boundary exists to keep out of a running app's persisted state. This
 *    scans the object literal at each call site for banned key names.
 *
 * (The third thing the design doc names -- a real surname anywhere in diagnostics fixtures -- is
 * already covered: `names:check` scans the whole repository, not diagnostics specifically, so
 * duplicating it here would just be a second, narrower copy of the same check.)
 *
 * Deliberately a plain text scan, not an AST/ESLint rule. A regex over a handful of known call
 * sites is enough for the vocabulary this project actually has (nine command types, one writer
 * function) -- the more general version is worth building if `command_journal` acquires many more
 * writers, not before.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

/** Every `.ts` file under `dir` (relative to `ROOT`), recursively -- no external glob dependency
 * for a scan this narrow in scope. */
function listTsFiles(dir: string): string[] {
  const absoluteDir = path.join(ROOT, dir);
  const entries = readdirSync(absoluteDir);
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.join(dir, entry);
    const absolutePath = path.join(ROOT, relativePath);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...listTsFiles(relativePath));
    } else if (entry.endsWith('.ts')) {
      files.push(relativePath.split(path.sep).join('/'));
    }
  }
  return files;
}

const MIGRATION_PATH = path.join(ROOT, 'supabase', 'migrations', '0009_command_journal.sql');

/** Each entry is a deliberate, documented exception -- see the docblock above and the migration's
 * own column comments. None of these can hold a person's display name:
 * - `command_type` -- a closed vocabulary (`CommandType` in lib/server/command-journal.ts), just
 *   not `check`-constrained in the database because the vocabulary is still growing.
 * - `outcome` -- also closed, and this one *is* `check`-constrained (applied/refused/failed).
 * - `reason` -- ECTA s15(4)'s required reason on an `applied` row (product-supplied
 *   administrative text, never free telemetry), or the system's own deterministic explanation on
 *   a `refused`/`failed` one (`journalRefusal` in command-journal.ts) -- never user-typed either
 *   way.
 * - `app_version`/`schema_version` -- build metadata (a package version, a migration filename),
 *   structural strings with no personal-information risk. */
const ALLOWED_TEXT_COLUMNS = new Set([
  'command_type',
  'outcome',
  'reason',
  'app_version',
  'schema_version',
]);

/** Display-name-shaped keys that must never appear in a diagnostic payload. Not an exhaustive
 * NLP check -- a targeted list of the specific mistake this gate exists to catch. */
const BANNED_IDENTITY_KEYS = ['fullName', 'doctorName', 'patientName', 'personName', 'displayName'];

function checkMigrationColumns(problems: string[]): void {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const tableMatch = /create table command_journal \(([\s\S]*?)\n\);/.exec(sql);
  if (tableMatch?.[1] === undefined) {
    problems.push(`Could not find the command_journal table definition in ${MIGRATION_PATH}.`);
    return;
  }
  const body = tableMatch[1];
  // Strip `--` line comments before matching columns, so an allowlisted word inside a comment
  // (this file's own docblock, quoted above, is a good example) can never hide a real column.
  const withoutComments = body.replace(/--.*$/gm, '');
  const columnPattern = /^\s*(\w+)\s+text\b/gm;
  for (const match of withoutComments.matchAll(columnPattern)) {
    const column = match[1];
    if (column !== undefined && !ALLOWED_TEXT_COLUMNS.has(column)) {
      problems.push(
        `command_journal.${column} is a free-text column not on the allowlist. Either it holds ` +
          'entity references and should be `uuid`/`jsonb`, or it is a genuine exception and ' +
          'belongs in ALLOWED_TEXT_COLUMNS with a comment saying why (see command_type/reason).',
      );
    }
  }
}

function extractCallSitePayload(source: string, callIndex: number): string | undefined {
  const braceStart = source.indexOf('{', callIndex);
  if (braceStart === -1) {
    return undefined;
  }
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') {
      depth += 1;
    } else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart, i + 1);
      }
    }
  }
  return undefined;
}

function checkCallSites(problems: string[]): void {
  const files = [...listTsFiles('app'), ...listTsFiles('lib/server')];
  const keyPattern = new RegExp(`\\b(${BANNED_IDENTITY_KEYS.join('|')})\\s*:`, 'g');

  for (const relativePath of files) {
    const fullPath = path.join(ROOT, relativePath);
    const source = readFileSync(fullPath, 'utf8');
    let searchFrom = 0;
    for (;;) {
      const callIndex = source.indexOf('writeCommandJournal(', searchFrom);
      if (callIndex === -1) {
        break;
      }
      const payload = extractCallSitePayload(source, callIndex);
      searchFrom = callIndex + 'writeCommandJournal('.length;
      if (payload === undefined) {
        continue;
      }
      for (const match of payload.matchAll(keyPattern)) {
        const key = match[1];
        if (key === undefined) {
          continue;
        }
        problems.push(
          `${relativePath}: a writeCommandJournal(...) call includes \`${key}\` -- a ` +
            'display-name-shaped field. Diagnostic payloads hold entity references only ' +
            '(e.g. `doctorId`); a name is joined at render time from `person`, never copied in.',
        );
      }
    }
  }
}

function main(): void {
  const problems: string[] = [];
  checkMigrationColumns(problems);
  checkCallSites(problems);

  if (problems.length > 0) {
    console.error(`check-diagnostics-safety: ${String(problems.length)} problem(s):`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    'check-diagnostics-safety: command_journal has no free-text columns beyond the allowlist, ' +
      'and no call site passes a display-name-shaped field.',
  );
}

main();
