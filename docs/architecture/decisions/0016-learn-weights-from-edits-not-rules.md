# ADR 0016: Learn in-tier weights from the admin's edits; never learn constraints or the tier hierarchy

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** project owner, 7 September 2026

> In the context of **a solver that needed four rounds of hand-tuning to reproduce one practice's
> habits, and the certainty that every other practice will have undeclared arrangements of its own**,
> facing **the question of whether the tuning can be automated by learning from the gap between the
> solver's roster and the admin's published one**, we decided for **inverse optimisation over the
> relative weights *inside* each penalty tier, learned from individual edits rather than whole
> months, warm-started from a cross-practice prior and surfaced as a suggestion the admin confirms**,
> to achieve **a system that adapts to an undeclared arrangement without anyone having to state it**,
> accepting **that the tier hierarchy, the constraint catalogue and anything doctor-specific are
> frozen against learning, that an unlabelled edit is close to worthless, and that none of it can be
> built until the product records edits at all.**

## Context

The owner raised this on 6 September 2026, immediately after S-09:

> *"We have already had to go back and tweak some things to get the solver to give us what we want…
> if we have to tweak it this much then it will most likely also need adjustments for other practices
> even with all the data and accurate rules and arrangements provided (as humans there will always be
> something that isn't declared or entered into the data we use to seed the application)."*

**The premise is correct and it is the strongest argument in the project for this direction.** The
September 2026 roster needed S-09 built from scratch because a 38% share had no representation in the
model. Nobody had withheld anything: the principal answered eighteen questions in full, and *"D01
takes about two of four Saturday mornings, rotating with D03 and D04"* is simply not the kind of fact
a person volunteers. It is not a rule. It is what the rota does.

Every practice will have some of these, and they will be different ones. Discovering each by hand
costs a session; there will not be a session per practice.

**Three facts about this codebase make the learnable version unusually tractable:**

1. **The penalty registry already exists** — `(constraint_name, entity_refs, slack_var, weight)`, in
   the model from the first line, on the rule in `.claude/rules/solver.md`. The objective is a
   weighted sum of slacks, which is **linear in the weights**. Fitting weights to observed choices is
   then a linear feasibility problem, not a search.
2. **Every roster is scored, not just generated.** `registry.violations()` and `cost_by_tier()` will
   score *any* assignment set, including one a human produced. So the solver's roster and the admin's
   published roster can be compared on one fixed scale.
3. **Published rosters are immutable snapshots and editing creates version N+1.** The training data
   is a by-product of a rule adopted for a different reason.

## Decision

**Learn the relative weights within a penalty tier. Learn nothing else.**

Specifically, in this order, and the first three are not machine learning at all:

1. **Record the edits.** The L1 command journal from
   [ADR-0013](0013-first-party-diagnostics.md) — every manual change as a replayable event with
   before and after. **Nothing downstream is possible without this, and it is cheap now and
   impossible to reconstruct later.**
2. **Ship the diff report.** Solver roster versus published roster, scored on one fixed entitlement,
   broken down by constraint: *"you moved 8 cells; 5 of them reduced S-09 cost and 3 raised S-03."*
   ⚠️ **This is most of the value and none of the risk.** At this data scale a human reading which
   constraint keeps losing and changing one number will usually beat a learner.
3. **Ask why.** A one-tap reason on an edit, from a **fixed list mapped to constraint IDs**. Never
   free text — POPIA s26, the same boundary as the preference fields. **Twenty labelled edits are
   worth more than two hundred unlabelled ones**, because an unlabelled edit does not say whether the
   admin was correcting the model or absorbing a phone call.
4. **Ask a question of our own.** ⭐ **Added 7 September 2026 on the owner's suggestion**, and it is
   the single biggest improvement to the timeline in this document. See below.
5. **Then fit.** For each edit, the admin's roster is asserted to be no worse than the solver's under
   the true weights: `cost_w(published) ≤ cost_w(solved)`. Each is one linear constraint on `w`.
   Accumulate them and solve for the smallest adjustment that satisfies as many as possible — a
   structured-perceptron or SVM-struct update, not a neural network.

### ⭐ Amendment, 7 September 2026: lock-and-regenerate is a better source than edits

The owner proposed a workflow that turns out to change this ADR's central difficulty:

> *"Generate a roster, lock the shifts that are correct, and regenerate while keeping the locked
> shifts, locking the new shifts the solver got correct again, and reiterate until the whole roster
> gets built this way."*

**The attribution problem — the reason steps 2 and 3 exist — largely dissolves under this workflow.**
An edit is ambiguous: correcting the model, or absorbing a phone call nobody recorded. **A lock is
not.** It says *this cell is right* with no ambiguity and no prompt, and it is a deliberate act the
admin takes for his own reasons rather than a favour asked of him.

| Signal | What it means | Strength |
|---|---|---|
| **A locked cell** | "This is right." | ⭐ Unambiguous, and free — he was going to lock it anyway |
| **A cell left unlocked across several regenerations** | Rejected, or he has not decided | Weak, but it accumulates |
| **A cell that keeps returning unlocked and is finally accepted** | Tolerable, not preferred | Weak |
| An edit with no reason attached | Anything | Near zero — this is what step 3 exists to fix |

⚠️ **Do not read "unlocked" as "rejected".** Indifference and rejection look identical in one round;
only repetition separates them. The fit should weight a lock heavily and an absence barely at all.

**It also front-loads the data.** Steps 1–3 collect roughly one month of signal per month. A single
lock-and-regenerate session produces a lock per accepted cell and a rejection per discarded roster —
so the first *month* can yield what would otherwise take several. Combined with step 4's questions,
the owner's 3–4 month estimate stops looking optimistic.

✅ **The engine side is already built**: [H-13](../../domain/constraints.md#h-13-a-locked-assignment-is-honoured-exactly-confirmed-by-construction),
7 September. This needs UI and a journal, not solver work.

### Step 4 in full: asking beats waiting

> *"Is there possibly a way to prompt the user with questions, give them a few options to choose
> from and ask them to choose the most correct answer — that might also give the learner some extra
> data to work with."* — the owner, 7 September 2026

**Yes, and it is a stronger idea than "extra data".** This is **active learning**, and it changes
two things that steps 1–3 cannot:

- **We choose what to ask.** Every other signal here is whatever the month happened to produce. A
  question can be aimed at *the weight the fit is currently least sure of*, and one well-chosen
  question is worth many incidental observations. This is the whole reason active learning exists.
- **It has no attribution problem.** An edit is ambiguous — correcting the model, or absorbing a
  phone call we will never see. An answer to *"which of these two is better?"* is not.

**The form matters more than the idea, and getting it wrong wastes the mechanism:**

| Ask this | Not this |
|---|---|
| **A pairwise comparison of two concrete rosters** differing in one dimension: *"Roster A gives D09 three public holidays this year; Roster B gives him one, but D02 works two weekends in a row. Which is closer to right?"* | *"How important is it that holidays are shared?"* |
| Real weeks, real names, real dates | Anything abstract, or a 1–5 rating |

**People are poor at introspecting weights and good at comparing concrete options** — a pairwise
answer *is* the inequality `cost_w(chosen) ≤ cost_w(other)`, in exactly the form step 5 consumes. An
abstract answer has to be translated into a weight by someone guessing, which is the thing this
whole ADR exists to stop.

⚠️ **Budget the questions, hard.** Two or three a month, offered at a natural moment — right after
publishing, never mid-edit. Ten a month is how a non-technical admin learns to dismiss the dialog,
and a dismissed question is worse than none because it teaches the habit.

**What it buys:** the timeline in *Consequences* below assumes signal arrives only as it happens. A
handful of targeted comparisons a month is worth many incidental edits, so **the useful horizon
moves from 6–12 months toward 3–4** — which is what the owner estimated in the first place.

**Four things are frozen against learning, permanently:**

| Frozen | Why |
|---|---|
| **The tier hierarchy** (10⁶ / 10⁴ / 10² / 10⁰) | It is a **safety property, not a tuning parameter.** An admin who leaves one slot uncovered in a hard month is enough evidence for a learner to price coverage below a preference, and that ordering is the only thing standing between the model and a roster with nobody on duty |
| **The constraint catalogue** | A learner that invents constraints will invent wrong ones, and there is no way to audit what it invented. Constraints come from humans and carry confidence tags |
| **Anything doctor-specific** | ⚠️ **The failure mode that matters.** If the principal habitually gives one doctor the good shifts, a per-doctor term learns that and reports it as fairness. Weights attach to constraints, never to people |
| **Hard bounds on every learnable weight** | Within-tier and bounded, so the worst case of a bad fit is a mildly worse roster, never a structurally broken one |

**Learned weights are a suggestion, not a silent change.** *"You have moved D07 off Sunday nights
four months running — should I stop scheduling that?"*, confirmed by the admin. The principal is not
technical, and the documented way this project fails is that he stops trusting the output and rebuilds
it in Word. **A system that silently changes how it schedules is a system he cannot predict.**

## Considered alternatives

| Option | Why rejected |
|---|---|
| **Train a model to generate the roster** | 2% feasibility on hard nurse-rostering benchmarks, and it invents doctors who do not exist. Already one of the three named ways this project fails; see `HANDOFF.md`. The solver generates, the learner only prices |
| **Learn from whole months** — one month, one data point | Makes the problem look impossible: 3–4 months is 3–4 examples and nothing fits on that. **The unit of signal is the individual edit**, and a month of ~30–50 edits is ~30–50 pairwise comparisons. Same data, two orders of magnitude more signal, and it is the reframe that makes the whole idea viable |
| **Let learning move weights across tiers** | The tier hierarchy is the safety property. See the table above |
| **A neural network over roster features** | Needs orders of magnitude more data than one practice will ever produce, and produces a weight nobody can explain to a non-technical admin who is being asked to trust it. The objective is *already linear in the weights*; a linear fit is both sufficient and auditable |
| **Per-practice learning from zero** | Wastes every other practice's data and guarantees a bad first six months. **Partial pooling instead**: a cross-practice prior, with each practice's own data pulling its weights away from it in proportion to how much it has. This is the shrinkage estimator already measured in `docs/domain/fairness.md`, applied to a different quantity |
| **Infer the reason for an edit from the edit itself** | The attribution problem is the whole difficulty. A moved shift can be a mis-weighted constraint, a phone call we will never see, or a mistake. **Asking is cheaper and better than any inference**, and it is a product feature, not a research problem |
| **Do nothing — hand-tune each practice** | Honest for practice one and two. Does not survive practice ten, and the owner is right that it will not survive practice two either without a lot of sessions |

## Consequences

**Good:**

- Turns the undeclared-arrangement problem from a per-practice engineering cost into a data-collection
  one. The thing that took a session for S-09 becomes something the app notices.
- The first three steps are useful on their own and carry no ML risk. **If the fitting step is never
  built, steps 1–3 still pay for themselves.**
- The diff report makes the solver's disagreements with the admin *visible*, which is the same
  property that made `seed:solver-departure` catch the empty objective.
- Warm-starting from a cross-practice prior means practice ten starts where practice one finished.

**Bad, or accepted as a cost:**

- **Nothing here can be built yet.** There is no application, no database, and no admin making edits.
  This ADR is a constraint on what to build, not a thing to build.
- The learner is only as good as the labels, and asking for labels costs the admin taps. Some will not
  answer, and unanswered edits are close to noise.
- **"3–4 months" is optimistic.** With ~10–15 learnable in-tier weights and 30–50 signals a month,
  stable estimates want more like 6–12 months. The *diff report* pays in month one; the fit does not.
- A learner fitted to an admin's edits inherits that admin's biases by construction. The frozen
  categories bound the damage; they do not eliminate it. **Envy** ([ADR-0015](0015-envy-as-a-fairness-cross-check.md))
  is the existing independent check and becomes more important, not less.
- **S-06's churn penalty already does a weak, free version of this** — re-solving against the
  previously published roster inherits last month's manual corrections implicitly. That is not
  learning, it has no memory beyond one month, and it cannot generalise to a month with a different
  shape. But it means the marginal value of the learner is smaller than it first appears, and it
  should be measured against S-06 rather than against nothing.

**Revisit when:** the L1 journal has recorded a full month of real edits from a real admin. Until
then every number in this document is an estimate, including the ones about how much signal an edit
carries. **If the first month's edits turn out to be mostly absorbing phone calls rather than
correcting the model, the fitting step is not worth building at all** — and the diff report will say
so.
