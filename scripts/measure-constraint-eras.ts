/**
 * Recomputes every evaluable constraint verdict once per era of stable workforce composition.
 *
 * `docs/domain/constraints.md` sets the rule and then admits nothing enforced it:
 *
 * > **A constraint verdict should state the span it was computed over, and say so when that span
 * > crosses a composition change.**
 *
 * The catalogue's headline numbers are averages over 33 months containing **ten** workforce changes.
 * Three of its constraints turned out to be artefacts of one of them — D04 becoming a full
 * participant in August 2024 — and that was found by hand, twice, after being got wrong once. This
 * makes it a command.
 *
 * **What to read.** `spread` is the gap between the highest and lowest breach rate across eras. Near
 * zero is a habit that survives whoever is on the roster. Large means the rule describes an era, and
 * a single catalogue verdict for it is the average of two different practices.
 *
 * ⚠️ **It decides nothing.** Whether an era-dependent constraint is dropped, softened or given a
 * validity interval is the owner's call — question AA, and `constraints.md` logs it as a design
 * decision. This exists so that call is made against measured spread.
 *
 * Run with:
 *   npm run seed:eras
 *
 * **Prints, never fails the gate.** A constraint that changed with the workforce is a finding, not
 * an error.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  type ConstraintEvaluator,
  type ConstraintHistory,
  constraintHistory,
  ERA_DEPENDENT_SPREAD,
  h02Evaluator,
  h05Evaluator,
  h06Evaluator,
  h07Evaluator,
  isEraDependent,
  resolvePeriod,
} from '../lib/analytics/constraint-history.ts';
import { loadSeedPeriod, type SeedMonthDocument } from '../lib/analytics/seed-period.ts';
import { PILOT_PATTERNS_V1 } from '../lib/analytics/shifts.ts';
import { buildWorkforceTimeline } from '../lib/analytics/workforce.ts';

/**
 * The doctors each standing rule names.
 *
 * Codes, never names — the data boundary. These mirror `scripts/analyse-seed-data.mjs`, which
 * evaluates the same rules over the whole period; the difference here is only the span.
 */
const H05_SATURDAY_EXCLUDED = new Set(['D02']);
const H06_FRIDAY_BACK_HALF_EXCLUDED = new Set(['D01', 'D02', 'D03', 'D04']);
const H07_PATTERN_B_EXCLUDED = new Set(['D01']);

async function findSeedDirectory(
  explicit: string | undefined,
): Promise<{ dir: string; files: string[] } | null> {
  const candidates =
    explicit === undefined ? ['private/seed-data', 'fixtures/seed-data'] : [explicit];
  for (const candidate of candidates) {
    try {
      const entries = await readdir(candidate);
      const files = entries.filter((entry) => entry.endsWith('.json')).sort();
      if (files.length > 0) {
        return { dir: candidate, files };
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function percent(rate: number | null): string {
  return rate === null ? '   —' : `${(rate * 100).toFixed(0).padStart(3)}%`;
}

function describe(history: ConstraintHistory): string {
  const spread =
    history.spread === null
      ? 'no comparison'
      : `spread ${(history.spread * 100).toFixed(0)} points`;
  if (history.becameSatisfied) {
    return `⚠️ ERA-DEPENDENT — it BECAME true: breached before, never since (${spread})`;
  }
  if (isEraDependent(history)) {
    return `⚠️ ERA-DEPENDENT — ${spread}`;
  }
  if (history.spread === null) {
    return 'only one era has evidence — no comparison possible';
  }
  return `stable across eras — ${spread}`;
}

async function main(): Promise<void> {
  const found = await findSeedDirectory(process.argv[2]);
  if (found === null) {
    console.log(
      'measure-constraint-eras: no seed data found — skipping.\n' +
        '  Looked in: private/seed-data, fixtures/seed-data',
    );
    return;
  }

  const documents: SeedMonthDocument[] = [];
  for (const file of found.files) {
    documents.push(
      JSON.parse(await readFile(path.join(found.dir, file), 'utf8')) as SeedMonthDocument,
    );
  }
  const period = loadSeedPeriod(documents, 'seed');
  const timeline = buildWorkforceTimeline(period);

  const resolved = resolvePeriod(period, PILOT_PATTERNS_V1);
  const evaluators: readonly ConstraintEvaluator[] = [
    h02Evaluator(),
    h05Evaluator(H05_SATURDAY_EXCLUDED),
    h06Evaluator(H06_FRIDAY_BACK_HALF_EXCLUDED),
    h07Evaluator(H07_PATTERN_B_EXCLUDED),
  ];

  console.log(
    `measure-constraint-eras: ${String(documents.length)} month(s) from ${found.dir}, ` +
      `${String(timeline.changes.length)} workforce change(s), ` +
      `${String(timeline.spans.length)} era(s) of stable composition`,
  );
  console.log('');

  const histories = evaluators.map((evaluator) =>
    constraintHistory(resolved, evaluator, timeline.spans),
  );

  for (const history of histories) {
    console.log(`  ${history.id} — ${history.description}`);
    console.log(`  one occasion = ${history.occasionIs}`);
    console.log(
      `  verdict over the whole period: ${percent(history.overall.rate)} ` +
        `(${String(history.overall.breaches)} of ${String(history.overall.occasions)})`,
    );
    console.log('');
    console.log('    era                months   n   breach');
    for (const span of history.spans) {
      console.log(
        `    ${span.fromMonth}..${span.toMonth}` +
          String(span.months).padStart(8) +
          String(span.occasions).padStart(5) +
          percent(span.rate).padStart(9),
      );
    }
    console.log('');
    console.log(`    ${describe(history)}`);
    console.log('');
  }

  const flagged = histories.filter((history) => isEraDependent(history));
  console.log('  ─────────────────────────────────────────────────────────────────────');
  if (flagged.length === 0) {
    console.log('  No constraint moved more than');
    console.log(
      `  ${(ERA_DEPENDENT_SPREAD * 100).toFixed(0)} points across eras. Every verdict here is a` +
        ' habit rather than an artefact of who was on the roster.',
    );
  } else {
    console.log(
      `  ⚠️ ${String(flagged.length)} constraint(s) changed with the workforce: ` +
        flagged.map((history) => history.id).join(', '),
    );
    console.log('');
    console.log('  A single catalogue verdict for one of these is the average of two different');
    console.log(
      '  practices. Before encoding one as a stated rule, decide whether it should carry',
    );
    console.log("  a validity interval — question AA, and the owner's call, not this script's.");
  }
  console.log('');
}

await main();
