# Seed-data fixtures

**Synthetic data only.** These files exist so `npm run seed:check` has something to validate in CI
and on a clone that has no `private/` directory.

## Why the real data is not here

The transcribed historical roster is **16 months of day-by-day movements for thirteen identifiable
people**. That is precisely the data the project's data boundary exists to keep out of a public
repository — see [`../../docs/ops/compliance.md`](../../docs/ops/compliance.md).

**Pseudonymous codes are not anonymisation** when the code-to-name mapping exists and the practice is
identifiable. Under POPIA, data is personal if re-identification is reasonably possible, and a
complete movement history plus a small known practice makes it possible.

So: real transcriptions live in `private/seed-data/`, which is gitignored. `npm run seed:check` looks
there first and falls back to this directory.

## What the fixture exercises

`2027-01.json` is an **invented** month with invented assignments. It is shaped like the real files
and deliberately contains the anomaly types found in the real source, so the validator's handling of
them is tested rather than assumed:

- All three shift patterns, including a Pattern C day and a Pattern B Friday.
- A `spillDays` entry for a date in the adjacent month.
- **A public holiday on a Friday** — 1 January 2027 — which drops Pattern B, per
  [`../../docs/domain/holidays.md`](../../docs/domain/holidays.md). It is also what gives
  `npm run seed:holidays` something real to reconcile on a clone with no `private/`.
- A declared `missing-shift` anomaly, so the "accepted anomaly" path is covered.

`invalid/2027-02-broken.json` is **deliberately invalid** and lives in a subdirectory so the default scan skips it, and is used by the unit tests to prove the
validator actually fails: a duplicated doctor within one day (H-02), a shift that does not belong to
its declared pattern, and a missing day.

**Do not "fix" the broken fixture.** It is broken on purpose.
