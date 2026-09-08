# ADR 0017: No validity interval on constraints — detect staleness and ask, never infer a date

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** project owner, 7 September 2026

> In the context of **three of four measurable constraints changing behaviour when the workforce
> changed**, facing **the question of whether constraints should carry `validFrom`/`validUntil` like
> people, memberships and weights already do**, we decided for **giving constraints no validity
> interval at all, and instead treating era-dependence as a staleness signal that raises a question
> for the practice principal**, to achieve **a catalogue that stays true without anyone inventing a
> date nobody stated**, accepting **that a genuinely dated rule cannot be expressed until someone
> states one, at which point the field is added with their date rather than a derived one.**

## Context

`npm run seed:eras` recomputes every evaluable constraint once per era of stable workforce
composition. Measured over 33 months:

| | occasion | over 33 months | across eras |
|---|---|---|---|
| **H-02** | a doctor-day worked | 1% | ⚠️ **became true** — 5% before Aug 2024, none of the 2,190 since |
| **H-05** | a Saturday | 8% | ⚠️ era-dependent, spread **33 points** |
| **H-06** | a Friday evening or night slot | 4% | stable, spread 13 points — the negative control |
| **H-07** | a Pattern B day | 20% | ⚠️ era-dependent, spread **75 points** (53% → 9%) |

The mechanism is visible and always the same: **a constraint changed when a person did.** H-02's
doubles stopped the month D04 took Tuesday night. H-07 collapsed the same month, from the same cause.
These are not rules the practice bent; they are rules that became true, or stopped being true, when
the roster gained a doctor.

Three constraints on the real decision:

- **The workforce changes roughly every three months.** "Re-verify when composition changes" is not a
  rule anyone will follow by hand, and the longest genuinely stable span in 33 months is eight months.
- **Nobody has ever stated a date.** Every interval on offer would be *derived from the sheets*, and
  the standing rule in `AGENTS.md` is that a confidence tag is never promoted without a human source.
  A machine-written `validFrom` is precisely that promotion, wearing a timestamp.
- **The practice principal is not technical and does not think in eras.** He will never fill this
  field in, so in practice "supported" would mean "populated by inference".

## Decision

**Constraints carry no validity interval. A constraint is a statement about how the practice works
now, sourced from a human.**

Era-dependence is handled as a **staleness signal**, not as data on the constraint:

1. **`seed:eras` is the detector**, and it already exists. A constraint whose current-era breach rate
   diverges from its catalogued confidence is stale.
2. **A stale constraint raises a question in [`../../NEEDS_YOUR_INPUT.md`](../../NEEDS_YOUR_INPUT.md)**
   with the measurement attached. It is never silently reweighted, retagged or dated.
3. **The trigger is a workforce composition change**, which `scripts/check-workforce-changes.ts`
   already detects — the same event that caused every case measured.

**What is deliberately not built:** the `validFrom` field itself. Adding a field that nothing
populates is the exact pattern that has cost this project the most — `tentative` crossed the wire and
did nothing for weeks, H-03's dates were parsed and discarded, `timeBudgetSeconds` was accepted and
never read. **If the principal ever states a dated rule** — *"from January, D07 stops doing nights"* —
the field is added then, carrying **his** date.

## Considered alternatives

| Option | Why rejected |
|---|---|
| **`validFrom`/`validUntil` on every constraint**, populated by inference from `seed:eras` | The dates would be *derived*, and a derived date is a promoted confidence tag with a timestamp on it. It also decides, silently and permanently, that a rule "ended" on a month boundary — when what actually happened is that a doctor arrived and the rule stopped being tested. **Worse than the problem**: it converts an open question into a recorded fact |
| **Same, but populated by hand** | Nobody will populate it. The principal is not technical, does not think in eras, and the workforce changes every ~3 months. A field only maintained in theory is a field that lies |
| **Drop the era-dependent constraints** | H-02 and H-05 are `[CONFIRMED]` by the principal and H-02 was falsified in the *right order* — he was right and the data was incomplete. Dropping a confirmed rule because a script found a boundary would repeat exactly the mistake that episode warns against |
| **Soften them further** | ⚠️ **This is already the status quo and it is worth saying so.** All three are elastic with named slack; correctness is not at risk. What is at risk is the **credibility of the warnings** — an era-dependent constraint quietly generates violations that are all "expected", and an admin who learns to ignore warnings has lost *warn and scar*, which is the whole product philosophy. Softening does not fix that; asking does |
| **Re-verify the whole catalogue on every solve** | 33 months × 20 constraints per solve, to answer a question that changes about three times a year. The composition-change trigger gets the same answer for none of the cost |
| **Nothing — leave it as measured and unresolved** | The measurement exists precisely so it can drive something. Leaving it inert is how `seed:eras` becomes another script nobody runs |

## Consequences

**Good:**

- **No date is ever invented.** The catalogue's confidence tags keep meaning what they say.
- The detector is already built and already correct, including a negative control (H-06) proving it
  does not flag everything.
- Staleness surfaces as a *question with a measurement attached*, which is the format the principal
  has answered eighteen of already.
- Avoids adding an unpopulated field, which is this project's most expensive recurring mistake.

**Bad, or accepted as a cost:**

- **A genuinely dated rule cannot be expressed today.** Accepted: none has been stated in 33 months,
  and the cost of adding the field later is one contract minor version.
- **The loop needs a human.** If the principal does not answer, a stale constraint stays stale — but
  it stays *elastic and flagged*, which is strictly better than stale and silently re-dated.
- **`seed:eras` has to actually be run.** It is not in `npm run check` because it needs the private
  seed data. ⚠️ Its output is therefore only as current as the last person who ran it, and this ADR
  is the reason to run it after any workforce change.
- H-07 is already behind a feature flag, default off, which is the coarse-grained version of the same
  idea. **The flag mechanism does most of this job for `[INFERRED]` constraints already**; this
  decision mainly settles what happens to `[CONFIRMED]` ones, which cannot be flagged off.

**Revisit when:** the principal states a rule with a date attached, or when a stale `[CONFIRMED]`
constraint goes unanswered long enough to produce a roster he rejects. Either would be evidence the
question-based loop is too slow, and the second is the one to watch for.
