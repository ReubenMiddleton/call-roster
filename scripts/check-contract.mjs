/**
 * Three-way consistency check across the TypeScript ↔ Python boundary.
 *
 * `docs/architecture/solver-contract.md` opens by calling that boundary the highest-risk interface
 * in the system, because "either side can drift from the other without a compile error anywhere."
 * On 1 September 2026, writing the Python request parser found five live mismatches between the
 * document and the code. This script is what stops the sixth.
 *
 * It compares three artifacts that should agree and have no other reason to:
 *
 *   1. `docs/architecture/solver-contract.md` — the human-readable spec, and its JSONC examples.
 *   2. `solver/src/call_roster_solver/contract.py` — the `_*_FIELDS` sets the parser will accept.
 *   3. `fixtures/solver-request.json` — the payload both test suites read.
 *
 * Nothing here is a hand-maintained duplicate of anything else; every field set is extracted from
 * the file that owns it. Generating types from one schema is still the right end state — see
 * `docs/DECISIONS.md` — and this is the cheap version of the same guarantee in the meantime.
 *
 * Follows the idiom of `check-docs.mjs`: `node:fs/promises`, `process.exitCode = 1`, and a message
 * that names the fix rather than the failure.
 */

import { readFile } from 'node:fs/promises';

const CONTRACT_DOC = 'docs/architecture/solver-contract.md';
const PARSER = 'solver/src/call_roster_solver/contract.py';
const FIXTURE = 'fixtures/solver-request.json';
const BUILDER = 'lib/contract/request.ts';

const problems = [];
const notes = [];

const fail = (message) => problems.push(message);

/**
 * Strips `//` line comments from JSONC without touching a `//` inside a string.
 *
 * Naive `replace(/\/\/.*$/gm, '')` would eat the second half of `"https://example.com"`. No such
 * value is in the contract today, which is exactly why a naive version would survive review and
 * then break silently later.
 */
function stripJsonComments(source) {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      output += '\n';
      continue;
    }

    output += char;
  }
  return output;
}

/** Removes trailing commas left behind by a commented-out final entry. */
function stripTrailingCommas(source) {
  return source.replace(/,(\s*[}\]])/g, '$1');
}

/** Every ```jsonc fenced block in a markdown document. */
function jsoncBlocks(markdown) {
  const blocks = [];
  const pattern = /```jsonc\n([\s\S]*?)```/g;
  let match = pattern.exec(markdown);
  while (match !== null) {
    blocks.push(match[1]);
    match = pattern.exec(markdown);
  }
  return blocks;
}

/** Field names appearing at any depth, keyed by nothing — a flat set. */
function allKeys(node, into = new Set()) {
  if (Array.isArray(node)) {
    for (const child of node) {
      allKeys(child, into);
    }
    return into;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      into.add(key);
      allKeys(child, into);
    }
  }
  return into;
}

/**
 * Extracts `_NAME_FIELDS = {"a", "b"}` sets from the Python parser, including multi-line ones.
 *
 * A regex over source is a compromise. It is the right one here: the alternative is running Python
 * to introspect the module, which puts the solver's whole toolchain on the critical path of a
 * documentation check.
 */
function pythonFieldSets(source) {
  const sets = new Map();
  const pattern = /^(_[A-Z0-9_]*FIELDS)\s*=\s*\{([\s\S]*?)\}/gm;
  let match = pattern.exec(source);
  while (match !== null) {
    const names = [...match[2].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
    sets.set(match[1], new Set(names));
    match = pattern.exec(source);
  }
  return sets;
}

/**
 * Sections the parser validates as present and well-shaped but does not decompose into named fields.
 *
 * `burdenWeights` is a map of burden *class* to weight, so its keys are domain data rather than
 * contract fields — and two of them (`weekday_day`, `weekday_night`) contain the word "weekday"
 * without being weekdays. Skipped by both checks below.
 */
const UNDECOMPOSED = new Set(['burdenWeights']);

// ── Load everything ───────────────────────────────────────────────────────────────────

const [doc, parserSource, fixtureRaw] = await Promise.all([
  readFile(CONTRACT_DOC, 'utf8'),
  readFile(PARSER, 'utf8'),
  readFile(FIXTURE, 'utf8'),
]);

let fixture;
try {
  fixture = JSON.parse(fixtureRaw);
} catch (error) {
  fail(`${FIXTURE} is not valid JSON: ${error.message}`);
}

const fieldSets = pythonFieldSets(parserSource);
if (fieldSets.size === 0) {
  fail(
    `${PARSER}: found no _*_FIELDS sets. Either the parser was restructured or this check's ` +
      'regex needs updating — do not ignore this, it means the check is passing vacuously.',
  );
}

const blocks = jsoncBlocks(doc);
if (blocks.length < 2) {
  fail(
    `${CONTRACT_DOC}: expected at least a request and a response example in \`\`\`jsonc blocks, ` +
      `found ${String(blocks.length)}.`,
  );
}

const examples = [];
for (const [index, block] of blocks.entries()) {
  const cleaned = stripTrailingCommas(stripJsonComments(block));
  try {
    examples.push(JSON.parse(cleaned));
  } catch (error) {
    fail(
      `${CONTRACT_DOC}: jsonc example ${String(index + 1)} does not parse — ${error.message}. ` +
        'An example that cannot be parsed cannot be checked, and is the first thing to rot.',
    );
  }
}

// The request example is the one with a "doctors" array. Identified by content rather than
// position, so reordering the document does not break the check.
const requestExample = examples.find((example) => Array.isArray(example?.doctors));
const responseExample = examples.find((example) => Array.isArray(example?.assignments));

if (requestExample === undefined) {
  fail(
    `${CONTRACT_DOC}: no jsonc example contains a "doctors" array, so the request example is missing.`,
  );
}
if (responseExample === undefined) {
  fail(
    `${CONTRACT_DOC}: no jsonc example contains an "assignments" array, so the response example is missing.`,
  );
}

// ── 1. The fixture and the document must agree on the top-level field set ─────────────

if (fixture !== undefined && requestExample !== undefined) {
  const docFields = new Set(Object.keys(requestExample));
  const fixtureFields = new Set(Object.keys(fixture));

  const missingFromFixture = [...docFields].filter((field) => !fixtureFields.has(field));
  const missingFromDoc = [...fixtureFields].filter((field) => !docFields.has(field));

  if (missingFromFixture.length > 0) {
    fail(
      `${FIXTURE} is missing top-level field(s) the document documents: ${missingFromFixture.join(', ')}. ` +
        'A field nothing exercises is a field nobody has proved works.',
    );
  }
  if (missingFromDoc.length > 0) {
    fail(
      `${CONTRACT_DOC} does not document top-level field(s) the fixture sends: ${missingFromDoc.join(', ')}.`,
    );
  }
}

// ── 2. Every field the fixture or document uses must be one the parser accepts ────────

const allowedAnywhere = new Set();
for (const names of fieldSets.values()) {
  for (const name of names) {
    allowedAnywhere.add(name);
  }
}
// The request-level set is named separately in the parser.
const requestFields = fieldSets.get('_REQUEST_FIELDS');
if (requestFields === undefined) {
  fail(`${PARSER}: no _REQUEST_FIELDS set found.`);
}

if (requestFields !== undefined && fixture !== undefined) {
  const unaccepted = Object.keys(fixture).filter((field) => !requestFields.has(field));
  if (unaccepted.length > 0) {
    fail(
      `${FIXTURE} sends top-level field(s) ${PARSER} would reject: ${unaccepted.join(', ')}. ` +
        'The parser rejects unknown fields, so this fixture would fail to parse.',
    );
  }
}

if (requestFields !== undefined && requestExample !== undefined) {
  const undocumented = [...requestFields].filter((field) => !(field in requestExample));
  if (undocumented.length > 0) {
    fail(
      `${PARSER} accepts top-level field(s) ${CONTRACT_DOC} never shows: ${undocumented.join(', ')}. ` +
        'A field the parser accepts and the spec omits is a field only the code knows about.',
    );
  }
}

// ⚠️ The version string was never compared to anything.
//
// `CONTRACT_VERSION` in the builder is the number that actually ships. The fixture and the spec
// carry their own copies, and both sat at 1.5.0 through the 1.6.0 and 1.7.0 bumps — so the
// document described a payload two versions behind the one being sent, and said so in a field
// whose entire purpose is to let the receiver tell. Cheap to check, and nothing else does.
const builderSource = await readFile(BUILDER, 'utf8');
const declared = /CONTRACT_VERSION\s*=\s*'([^']+)'/.exec(builderSource)?.[1];
if (declared === undefined) {
  fail(`${BUILDER}: no CONTRACT_VERSION found. Either it moved or this check needs updating.`);
} else {
  for (const [label, value] of [
    [FIXTURE, fixture?.contractVersion],
    [CONTRACT_DOC, requestExample?.contractVersion],
  ]) {
    if (value !== undefined && value !== declared) {
      fail(
        `${label} says contractVersion "${value}" but ${BUILDER} emits "${declared}". ` +
          'A bump has to reach all three, or the receiver is told the wrong thing about the ' +
          'payload it just got.',
      );
    }
  }
}

// ⚠️ THE OTHER DIRECTION, AND THE ONE THAT WAS MISSING.
//
// Everything above checks that the fixture and document do not exceed the parser. Nothing checked
// that the PARSER does not exceed THEM below the top level — and on 6 September 2026 that turned
// out to be a live hole: H-11 added `cannotWork` and `maxShiftsPerWeekend` to `_DOCTOR_FIELDS` in
// contract 1.6.0, and neither the fixture nor the spec ever heard about them. The top-level check
// could not see it because both fields are nested inside `doctors[]`.
//
// A field the parser accepts and nothing documents is the same failure as one it silently drops,
// arrived at from the other side: the sender cannot know it exists.
const NESTED_SETS_EXEMPT = new Set([
  '_REQUEST_FIELDS', // checked above, against the top level of the example
  '_HORIZON_FIELDS', // the example writes `horizon` inline rather than as its own block
]);

if (fixture !== undefined && requestExample !== undefined) {
  const inFixture = allKeys(fixture);
  const inDoc = allKeys(requestExample);
  for (const [name, fields] of fieldSets) {
    if (NESTED_SETS_EXEMPT.has(name)) {
      continue;
    }
    const missing = [...fields].filter((field) => !inFixture.has(field) || !inDoc.has(field));
    if (missing.length > 0) {
      fail(
        `${PARSER} ${name} accepts ${missing.join(', ')}, which ${FIXTURE} and/or ` +
          `${CONTRACT_DOC} never show. A field only the parser knows about cannot be sent by ` +
          'anyone — add it to the fixture and the spec, or remove it from the parser.',
      );
    }
  }
}

// Nested fields: every key anywhere in the fixture should appear in some parser set, or be a
// leaf-object key inside a section the parser does not decompose (burdenWeights, for instance,
// is a free-form map of burden classes).
if (fixture !== undefined) {
  const skip = new Set();
  for (const section of UNDECOMPOSED) {
    if (fixture[section] !== undefined) {
      for (const key of allKeys(fixture[section])) {
        skip.add(key);
      }
    }
  }

  const unknownNested = [...allKeys(fixture)].filter(
    (field) => !allowedAnywhere.has(field) && !skip.has(field),
  );
  if (unknownNested.length > 0) {
    notes.push(
      `${FIXTURE} uses field(s) not named in any ${PARSER} set: ${unknownNested.join(', ')}. ` +
        'Expected for sections the parser validates but does not yet decompose ' +
        '(burdenLedger, lockedAssignments).',
    );
  }
}

// ── 3. Weekdays must never be integers, in either the fixture or the document ─────────

const WEEKDAY_NAMES = new Set([
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]);

/**
 * Walks a tree collecting every value under a key whose name mentions a weekday.
 *
 * `UNDECOMPOSED` subtrees are skipped, and `burdenWeights` is why: its keys are burden *classes* —
 * `weekday_day`, `weekday_night` — not weekday references. The first run of this check flagged both
 * as integer weekdays. Kept as a substring match rather than an exact allowlist of `weekday` and
 * `exceptWeekdays` on purpose: a future `preferredWeekdays` should be caught without anyone
 * remembering to add it here, and a false positive on a burden class is cheap to exclude by name.
 */
function weekdayValues(node, key, into) {
  if (Array.isArray(node)) {
    for (const child of node) {
      weekdayValues(child, key, into);
    }
    return into;
  }
  if (node !== null && typeof node === 'object') {
    for (const [childKey, child] of Object.entries(node)) {
      if (UNDECOMPOSED.has(childKey)) {
        continue;
      }
      weekdayValues(child, childKey, into);
    }
    return into;
  }
  if (/weekday/i.test(key ?? '')) {
    into.push({ key, value: node });
  }
  return into;
}

for (const [label, tree] of [
  [FIXTURE, fixture],
  [CONTRACT_DOC, requestExample],
]) {
  if (tree === undefined) {
    continue;
  }
  const found = weekdayValues(tree, '', []);
  for (const { key, value } of found) {
    if (typeof value !== 'string') {
      fail(
        `${label}: ${key} carries a ${typeof value} (${String(value)}). ` +
          'Weekdays cross this boundary as NAMES. MONDAY is 0 in Python and 1 in TypeScript, so an ' +
          'integer silently means the wrong day. See lib/contract/weekday.ts.',
      );
    } else if (!WEEKDAY_NAMES.has(value)) {
      fail(`${label}: ${key} = "${value}" is not a weekday name.`);
    }
  }
  if (found.length === 0) {
    fail(
      `${label}: no weekday values found at all. The check may be walking the wrong shape — ` +
        'a vacuously passing check is worse than none.',
    );
  }
}

// ── 4. The version in the fixture must match the version in the document ─────────────

if (fixture !== undefined && requestExample !== undefined) {
  if (fixture.contractVersion !== requestExample.contractVersion) {
    fail(
      `contractVersion disagrees: ${FIXTURE} says "${String(fixture.contractVersion)}", ` +
        `${CONTRACT_DOC} says "${String(requestExample.contractVersion)}".`,
    );
  }
}
if (requestExample !== undefined && responseExample !== undefined) {
  if (requestExample.contractVersion !== responseExample.contractVersion) {
    fail(
      `${CONTRACT_DOC}: the request example says contractVersion ` +
        `"${String(requestExample.contractVersion)}" and the response example says ` +
        `"${String(responseExample.contractVersion)}". They are one contract.`,
    );
  }
}

// Also check the Python parser's supported major against it.
const supportedMajor = /^SUPPORTED_MAJOR\s*=\s*(\d+)/m.exec(parserSource)?.[1];
if (supportedMajor === undefined) {
  fail(`${PARSER}: could not find SUPPORTED_MAJOR.`);
} else if (fixture !== undefined) {
  const fixtureMajor = String(fixture.contractVersion ?? '').split('.')[0];
  if (fixtureMajor !== supportedMajor) {
    fail(
      `${PARSER} supports contract major ${supportedMajor}.x but ${FIXTURE} is ` +
        `"${String(fixture.contractVersion)}". The parser would refuse its own fixture.`,
    );
  }
}

// ── Report ────────────────────────────────────────────────────────────────────────────

for (const note of notes) {
  console.log(`check-contract: note — ${note}`);
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`check-contract: ${problem}`);
  }
  console.error(
    `check-contract: ${String(problems.length)} problem(s). Not a style issue — the two`,
  );
  console.error(
    '               sides of the solver boundary disagree, and nothing else will catch it.',
  );
  process.exitCode = 1;
} else {
  console.log(
    `check-contract: ${String(examples.length)} example(s) parsed, ` +
      `${String(fieldSets.size)} parser field set(s) read, fixture agrees with both.`,
  );
  console.log('check-contract: no contract drift detected.');
}
