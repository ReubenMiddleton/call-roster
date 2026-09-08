/**
 * Does the fairness denominator, fitted on this practice's past, still hold next month?
 *
 * The owner's concern, 3 September 2026: *"basing the entire fairness solver purely on what
 * happened in my dad's practice might cause us to overfit at some point."* This is the measurement
 * that answers it, rather than a second opinion about it.
 *
 * ## What is actually at risk of overfitting
 *
 * Not the objective. Leximax over load ratios is a principle from the fair-division literature and
 * nothing about it was fitted to this practice. What *is* fitted is the denominator: ADR-0012's
 * `revealed-opportunity` says a doctor's fair share is proportional to the burden of the slots they
 * have been **observed** working. That is a model of thirteen people trained on 33 months of one
 * practice, and it has a specific hazard the ADR names but never quantified:
 *
 * > **It can only understate.** A doctor willing to work Tuesday nights who was never offered one
 * > looks unavailable for Tuesday nights.
 *
 * The consequence is a feedback loop. Whoever was historically under-offered has a small
 * denominator, so they look *fully* loaded on little work, so the objective sees no reason to offer
 * them more. **The measure ratifies the status quo by construction**, and the more history it is
 * given the harder it entrenches.
 *
 * ## The three numbers this prints
 *
 * A walk-forward: for every month with enough history behind it, fit on everything before and
 * evaluate on the month itself.
 *
 * 1. **Novelty** — what share of the month's shifts land in a `dayClass|shiftKind` cell that doctor
 *    had never been seen in. This is the understatement rate, measured directly. Near zero means
 *    the opportunity sets have converged and fitting them on history is safe. Persistently high
 *    means the denominator is always behind the practice.
 * 2. **In-sample advantage** — the same month scored with cells fitted on itself versus cells fitted
 *    on its past. The gap is the self-referential bias, in load-ratio points. It is the bug that
 *    made a published result wrong on 2 September 2026, measured rather than argued about.
 * 3. **Cross-basis agreement** — Spearman correlation between the load ratios `revealed-opportunity`
 *    produces and those from two bases that are *not* fitted to this practice at all. Where they
 *    agree, the choice of basis is not doing the work and there is little to overfit to. Where they
 *    disagree, the choice of basis **is** the fairness verdict.
 *
 * Run with:
 *   npm run seed:entitlement
 *
 * **Prints, never fails the gate.** This is a measurement, not a check.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { AGREED_BURDEN_V2 } from '../lib/analytics/burden.ts';
import { envyInputs, envyReport } from '../lib/analytics/envy.ts';
import { computeLoadRatios, gini, type LoadRatio, mean } from '../lib/analytics/equity.ts';
import {
  buildLedger,
  cellKey,
  entitlementWeights,
  type Ledger,
  revealedCells,
} from '../lib/analytics/ledger.ts';
import {
  loadSeedPeriod,
  type SeedMonthDocument,
  splitByMonth,
} from '../lib/analytics/seed-period.ts';
import { indexShifts, PILOT_PATTERNS_V1 } from '../lib/analytics/shifts.ts';
import type { DoctorCode, RosterPeriod } from '../lib/analytics/types.ts';

/**
 * Months of history required before a month can be evaluated.
 *
 * Six, matching `MIN_HISTORY_MONTHS` in `departure.ts`. Deliberately the same number: both answer
 * "how much of this practice do we need to have seen before a claim about it means anything", and
 * two different answers to that would be two different definitions of warm-up.
 */
const MIN_TRAIN_MONTHS = 6;

/**
 * Shrinkage strengths swept in the fourth experiment.
 *
 * λ = 0 is `revealed-opportunity` untouched; λ = 1 is `equal`. Everything between is the
 * denominator pulled part of the way toward an even split — the standard correction for an
 * estimator known to be biased in one direction, applied where the bias actually is.
 */
const LAMBDAS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1] as const;

/**
 * Blends entitlement weights toward an equal split.
 *
 * Both sides are normalised to sum to one first, because the two are in different units —
 * opportunity is in burden points, an equal split is a share — and blending them unnormalised
 * would make λ mean whatever the month's total burden happened to be.
 */
function shrinkToEqual(
  weights: ReadonlyMap<DoctorCode, number>,
  roll: readonly DoctorCode[],
  lambda: number,
): ReadonlyMap<DoctorCode, number> {
  const total = roll.reduce((running, doctor) => running + (weights.get(doctor) ?? 0), 0);
  const uniform = roll.length === 0 ? 0 : 1 / roll.length;
  return new Map(
    roll.map((doctor) => {
      const share = total === 0 ? uniform : (weights.get(doctor) ?? 0) / total;
      return [doctor, (1 - lambda) * share + lambda * uniform];
    }),
  );
}

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

/** Joins consecutive month periods back into one. */
function concatPeriods(months: readonly RosterPeriod[], label: string): RosterPeriod {
  return {
    label,
    days: months.flatMap((month) => month.days),
    assignments: months.flatMap((month) => month.assignments),
  };
}

/** Ranks, averaging ties, so Spearman is defined on distributions with repeated values. */
function ranks(values: readonly number[]): readonly number[] {
  const order = values.map((value, index) => ({ value, index }));
  order.sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length).fill(0);
  let cursor = 0;
  while (cursor < order.length) {
    let end = cursor;
    while (end + 1 < order.length) {
      const next = order[end + 1];
      if (next === undefined || next.value !== order[cursor]?.value) {
        break;
      }
      end += 1;
    }
    const averageRank = (cursor + end) / 2 + 1;
    for (let index = cursor; index <= end; index += 1) {
      const entry = order[index];
      if (entry !== undefined) {
        result[entry.index] = averageRank;
      }
    }
    cursor = end + 1;
  }
  return result;
}

/** Spearman rank correlation. Returns NaN for fewer than three points or a constant input. */
function spearman(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length < 3) {
    return Number.NaN;
  }
  const rankedA = ranks(a);
  const rankedB = ranks(b);
  const meanA = mean(rankedA);
  const meanB = mean(rankedB);
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < rankedA.length; index += 1) {
    const left = (rankedA[index] ?? 0) - meanA;
    const right = (rankedB[index] ?? 0) - meanB;
    covariance += left * right;
    varianceA += left * left;
    varianceB += right * right;
  }
  if (varianceA === 0 || varianceB === 0) {
    return Number.NaN;
  }
  return covariance / Math.sqrt(varianceA * varianceB);
}

/** Load ratios keyed by doctor, dropping the incomparable ones (`expected` of zero). */
function ratioMap(ratios: readonly LoadRatio[]): ReadonlyMap<DoctorCode, number> {
  const map = new Map<DoctorCode, number>();
  for (const ratio of ratios) {
    if (ratio.ratio !== null) {
      map.set(ratio.doctor, ratio.ratio);
    }
  }
  return map;
}

/** Doctors whose inferred membership window overlaps the period. */
function rollFor(membership: Ledger, period: RosterPeriod): readonly DoctorCode[] {
  const first = period.days[0]?.date;
  const last = period.days.at(-1)?.date;
  if (first === undefined || last === undefined) {
    return [];
  }
  return membership.entries
    .filter((entry) => entry.firstSeen <= last && entry.lastSeen >= first)
    .map((entry) => entry.doctor);
}

interface MonthResult {
  readonly label: string;
  readonly novelty: number;
  readonly newCells: number;
  readonly inSampleAdvantage: number;
  readonly worstFlipped: boolean;
  readonly giniOutOfSample: number;
  readonly giniInSample: number;
  readonly spearmanEqual: number;
  readonly spearmanActiveDays: number;
  /**
   * Mean absolute load-ratio error of a shrunk, past-fitted denominator against two targets.
   *
   * **Two, because one alone would be marking my own homework.** `settled` is the opportunity set
   * as it stands once the window has happened — mostly the training set, so an unshrunk estimate
   * is close to it almost by construction, and a sweep against it alone is close to rigged.
   * `revealed` is what the window itself showed, which is sparse and noisy — the case where
   * shrinkage classically earns its keep. If the two disagree about λ, that disagreement is the
   * bias–variance trade-off made visible, and it belongs in the report rather than in a choice of
   * which target to print.
   */
  readonly shrinkageError: ReadonlyMap<'settled' | 'revealed', ReadonlyMap<number, number>>;
  /** Envy-freeness up to one shift, over swaps the past-fitted cells say were feasible. */
  readonly isEf1: boolean;
  readonly worstViolation: number;
  readonly comparablePairs: number;
}

function evaluateMonth(
  months: readonly RosterPeriod[],
  index: number,
  holdoutMonths: number,
): MonthResult | null {
  const window = months.slice(index, index + holdoutMonths);
  if (window.length < holdoutMonths) {
    return null;
  }
  const holdout = concatPeriods(window, window[0]?.label ?? '');
  const patterns = PILOT_PATTERNS_V1;
  const schedule = AGREED_BURDEN_V2;
  const shiftIndex = indexShifts(patterns);

  const train = concatPeriods(months.slice(0, index), 'train');
  const trainCells = revealedCells(train, patterns);

  // Membership comes from everything known up to and including the month, so a long-serving
  // doctor is credited a whole month of opportunity rather than only the days they happened to
  // work. Scoping membership to the holdout alone would make "worked once on the 3rd" read as
  // "was only a member on the 3rd".
  const membership = buildLedger(
    concatPeriods(months.slice(0, index + holdoutMonths), 'known'),
    patterns,
    schedule,
  );
  const holdoutLedger = buildLedger(holdout, patterns, schedule);
  const roll = rollFor(membership, holdout);
  if (roll.length < 3) {
    return null;
  }

  // 1. Novelty: shifts landing in a cell this doctor had never been seen in.
  const dayIndex = new Map(holdout.days.map((day) => [day.date, day]));
  const newCellKeys = new Set<string>();
  let novelAssignments = 0;
  for (const assignment of holdout.assignments) {
    const day = dayIndex.get(assignment.date);
    const shift = shiftIndex.get(assignment.shiftId);
    if (day === undefined || shift === undefined) {
      continue;
    }
    const key = cellKey(day.dayClass, shift.kind);
    if (trainCells.get(assignment.doctor)?.has(key) !== true) {
      novelAssignments += 1;
      newCellKeys.add(`${assignment.doctor}|${key}`);
    }
  }
  const novelty =
    holdout.assignments.length === 0 ? 0 : novelAssignments / holdout.assignments.length;

  const carried = new Map<DoctorCode, number>(
    roll.map((doctor) => [
      doctor,
      holdoutLedger.entries.find((entry) => entry.doctor === doctor)?.equalisableBurden ?? 0,
    ]),
  );

  const keepRoll = (weights: ReadonlyMap<DoctorCode, number>): ReadonlyMap<DoctorCode, number> =>
    new Map(roll.map((doctor) => [doctor, weights.get(doctor) ?? 0]));

  // 2. In-sample advantage: the same month, denominator fitted on its past versus on itself.
  const outOfSample = ratioMap(
    computeLoadRatios(
      carried,
      keepRoll(
        entitlementWeights(holdout, patterns, schedule, membership, {
          basis: 'revealed-opportunity',
          cells: trainCells,
        }),
      ),
    ),
  );
  const inSample = ratioMap(
    computeLoadRatios(
      carried,
      keepRoll(
        entitlementWeights(holdout, patterns, schedule, membership, {
          basis: 'revealed-opportunity',
        }),
      ),
    ),
  );

  const shared = roll.filter((doctor) => outOfSample.has(doctor) && inSample.has(doctor));
  if (shared.length < 3) {
    return null;
  }
  const inSampleAdvantage = Math.max(
    ...shared.map((doctor) =>
      Math.abs((outOfSample.get(doctor) ?? 0) - (inSample.get(doctor) ?? 0)),
    ),
  );

  const worstOf = (map: ReadonlyMap<DoctorCode, number>): DoctorCode | undefined =>
    [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // 3. Cross-basis agreement, against two bases not fitted to this practice.
  const equalWeights = new Map<DoctorCode, number>(roll.map((doctor) => [doctor, 1]));
  const first = holdout.days[0]?.date ?? '';
  const last = holdout.days.at(-1)?.date ?? '';
  const activeDayWeights = new Map<DoctorCode, number>(
    roll.map((doctor) => {
      const entry = membership.entries.find((candidate) => candidate.doctor === doctor);
      if (entry === undefined) {
        return [doctor, 0];
      }
      // Membership clipped to the month, so this is days available *in the month* rather than
      // days served overall.
      const from = entry.firstSeen > first ? entry.firstSeen : first;
      const to = entry.lastSeen < last ? entry.lastSeen : last;
      const days = holdout.days.filter((day) => day.date >= from && day.date <= to).length;
      return [doctor, days];
    }),
  );

  const equalRatios = ratioMap(computeLoadRatios(carried, equalWeights));
  const activeDayRatios = ratioMap(computeLoadRatios(carried, activeDayWeights));
  const vector = (map: ReadonlyMap<DoctorCode, number>): readonly number[] =>
    shared.map((doctor) => map.get(doctor) ?? 0);

  // 4. Shrinkage sweep. The target is the *hindsight* denominator — opportunity cells fitted on
  // everything known by the end of the window, which is the best estimate of what each doctor
  // could really have worked. The question is how much a past-only denominator must be pulled
  // toward an even split to land closest to it.
  //
  // ⚠️ Hindsight is still revealed availability, so this measures how well shrinkage predicts
  // what the roster sheets will eventually say — not how well it predicts real availability,
  // which nothing on disk records. That distinction is why λ is a policy and not a fitted
  // constant.
  const hindsightWeights = keepRoll(
    entitlementWeights(holdout, patterns, schedule, membership, {
      basis: 'revealed-opportunity',
      cells: revealedCells(
        concatPeriods(months.slice(0, index + holdoutMonths), 'known'),
        patterns,
      ),
    }),
  );
  const hindsight = ratioMap(computeLoadRatios(carried, hindsightWeights));
  const pastWeights = keepRoll(
    entitlementWeights(holdout, patterns, schedule, membership, {
      basis: 'revealed-opportunity',
      cells: trainCells,
    }),
  );
  const shrinkageError = new Map<'settled' | 'revealed', ReadonlyMap<number, number>>();
  for (const [target, truth] of [
    ['settled', hindsight],
    ['revealed', inSample],
  ] as const) {
    const perLambda = new Map<number, number>();
    for (const lambda of LAMBDAS) {
      const shrunk = ratioMap(computeLoadRatios(carried, shrinkToEqual(pastWeights, roll, lambda)));
      const errors = shared
        .filter((doctor) => truth.has(doctor) && shrunk.has(doctor))
        .map((doctor) => Math.abs((shrunk.get(doctor) ?? 0) - (truth.get(doctor) ?? 0)));
      perLambda.set(lambda, errors.length === 0 ? Number.NaN : mean(errors));
    }
    shrinkageError.set(target, perLambda);
  }

  // 5. Envy over feasible swaps, on cells fitted before the window — a fairness verdict with no
  // denominator in it at all, so it can disagree with the load ratio in a way that means something.
  const envy = envyReport(
    envyInputs(holdout, patterns, schedule, { cells: trainCells }).filter((entry) =>
      roll.includes(entry.doctor),
    ),
  );

  return {
    label: holdout.label,
    novelty,
    newCells: newCellKeys.size,
    inSampleAdvantage,
    worstFlipped: worstOf(outOfSample) !== worstOf(inSample),
    giniOutOfSample: gini(vector(outOfSample)),
    giniInSample: gini(vector(inSample)),
    spearmanEqual: spearman(vector(outOfSample), vector(equalRatios)),
    spearmanActiveDays: spearman(vector(outOfSample), vector(activeDayRatios)),
    shrinkageError,
    isEf1: envy.isEf1,
    worstViolation: envy.worstViolation,
    comparablePairs: envy.comparablePairs,
  };
}

function summarise(values: readonly number[]): string {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) {
    return 'n/a';
  }
  const sorted = [...usable].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return `median ${median.toFixed(2)}  min ${(sorted[0] ?? 0).toFixed(2)}  max ${(sorted.at(-1) ?? 0).toFixed(2)}`;
}

async function main(): Promise<void> {
  const found = await findSeedDirectory(process.argv[2]);
  if (found === null) {
    console.log(
      'measure-entitlement-generalisation: no seed data found — skipping.\n' +
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
  const months = splitByMonth(loadSeedPeriod(documents, 'seed'));

  const walkForward = (holdoutMonths: number): readonly MonthResult[] => {
    const found: MonthResult[] = [];
    for (let index = MIN_TRAIN_MONTHS; index < months.length; index += 1) {
      const result = evaluateMonth(months, index, holdoutMonths);
      if (result !== null) {
        found.push(result);
      }
    }
    return found;
  };

  const results = walkForward(1);

  console.log(
    `measure-entitlement-generalisation: ${String(months.length)} month(s) from ${found.dir}, ` +
      `${String(results.length)} evaluated (the first ${String(MIN_TRAIN_MONTHS)} are warm-up)`,
  );
  if (results.length === 0) {
    console.log('  Not enough history to evaluate anything.');
    return;
  }

  console.log('');
  console.log('  Walk-forward: each month scored using only the months before it.');
  console.log('');
  console.log('  month      novel%  cells   bias   flip    rho=   rho~');
  for (const result of results) {
    console.log(
      `  ${result.label.padEnd(10)}` +
        (result.novelty * 100).toFixed(1).padStart(6) +
        String(result.newCells).padStart(7) +
        result.inSampleAdvantage.toFixed(2).padStart(7) +
        (result.worstFlipped ? 'yes' : '-').padStart(7) +
        result.spearmanEqual.toFixed(2).padStart(8) +
        result.spearmanActiveDays.toFixed(2).padStart(7),
    );
  }

  console.log('');
  console.log("  novel%  share of the month's shifts in a cell that doctor had never worked");
  console.log('  cells   distinct (doctor, cell) pairs seen for the first time');
  console.log('  bias    largest load-ratio gap between fitting the denominator on the month');
  console.log("          itself and fitting it on the month's past — the self-referential error");
  console.log('  flip    did the worst-loaded doctor change between those two fittings');
  console.log('  rho=    Spearman against the `equal` basis');
  console.log('  rho~    Spearman against `active-days`');

  // A single month is a short window to fit a denominator on: one previously unseen cell can
  // nearly double a doctor's opportunity burden, so some of the bias above is the horizon rather
  // than the measure. Three months is what LEDGER_WINDOW_MONTHS actually gives the solver, and
  // twelve is what an unbounded ledger would approach. Both are printed so the two causes can be
  // told apart.
  console.log('');
  console.log('  Across the evaluated windows, by how much roster is scored at once:');
  console.log('');
  for (const holdoutMonths of [1, 3, 12]) {
    const batch = holdoutMonths === 1 ? results : walkForward(holdoutMonths);
    if (batch.length === 0) {
      continue;
    }
    const flips = batch.filter((result) => result.worstFlipped).length;
    console.log(
      `  ${String(holdoutMonths).padStart(2)} month(s), ${String(batch.length).padStart(2)} windows`,
    );
    console.log(`    novelty            ${summarise(batch.map((r) => r.novelty * 100))}  (%)`);
    console.log(`    in-sample bias     ${summarise(batch.map((r) => r.inSampleAdvantage))}`);
    console.log(`    Gini out-of-sample ${summarise(batch.map((r) => r.giniOutOfSample))}`);
    console.log(`    Gini in-sample     ${summarise(batch.map((r) => r.giniInSample))}`);
    console.log(`    rho vs equal       ${summarise(batch.map((r) => r.spearmanEqual))}`);
    console.log(`    rho vs active-days ${summarise(batch.map((r) => r.spearmanActiveDays))}`);
    console.log(`    worst-loaded flipped in ${String(flips)} of ${String(batch.length)} windows`);
    console.log('');
  }

  // The owner asked whether a second fairness scale could be mixed in "to a smaller degree, like
  // 30%". This is that question, asked of the denominator rather than the objective: how far
  // toward an even split does a past-fitted opportunity set need pulling to best match what the
  // practice turns out to do?
  console.log('  Shrinkage sweep — the denominator pulled toward an even split.');
  console.log('');
  const batches = new Map<number, readonly MonthResult[]>([
    [1, results],
    [3, walkForward(3)],
    [12, walkForward(12)],
  ]);
  for (const target of ['settled', 'revealed'] as const) {
    console.log(
      `  vs the ${target} opportunity set` +
        (target === 'settled'
          ? '  (what the window turned out to be — mostly the training set)'
          : '  (what the window itself showed — sparse, noisy)'),
    );
    console.log('');
    console.log('  lambda    1 month   3 months  12 months');
    const bestOf = new Map<number, { lambda: number; error: number }>();
    for (const lambda of LAMBDAS) {
      const cells: string[] = [];
      for (const horizon of [1, 3, 12]) {
        const errors = (batches.get(horizon) ?? [])
          .map((result) => result.shrinkageError.get(target)?.get(lambda) ?? Number.NaN)
          .filter((value) => Number.isFinite(value));
        if (errors.length === 0) {
          cells.push('n/a'.padStart(10));
          continue;
        }
        const sorted = [...errors].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
        cells.push(median.toFixed(3).padStart(10));
        const best = bestOf.get(horizon);
        if (best === undefined || median < best.error) {
          bestOf.set(horizon, { lambda, error: median });
        }
      }
      console.log(`  ${lambda.toFixed(1).padStart(4)}    ${cells.join(' ')}`);
    }
    console.log('');
    for (const horizon of [1, 3, 12]) {
      const best = bestOf.get(horizon);
      if (best !== undefined) {
        console.log(
          `    best at ${String(horizon).padStart(2)} month(s): lambda ${best.lambda.toFixed(1)}` +
            ` (error ${best.error.toFixed(3)})`,
        );
      }
    }
    console.log('');
  }
  console.log('  Median absolute load-ratio error. Lower is better. lambda 0.0 is');
  console.log('  revealed-opportunity untouched; 1.0 is an equal split.');

  // A second fairness scale with no denominator to overfit. Printed with comparablePairs beside
  // it, because "EF1 holds" over nothing comparable is an absence of evidence, not a verdict.
  console.log('');
  console.log('  Envy over feasible swaps — a fairness scale with no denominator.');
  console.log('');
  for (const horizon of [1, 3, 12]) {
    const batch = batches.get(horizon) ?? [];
    if (batch.length === 0) {
      continue;
    }
    const held = batch.filter((result) => result.isEf1).length;
    console.log(
      `  ${String(horizon).padStart(2)} month(s):  EF1 held in ${String(held)} of ` +
        `${String(batch.length)} windows` +
        `   worst violation ${summarise(batch.map((r) => r.worstViolation))}` +
        `   comparable pairs ${summarise(batch.map((r) => r.comparablePairs))}`,
    );
  }
  console.log('');
  console.log("  EF1 = nobody would rather have had a colleague's month, bar a single shift.");
  console.log('  Violations are in burden units, so 3.5 is one Sunday.');
  console.log('');
  console.log('  ⚠️ A violation is NOT movable work. Envy runs envied-could-be-held-by-envious;');
  console.log('     reassigning needs the reverse, and at this practice the two rarely coincide —');
  console.log("     the anchors can hold the pool doctors' months, not the other way round. Read");
  console.log('     it as "the anchors would rather have had the pool doctors\' months, by this');
  console.log('     much", never as "this much could have been handed over".');

  console.log('');
  console.log('  How to read it. High novelty means the opportunity sets are still growing, so a');
  console.log('  denominator fitted on history is systematically too small and the doctors it is');
  console.log('  too small for are the ones already under-offered. A large in-sample bias means');
  console.log(
    '  candidate rosters must never be scored on their own cells. A rho near 1 means the',
  );
  console.log('  practice-fitted basis and the unfitted ones agree, and there is little left to');
  console.log('  overfit to; a low rho means the choice of basis is the fairness verdict.');
  console.log('');
}

await main();
