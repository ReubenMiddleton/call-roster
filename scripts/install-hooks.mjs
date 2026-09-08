/**
 * Installs the lefthook git hooks, but only once a git repository exists.
 *
 * `git init` and the first commit are deliberately the repository owner's call, so this
 * checkout spends its early life without a .git directory. Running `lefthook install`
 * there fails, and because npm treats a failing `prepare` script as a failed install,
 * that would break `npm install` for no good reason.
 *
 * So: skip cleanly with an explanatory message when there is no repository, and install
 * for real when there is. The skip prints the exact command to run afterwards, because a
 * checkout whose hooks were silently never installed is its own quiet hazard.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const gitDir = path.join(process.cwd(), '.git');

if (!existsSync(gitDir)) {
  console.log(
    'install-hooks: no .git directory — skipping lefthook install.\n' +
      '  This is expected before the repository is initialised. Once `git init` has run,\n' +
      '  install the hooks with:  npx lefthook install',
  );
  process.exit(0);
}

const result = spawnSync('npx', ['lefthook', 'install'], {
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) {
  console.error(
    'install-hooks: lefthook install failed. The pre-commit secret scan and the\n' +
      '  real-name check are NOT active. Fix this before committing.',
  );
}

process.exit(result.status ?? 1);
