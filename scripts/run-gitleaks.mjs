/**
 * Runs gitleaks from the checkout-local .tools/ directory, or from PATH if it happens
 * to be installed there, forwarding all arguments.
 *
 * The point of this wrapper is the failure case. A pre-commit secret scan that silently
 * does nothing when the binary is absent is worse than having no scan at all, because
 * it is believed. So a missing gitleaks is a hard failure with an actionable message,
 * never a skip.
 *
 * GitHub push protection and secret scanning (free on a public repo) are the backstop,
 * not the substitute — they catch what is pushed, this catches what is committed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const local = path.join(root, '.tools', process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');

function resolveBinary() {
  if (existsSync(local)) return local;
  const probe = spawnSync('gitleaks', ['version'], {
    stdio: 'ignore',
    shell: true,
  });
  if (probe.status === 0) return 'gitleaks';
  return null;
}

const binary = resolveBinary();

if (binary === null) {
  console.error(
    'gitleaks is not available, so the staged-secret scan cannot run.\n' +
      '\n' +
      '  Install the pinned, checksum-verified copy into .tools/ with:\n' +
      '\n' +
      '      npm run setup:gitleaks\n' +
      '\n' +
      '  This hook fails rather than skipping on purpose: a secret scan that quietly\n' +
      '  does nothing is worse than no scan, because everyone assumes it ran.',
  );
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), {
  stdio: 'inherit',
  shell: false,
});
process.exit(result.status ?? 1);
