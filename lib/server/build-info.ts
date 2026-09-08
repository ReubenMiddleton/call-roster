/**
 * `appVersion`/`schemaVersion` for the L1 command journal and the L5 diagnostic bundle
 * (`docs/ops/diagnostics.md`): "Which build produced this. Without it, a replay reproduces
 * today's code against last week's fault." The two can drift independently -- a hotfix with no
 * migration, or vice versa -- so they are read from two different sources rather than one.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

// `process.cwd()`, not `import.meta.dirname` -- the latter came back `undefined` during Next's
// Turbopack config-collection build step (verified: `npm run build` failed on exactly this line
// before the switch), presumably because that phase evaluates the module outside a normal ESM
// module graph. `process.cwd()` is what `scripts/check-diagnostics-safety.ts` already uses for
// the same reason, and Next.js always runs with the repo root as the working directory.
const REPO_ROOT = process.cwd();

let cachedAppVersion: string | null | undefined;
let cachedSchemaVersion: string | null | undefined;

/**
 * `package.json`'s own `version`. Cached: it cannot change within one running process.
 * ⚠️ Degrades to `null` rather than throwing -- matching "diagnostics must never cost him work" --
 * since this is read from module-level code that can run during build-time page-data collection,
 * not only inside a request.
 */
export function getAppVersion(): string | null {
  if (cachedAppVersion === undefined) {
    try {
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
        version: string;
      };
      cachedAppVersion = pkg.version;
    } catch {
      cachedAppVersion = null;
    }
  }
  return cachedAppVersion;
}

/**
 * The latest migration filename (without its `.sql` extension), lexicographically -- migration
 * filenames are zero-padded numeric prefixes, so string order matches application order.
 * ⚠️ Reads `supabase/migrations/` from disk, which is fine for every environment this app runs in
 * today (local dev, and every test gate) but is not guaranteed to survive a production bundler's
 * file tracing untested -- so this degrades to `null` rather than throwing, matching "diagnostics
 * must never cost him work." Revisit if a real deployment shows it missing.
 */
export function getSchemaVersion(): string | null {
  if (cachedSchemaVersion === undefined) {
    try {
      const files = readdirSync(join(REPO_ROOT, 'supabase', 'migrations'))
        .filter((name) => name.endsWith('.sql'))
        .sort();
      const latest = files.at(-1);
      cachedSchemaVersion = latest === undefined ? null : latest.replace(/\.sql$/, '');
    } catch {
      cachedSchemaVersion = null;
    }
  }
  return cachedSchemaVersion;
}
