/**
 * Validates the GitHub Actions workflow files and dependabot config.
 *
 * Why this is in the gate
 * -----------------------
 * These files cannot be exercised locally, and they stay inert until the Claude GitHub
 * App and CLAUDE_CODE_OAUTH_TOKEN are configured (task B3). So a malformed workflow
 * would sit undiscovered for however long that takes, and then fail confusingly at the
 * exact moment someone is trying to set CI up.
 *
 * This caught a real one during authoring: `steps` written without its colon, which YAML
 * parses as a plain scalar rather than a key, producing a job with no steps and no error.
 *
 * It is a structural check, not a full Actions schema validation — that would need
 * actionlint and a Go toolchain. It verifies the file parses, that every job has a
 * runner and steps, and the two project-specific rules below.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { load as parseYaml } from 'js-yaml';

const root = process.cwd();
const workflowDir = path.join(root, '.github', 'workflows');
const dependabotFile = path.join(root, '.github', 'dependabot.yml');

const failures = [];
const notes = [];

async function loadYaml(file) {
  try {
    return parseYaml(await readFile(file, 'utf8'));
  } catch (error) {
    failures.push(`${path.relative(root, file)}: ${error.message.split('\n')[0]}`);
    return null;
  }
}

let workflowFiles = [];
try {
  workflowFiles = (await readdir(workflowDir))
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => path.join(workflowDir, name));
} catch {
  notes.push('no .github/workflows directory — nothing to validate.');
}

for (const file of workflowFiles) {
  const relative = path.relative(root, file);
  const doc = await loadYaml(file);
  if (doc === null) continue;

  if (!doc.on) failures.push(`${relative}: no trigger ('on') defined.`);
  if (!doc.jobs || Object.keys(doc.jobs).length === 0) {
    failures.push(`${relative}: no jobs defined.`);
    continue;
  }

  for (const [name, job] of Object.entries(doc.jobs)) {
    if (typeof job !== 'object' || job === null) {
      failures.push(`${relative}: job '${name}' is not a mapping — check for a missing colon.`);
      continue;
    }
    if (!job['runs-on']) failures.push(`${relative}: job '${name}' has no runs-on.`);
    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      failures.push(
        `${relative}: job '${name}' has no steps array. A key written without its colon ` +
          'parses as a scalar and silently produces exactly this.',
      );
    }
    if (!job['timeout-minutes']) {
      failures.push(
        `${relative}: job '${name}' has no timeout-minutes — a hung job bills forever.`,
      );
    }
  }

  const raw = await readFile(file, 'utf8');

  // Project-specific rule, and the reason it exists is subtle enough to be worth
  // enforcing mechanically. Pushes made with the default GITHUB_TOKEN do not trigger
  // downstream workflows, so a fix PR would arrive with no CI run on it — defeating the
  // purpose of claude-ci-watch, silently. As an `env:` var for read-only gh calls it is
  // fine; as an action *input* it is not.
  if (/^\s*github_token:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/m.test(raw)) {
    failures.push(
      `${relative}: passes GITHUB_TOKEN as a 'github_token' INPUT to an action. ` +
        'Pushes made with the default token do not trigger downstream CI, so the ' +
        'resulting PR would have no CI run. Use it as an env var for read-only gh ' +
        'calls instead and let the action authenticate its own pushes.',
    );
  }

  // The data boundary reaches into CI too: nothing may cause private/ to exist there.
  if (
    /(^|\s)private\//.test(raw) &&
    !/private\/ is gitignored|never present|do not commit/i.test(raw)
  ) {
    notes.push(`${relative}: mentions private/ — confirm it is only in an explanatory comment.`);
  }
}

if (workflowFiles.length > 0) {
  notes.push(`${String(workflowFiles.length)} workflow file(s) validated.`);
}

const dependabot = await loadYaml(dependabotFile).catch(() => null);
if (dependabot) {
  if (dependabot.version !== 2) failures.push('dependabot.yml: version must be 2.');
  for (const entry of dependabot.updates ?? []) {
    // Without groups, a multi-ecosystem project produces a trickle of individual PRs
    // that buries the ones that matter and trains you to ignore them.
    if (!entry.groups) {
      failures.push(
        `dependabot.yml: '${entry['package-ecosystem']}' has no groups — ungrouped ` +
          'updates arrive as separate PRs and the noise buries the important ones.',
      );
    }
  }
  notes.push(`dependabot: ${String((dependabot.updates ?? []).length)} ecosystem(s).`);
}

for (const note of notes) console.log(`check-workflows: ${note}`);

if (failures.length > 0) {
  console.error(`\nWorkflow problems (${String(failures.length)}):\n`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log('check-workflows: no problems found.');
}
