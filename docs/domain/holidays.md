# Public holidays

South African public holidays are used, **unmodified**. The practice does not close or reduce hours
at any point in the year — coverage stays continuous, every day, including Christmas.
`[CONFIRMED]`

Public holidays are, on the research evidence, the **number-one source of interpersonal friction**
in a small 24/7 practice. Who has done how many Christmases and 16 Decembers is the most valuable
single thing the system can track. That makes this document a dependency of
[`fairness.md`](fairness.md), not a calendar utility.

---

## What the data shows

Ten dates across the sixteen months of rosters are highlighted in red, and **every one is a South
African public holiday** — including two cases where the holiday fell on a Sunday and moved to the
Monday:

Good Friday (18 Apr 2025, 3 Apr 2026) · Family Day (21 Apr 2025, 6 Apr 2026) · Freedom Day
(28 Apr 2025 observed, 27 Apr 2026) · Heritage Day (24 Sep 2025) · Workers' Day (1 May 2026) ·
Youth Day (16 Jun 2026) · Women's Day (10 Aug 2026 observed).

## Two confirmed behaviours

### 1. A public holiday on a Friday drops Pattern B `[CONFIRMED]`

> **⚠️ Corrected 2 September 2026.** This section previously read *"Good Friday 2025 used Pattern C
> … encoding 'holiday Friday → Pattern A' would be wrong three times out of four."* **That was
> false**, and it rested on a date the project brief mislabelled: 4 April 2025 was an *ordinary*
> Friday that ran Pattern C, and Good Friday 2025 was the 18th, which ran Pattern A. The seed
> transcription caught the mislabelling in August 2026; this document did not follow.

`npm run seed:patterns` measures it across all 33 transcribed months:

- **Eight** holiday Fridays. **All eight ran Pattern A.** Zero ran Pattern C.
- Of **144** Fridays, 132 ran the Pattern B default and 4 ran Pattern C on ordinary Fridays. **A
  Pattern A Friday occurs eight times and every one is a public holiday.**

So the rule is precisely: *"Friday's four-shift split does not apply on a public holiday"* — and
**what replaces it is still a judgement call made on the day.** The system treats a public-holiday
Friday as *"pattern not determined by the weekday default"* and **prompts**.

**Eight for eight is not a rule, and the system does not treat it as one.** `[CONFIRMED]` H-05,
H-06 and H-07 were each written from *"zero counterexamples in sixteen months"* and each was later
falsified by the primary source. So the evidence is used to **pre-select Pattern A in the prompt**,
never to resolve the date — `suggestion` on `PatternResolution`, never `patternId`. A suggestion the
principal confirms with one click is nearly as cheap as a guess and cannot be silently wrong.

⚠️ **The Pattern A Friday is diagnostic**, and that matters for question 40: 15 December 2023 is a
Friday that ran Pattern A and is *not* flagged as a holiday in the transcription. It is also the date
this document records as having been declared a public holiday after the Rugby World Cup. `[INFERRED]`
— structure alone is not a human source, so the flag stays off until he confirms.

This is also why **H-06 must be written against Pattern B's Evening and Night shifts**, not
against "Friday". On a holiday Friday those shifts do not exist.

### 2. Holiday assignment VARIES the weekday anchor pattern `[CONFIRMED — wording corrected]`

**Corrected 26 August 2026.** The original wording said holidays *"abandon"* the anchor pattern.
The primary source falsifies that three times over — see
[`worked-examples.md`](worked-examples.md):

- **25 December 2025** (Christmas, a Thursday): D01 kept the Thursday night slot he holds every
  week. Only the morning and afternoon changed hands.
- **10 August 2026** (Women's Day observed, a Monday): **two of the three** Monday anchor slots
  were retained; only the morning changed.
- **16 December 2025** (Reconciliation, a Tuesday): the morning changed hands but the day still ran
  Pattern A normally.

So holidays draw more freely on the whole roster, but the anchor pattern is **varied, not**
**discarded**. The mechanism is not "ignore the pattern" — it is "the pattern is a preference and
availability wins", which is exactly what S-05 already models.

**Practical consequence:** do not suppress S-05 entirely on a public holiday. Reduce its weight, or
leave it alone and let availability outvote it. Suppressing it would throw away information the
source shows he actually uses.

Practically: on a public holiday S-08 (spread holiday burden against the historical ledger) carries
more weight, but S-05 is not switched off.

---

---

## Implemented

[`lib/calendar/holidays.ts`](../../lib/calendar/holidays.ts) is the executable form of this
document: Schedule 1's ten fixed dates, the Easter computus, the s2(1) Sunday rule, and declared
dates as data. `npm run seed:holidays` reconciles it against every transcribed month.

**That reconciliation is not decoration.** Before it existed the `isPublicHoliday` flag on 1,023
transcribed days was hand-typed and checked by nothing, and `classifyDay` turns that flag into a
burden weight. It found four disagreements on its first run — three of them missed holidays. See
[`../DECISIONS.md`](../DECISIONS.md), 2 September 2026.

Two things came out of writing it that this document did not say.

### The 27 December declarations are predictable after all `[INFERRED]`

Below, ad hoc declarations are filed under *"not predictable"*, and for election days and the 2023
Rugby World Cup that is right. **It is not right for 27 December.** All three years listed there —
2011, 2016 and 2022 — are the years **Christmas Day fell on a Sunday**. s2(1) moves it to the
following Monday, which is already Day of Goodwill, so the automatic rule produces no extra day off
and a proclamation has to.

Over 1995–2080 that is the *only* collision the statutory rules can produce. The next occurrences
are **2033, 2039 and 2044**, and the product can warn an admin in advance rather than being
surprised. `suppressedObservances()` reports them.

The observance is **dropped, not cascaded to the Tuesday** — the Act creates no cascade, and
inventing one would be inventing a day off.

### Two statutory holidays can fall on one date `[CONFIRMED — arithmetic]`

21 March 2008 was both Human Rights Day and Good Friday; it is the only such coincidence between
1995 and 2080. That is **one** holiday carrying both names, not two: one cell in the export, one day
worked. s2(1) substitutes only for a Sunday, so a coincidence grants nothing extra.

---

## Implementation requirements

### The Sunday → Monday rule is statutory. Hard-code it.

Public Holidays Act 36 of 1994, s2(1): a public holiday falling on a Sunday is observed on the
following Monday, automatically. This is law, not policy, and it is not configurable. Two instances
appear in the sixteen months of data, so it is not a theoretical concern.

### Good Friday and Family Day need a Gregorian Easter computus

**Do not hand-maintain a table of Easter dates.** Compute them. Family Day is the Monday after
Good Friday. A hand-maintained table is a silent time bomb that fails in whichever year nobody
remembered to extend it — and the failure mode is a roster built against the wrong dates.

### An admin must be able to add an arbitrary date as a public holiday `[CONFIRMED requirement]`

**Ad hoc presidential declarations happen and are not predictable.** 27 December was declared a
public holiday in 2011, 2016 and 2022; election days in 1999, 2004, 2006 and 2019; and 15 December
2023 after the Rugby World Cup.

A fixed calendar of eleven statutory holidays is therefore wrong on average roughly every other
year. Consequences:

- An admin can declare any date a public holiday, with a name and an effective scope.
- **The fairness ledger must recalculate when they do**, because holiday burden weights differ
  sharply from ordinary weights. A declaration that does not propagate to the ledger silently
  corrupts the thing the product exists to get right.
- The declaration is auditable: who added it, when, and why.

### Per-person holiday substitution `[CONFIRMED requirement]`

s2(2) of the Act allows a public holiday to be **exchanged by agreement** — a doctor swapping
Christmas for another day. Support this per person: the substituted day carries the holiday's
burden weight for that individual, and the original day does not.

Without this, the ledger misrepresents who actually carried Christmas, which is the highest-stakes
number in the system.

---

## Data model notes

A holiday is **an attribute of a date**, alongside the shift pattern — see
[`shift-patterns.md`](shift-patterns.md) and
[`../architecture/data-model.md`](../architecture/data-model.md). It is not a shift type and not a
constraint.

Three distinct things must not be conflated:

| Concept | Meaning |
|---|---|
| **statutory holiday** | Fixed or computed from the Act, including the Sunday→Monday shift |
| **declared holiday** | An ad hoc addition by an admin or by proclamation |
| **substituted holiday** | A per-doctor exchange under s2(2) — affects burden attribution only |

Burden weights for holidays live in [`fairness.md`](fairness.md). Note that not all holidays are
equal in practice: Christmas night and New Year's Eve night are the ones people remember and count.
The weights must reflect that, and they must be agreed with the group visibly rather than chosen by
a developer.

## Open questions

- **Was 15 December 2023 worked as a public holiday?** It was declared one nationally after the
  Rugby World Cup, but the transcribed December 2023 sheet does not flag it, and that sheet is not
  in `private/source-artifacts/` to check against. It is a **Friday**, so unlike the three weekend
  dates corrected alongside it, flagging it would change a real burden weight. `[UNKNOWN]` — logged
  as question 40 in [`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md) and carried as the single
  accepted divergence in `scripts/check-holidays.ts`.
- **How does the principal currently decide who works Christmas, New Year and Easter?** Rotation,
  volunteering, or memory of last year? This is the single most valuable answer for S-08, because it
  tells us what the ledger has to reproduce or improve on. `[UNKNOWN]` — logged in
  [`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md).
- ~~Confirmation that Pattern C on a holiday is chosen for the same availability reason as
  elsewhere, rather than being a holiday-specific pattern.~~ **Closed 2 September 2026 — the premise
  was wrong.** `npm run seed:patterns` finds **fourteen Pattern C days in 33 months and not one of
  them is a public holiday.** Pattern C is a thin-staffing device with nothing holiday-specific about
  it; eight of the fourteen fall in December or January. The question arose from the same mislabelled
  date as the correction at the top of this file. `[CONFIRMED — arithmetic over the full source]`
