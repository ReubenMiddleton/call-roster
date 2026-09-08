"""The CP-SAT model builder.

Throwaway prototype. Its purpose is to discover which constraints are mis-modelled, not
to be shipped - see ``solver/README.md``.

The one rule that governs everything here
-----------------------------------------
**Make almost nothing hard.** Every constraint carries a named slack variable and a
penalty from the order-of-magnitude tier hierarchy, so the model ALWAYS returns a
solution and reports what it had to break. There is no ``INFEASIBLE`` status in the
contract.

**Exactly one constraint is structurally hard**, and it is hard because violating it would
make the output meaningless rather than merely bad:

    H-03  a doctor is only assignable while a member of the practice

It is enforced by not creating the assignment variable, so there is no roster in which a
departed doctor appears at any price. Everything else is elastic, including the three that
look hard and are not:

    H-01  exactly one doctor per shift slot     -> shortfall slack, COVERAGE tier
    H-02  at most one shift per doctor per day  -> elasticised 2026-08-31, see below
    H-10  pool GPs cannot work a weekday before 17:00

*(Corrected 3 September 2026. This list said "only two are structurally hard" and then named
three, two of which its own annotations described as elasticised, and it omitted H-03 -
which at the time was not enforced anywhere at all.)*

Everything else - rest rules, standing per-doctor rules, preferences - is elastic. That
is not laxity: the practice's own accepted minimum turnaround is 8 hours, BCEA almost
certainly does not bind these doctors at all, and a system that hard-blocks what the
principal does routinely is unusable.
"""

from __future__ import annotations

import calendar
import datetime as dt
import math
from dataclasses import dataclass
from typing import Any

import ortools
from ortools.sat.python import cp_model

from .helpers import add_soft_sequence_constraint
from .instance import Day, Instance, PreferenceType, Shift, SlotShare
from .registry import PenaltyRegistry, Tier

BURDEN_SCALE = 100
"""Burden weights are scaled to integers by this. 2.5 becomes 250; 0.001 is not expressible."""

RATIO_SCALE = 100
"""A load ratio of 1.00 is this. An excess of 12 therefore reads as 12% above fair share."""

S01_PEAK_WEIGHT = 10
"""Cost of one percentage point above fair share, for the WORST-loaded doctor.

At Tier.PREFERENCE this makes a 10% peak overload cost 100 - roughly three PREFER_NOT
breaches (30 each). Chosen so fairness and stated preferences trade sensibly rather than
one trampling the other, and DELIBERATELY not derived from the catalogue's "weight 100",
which assumes a 0/1 slack rather than a scaled magnitude. The real numbers depend on the
burden weights, which are question 35 and still [ASSUMED].
"""

S01_SPREAD_WEIGHT = 1
"""Cost of one percentage point above fair share, for EVERY doctor.

The tie-breaker beneath the peak. Without it the objective goes flat as soon as one
doctor's carry-in makes their ratio unfixable, and nothing distinguishes the other twelve.
"""

S08_PEAK_WEIGHT = 10
"""Cost of one percentage point above a fair share of the YEAR's public holidays.

Matched to S01_PEAK_WEIGHT rather than derived independently, because the two answer the
same question about different slots and a doctor should not learn that holiday fairness
is worth less than ordinary fairness. The catalogue lists both at 100 "relative within
their tier", which assumes a 0/1 slack rather than a scaled magnitude.
"""

S08_SPREAD_WEIGHT = 1
"""The per-doctor tie-breaker beneath S-08's peak, matching S01_SPREAD_WEIGHT.

Without it the objective goes flat as soon as one doctor's holiday carry-in is
unfixable within the month, and the remaining twelve become indistinguishable.
"""

H12_MINIMUM_WEIGHT = 1
"""Cost of leaving a doctor ONE shift short of the monthly floor, at Tier.CONTRACT.

Weight 1 in a tier worth 10^2, so one missing shift costs about three PREFER_NOT breaches
and about a hundredth of an uncovered slot. That ordering is the constraint: it must
outrank a preference and must never outrank coverage.
"""

H12_MAXIMUM_WEIGHT = 1
"""Cost of one shift above a doctor's agreed ceiling. Matched to the floor's weight.

Equal on purpose. Nothing the principal said ranks one above the other, and inventing an
asymmetry here would quietly decide whether the model prefers overworking one doctor or
under-using another - which is a question for him, not for this constant.
"""

FRIDAY_BACK_HALF = frozenset({"fri-evening", "fri-night"})
SATURDAY = 5
FRIDAY = 4
SUNDAY = 6
MONDAY = 0

TENTATIVE_TAKE_UP_WEIGHT = 10
"""Cost of calling on an "if necessary" offer, at Tier.PREFERENCE.

A third of S-03's 30, deliberately: taking up a fallback the doctor volunteered is a smaller
imposition than overriding a date they asked to avoid. Small enough that the offer is still
usable — the whole point of making it — and large enough that the solver reaches for anyone
else first.
"""

TENTATIVE_UNAVAILABLE_WEIGHT = 100
"""Cost of assigning a doctor a date they tentatively declared unavailable.

The heaviest weight in Tier.PREFERENCE, because it is the only one where the doctor said no.
Still ~500x cheaper than a firm UNAVAILABLE, which sits at Tier.LEGAL: "I probably cannot" is
a strong objection, not a bar.
"""

S04_MIN_TURNAROUND_HOURS = 8
"""The turnaround the practice accepts, and therefore the bound S-04 sits STRICTLY BELOW.

⚠️ Not a rest rule and not a legal minimum. The principal states 8h happens regularly and is
fine, and BCEA ss9-18 almost certainly do not bind these doctors at all - independent
contractors, and above the earnings threshold besides. See docs/ops/compliance.md. A system
that blocks an 8h turnaround is unusable, which is why this is a PREFERENCE and why the
comparison is `< 8` rather than `<= 8`.
"""

S04_WEIGHT = 40
"""Cost of one sub-8h turnaround, at Tier.PREFERENCE. The catalogue's number.

Between S-03's 30 and S-09's 50: worse than one stated PREFER_NOT, better than breaking a
habit sixteen months deep. Measured at 0.25 occurrences a month in the current era, so on a
normal month this term should be silent.
"""

S09_WEIGHT = 50
"""S-09. Cost of one shift outside a doctor's historical interval for a rotated slot.

Below S-05's 60, deliberately and in that order: a doctor who holds two thirds of a slot
has a stronger claim on it than one who holds a third. Above S-03's 30, because a habit
sixteen months deep is better evidence than a single month's PREFER_NOT - but far below
S-01's 100, so cumulative fairness still wins the argument when the two disagree.
"""

H11_WEIGHT = 1
"""Cost of one H-11 breach, at Tier.CONTRACT. Same footing as H-12's bounds.

Elastic rather than structural, like H-05's Saturday rule and for the same reason: the
principal's "never" statements have been falsified by his own rosters eleven times, and
D02's Saturday exclusion already has a documented exception path. Warn and scar, never
block.
"""


def _day_class(day: Day) -> str:
    """The burden day class, with the SAME precedence as TypeScript's classifyDay.

    ⚠️ Saturday and Sunday OUTRANK public holiday. The principal confirmed a holiday on a
    Saturday "counts once as a Saturday", and lib/analytics/shifts.ts encodes that. Two
    implementations of one rule is the weekday-integer bug again, so this function exists
    once and is tested against the same cases.
    """
    if day.weekday == SATURDAY:
        return "saturday"
    if day.weekday == SUNDAY:
        return "sunday"
    if day.is_public_holiday:
        return "public-holiday"
    return "weekday"


def _weekend_key(day: Day, shift: Shift) -> dt.date | None:
    """Which weekend a slot belongs to, or None if it is not weekend work.

    The weekend is Friday 17:00 to Monday 07:00 [CONFIRMED], so a slot is keyed by the
    Saturday it sits beside: a Friday evening keys to tomorrow, a Sunday to yesterday.
    """
    if day.weekday == SATURDAY:
        return day.date
    if day.weekday == FRIDAY and shift.start_hour >= 17:
        return day.date + dt.timedelta(days=1)
    if day.weekday == SUNDAY:
        return day.date - dt.timedelta(days=1)
    return None


@dataclass
class BuiltModel:
    model: cp_model.CpModel
    assign: dict[tuple[str, dt.date, str], cp_model.BoolVarT]
    registry: PenaltyRegistry
    instance: Instance

    def canonical_text(self) -> str:
        """A deterministic text form of the model, for snapshot testing.

        Snapshot THIS, never a generated roster. CP-SAT is not deterministic across
        versions, ``num_workers`` settings or machines, so a golden-file roster passes
        locally and fails in CI - and costs a day working out why. The regression that
        actually matters is "I broke the model builder", and this catches it.
        """
        lines = [
            f"doctors={len(self.instance.doctors)}",
            f"days={len(self.instance.days)}",
            f"slots={len(self.instance.shift_slots())}",
            f"assign_vars={len(self.assign)}",
            f"penalties={len(self.registry.entries)}",
        ]
        counts: dict[str, int] = {}
        for entry in self.registry.entries:
            counts[entry.constraint_id] = counts.get(entry.constraint_id, 0) + 1
        lines.extend(f"{cid}={count}" for cid, count in sorted(counts.items()))
        return "\n".join(lines)


def build(instance: Instance) -> BuiltModel:
    model = cp_model.CpModel()
    registry = PenaltyRegistry()
    flags = instance.flags

    slots = instance.shift_slots()

    # One Boolean per (doctor, date, shift).
    # ── H-03  A doctor is only assignable while a member of the practice  [CONFIRMED] ─
    #
    # ⚠️ THE ONLY STRUCTURAL BAR IN THE MODEL, and deliberately so. Everything else here is
    # elasticised, because a violation the principal can see and override beats a solver
    # that says "infeasible". This one is different in kind: assigning a doctor who left in
    # May a shift in September is not the lesser of two evils, it is nonsense, and there is
    # no roster in which it is the right answer. The catalogue's wording is "THE system
    # SHALL NOT assign".
    #
    # It still degrades gracefully. H-01 coverage is elastic, so a day on which nobody is a
    # member reports a shortfall rather than making the whole model infeasible - which is
    # exactly the reportable, overridable failure the design wants.
    #
    # ⚠️ NOT ENFORCED AT ALL BEFORE 3 SEPTEMBER 2026. `availableFrom`/`availableUntil` have
    # always crossed the wire and the parser has always validated them; it then returned
    # only the codes and threw the dates away, so H-03 existed in the catalogue, in the
    # contract and in the tests of the contract, and nowhere in the model. Same failure as
    # the four fields that were validated, documented and never sent on 2 September.
    assign: dict[tuple[str, dt.date, str], cp_model.BoolVarT] = {}
    for doctor in instance.doctors:
        available_from, available_until = instance.membership.get(doctor, (None, None))
        for day, shift in slots:
            if available_from is not None and day.date < available_from:
                continue
            if available_until is not None and day.date > available_until:
                continue
            assign[doctor, day.date, shift.shift_id] = model.new_bool_var(
                f"assign_{doctor}_{day.date.isoformat()}_{shift.shift_id}"
            )

    def assigned(doctor: str, date: dt.date, shift_id: str) -> cp_model.BoolVarT | None:
        """The variable, or None where H-03 says this doctor was not a member.

        Every constraint below iterates doctors x slots, so each needs to skip the pairs
        that do not exist. Returning None rather than raising keeps that a filter at each
        call site instead of a membership test duplicated in a dozen places.
        """
        return assign.get((doctor, date, shift_id))

    # ── H-13  A locked assignment is honoured exactly  [CONFIRMED by construction] ───
    #
    # ⚠️ THE SECOND STRUCTURALLY HARD CONSTRAINT, AND THE ONLY DELIBERATE EXCEPTION TO
    # "warn and scar, never block" IN THIS FILE.
    #
    # That philosophy governs THE PRACTICE'S RULES — statements about how things usually go,
    # every one of which has been falsified at least once. A lock is not one of those. It is
    # the scheduler exercising the very override the philosophy exists to protect: he has
    # already told a doctor they are on the 25th. There is nobody to warn, and a tool that
    # quietly moves a cell he pinned is one he cannot use to make a promise.
    #
    # The mirror of H-03, which is enforced by never creating the variable. Here it is fixed
    # to 1, so no roster at any price omits a locked doctor from their slot.
    #
    # NO REGISTRY ENTRY, and that is not an oversight: a constraint that cannot be violated
    # has nothing to report, and a slack variable provably always zero would sit permanently
    # in the penalty registry and in every cost breakdown derived from it.
    #
    # Safe to make hard ONLY because contract.py refuses the two payloads that could make it
    # unsatisfiable — a lock on a non-member, and two locks on one slot. Everything else a
    # lock collides with stays elastic: two locks on one doctor in one day breach H-02 and
    # are allowed at a cost, and a lock that consumes the last free doctor produces a
    # coverage shortfall elsewhere, priced at 10^6 and reported. The instruction is kept and
    # its consequence is shown.
    for ref in instance.locked_assignments:
        locked_var = assigned(ref.doctor, ref.date, ref.shift_id)
        if locked_var is None:
            # Unreachable through parse_request, which refuses this. Reached only by a
            # hand-built Instance, and raising beats silently ignoring the lock.
            raise ValueError(
                f"H-13: {ref.doctor} has no assignment variable on {ref.date} "
                f"{ref.shift_id}; they are not a member on that date."
            )
        model.add(locked_var == 1)

    # ── H-01  Exactly one doctor per shift slot  [CONFIRMED] ─────────────────────────
    # Elasticised. A hard AddExactlyOne here is the #1 cause of "no solution found" in
    # production, and it is exactly what the simpler OR-Tools tutorial does.
    for day, shift in slots:
        candidates = [
            var
            for d in instance.doctors
            if (var := assigned(d, day.date, shift.shift_id)) is not None
        ]
        shortfall = model.new_bool_var(f"shortfall_{day.date.isoformat()}_{shift.shift_id}")
        model.add(sum(candidates) + shortfall == 1)
        registry.add(
            constraint_id="H-01",
            description=(
                f"No doctor is covering the {shift.shift_id} shift on {day.date.strftime('%d %B')}."
            ),
            entity_refs={"date": day.date.isoformat(), "shiftId": shift.shift_id},
            slack_var=shortfall,
            tier=Tier.COVERAGE,
        )

    # ── H-02  A doctor works at most one shift per day  [CONFIRMED as intent, NOT absolute]
    # Elasticised on 2026-08-31. It used to be model.add_at_most_one(), i.e. genuinely hard.
    #
    # Asked directly whether it was absolute, the principal answered: "it should be absolute
    # but it has happened, and so the app should still allow for it if it happens." So a hard
    # encoding would refuse a roster he has actually built - the exact failure the warn-and-
    # scar principle exists to prevent, and the fourth constraint in this file to be caught
    # by it.
    #
    # No counterexample appears in the 1,430 transcribed assignments, so this is expected to
    # bind almost always. It is priced at the COVERAGE tier rather than LEGAL: two shifts in
    # one day is a rostering error of the same kind as an uncovered slot, not a preference
    # someone happens to hold. The solver will pay 10^6 before doing it, and will still do it
    # rather than return infeasible.
    #
    # Note this is NOT the database's overlapping-shift guarantee, which stays absolute. A
    # 07:00-15:00 and a 23:00-07:00 on the same date do not overlap, so the GiST exclusion
    # constraint has nothing to say about them and needs no change.
    for doctor in instance.doctors:
        for day in instance.days:
            same_day = [
                var
                for s in day.shifts
                if (var := assigned(doctor, day.date, s.shift_id)) is not None
            ]
            if len(same_day) < 2:
                continue
            doubled = model.new_bool_var(f"H-02_double_{doctor}_{day.date.isoformat()}")
            # doubled is forced true as soon as two or more of the day's shifts are taken.
            model.add(sum(same_day) - 1 <= len(same_day) * doubled)
            model.add(sum(same_day) >= 2).only_enforce_if(doubled)
            registry.add(
                constraint_id="H-02",
                description=(
                    f"{doctor} is assigned more than one shift on {day.date.strftime('%d %B')}."
                ),
                entity_refs={"doctorCode": doctor, "date": day.date.isoformat()},
                slack_var=doubled,
                tier=Tier.COVERAGE,
                relative_weight=1,
            )

    # ── H-04  No back-to-back night shifts  [CONFIRMED] ──────────────────────────────
    # Uses the sequence primitive rather than bespoke logic: "at most 1 consecutive
    # night" is the same constraint TYPE as "no isolated working day". Confirmed by the
    # principal as an actual rule he applies, not a byproduct of fixed commitments -
    # a distinction worth checking, because had it been a byproduct, modelling it as a
    # rule would have over-constrained the model.
    for doctor in instance.doctors:
        night_line = []
        for day in instance.days:
            night_vars = [
                var
                for s in day.shifts
                if s.is_night and (var := assigned(doctor, day.date, s.shift_id)) is not None
            ]
            if not night_vars:
                continue
            works_night = model.new_bool_var(f"night_{doctor}_{day.date.isoformat()}")
            model.add_max_equality(works_night, night_vars)
            night_line.append(works_night)

        literals, coefficients = add_soft_sequence_constraint(
            model,
            night_line,
            hard_min=1,
            soft_min=1,
            min_cost=0,
            soft_max=1,  # two in a row starts costing
            hard_max=3,  # four in a row is forbidden outright
            max_cost=1,
            prefix=f"H-04_{doctor}",
        )
        for literal, coefficient in zip(literals, coefficients, strict=True):
            registry.add(
                constraint_id="H-04",
                description=f"{doctor} is assigned night shifts on consecutive days.",
                entity_refs={"doctorCode": doctor},
                slack_var=literal,
                tier=Tier.LEGAL,
                relative_weight=coefficient,
            )

    # ── S-04  Prefer at least 8h between consecutive shifts  [CONFIRMED] ─────────────
    #
    # ⚠️ 8 HOURS IS ACCEPTABLE, NOT THE THING BEING AVOIDED. The principal states it
    # outright: "a doctor can work 3-11 one day and be working the 7-3 shift the very next
    # day which is only an 8 hour time period between the two shifts." Anything that blocks
    # an 8h turnaround is unusable, so the bound is STRICTLY BELOW 8, and it is elastic.
    #
    # Measured over 33 months and 1,979 consecutive-shift pairs, which narrowed this a long
    # way from the catalogue's general wording:
    #
    #   - Only 56 pairs are under 8h at all, and 29 of those are two shifts on ONE DAY,
    #     which is H-02's job. Pricing them here would charge twice for one thing.
    #   - All 27 genuine cases are the same shape: A NIGHT INTO THE NEXT DAY'S FIRST SHIFT.
    #     There is no 1h-7h tail to speak of - the gap is 8h or it is 0.
    #   - The rate collapsed by era: 3.00/month in Dec 2023, 1.58 in 2024, then 0.25 in both
    #     2025 and 2026. Rare and steady for two years, so this constraint should almost
    #     never fire on a current month - and if it fires often, something else is wrong.
    #
    # Same-day pairs are excluded rather than left to cancel out, because a doubled penalty
    # on one event distorts the tier arithmetic even when both terms are "correct".
    for doctor in instance.doctors:
        for earlier_index, earlier in enumerate(instance.days):
            for later in instance.days[earlier_index + 1 :]:
                if (later.date - earlier.date).days > 1:
                    break  # days are ordered; nothing further can be within 8 hours
                for first in earlier.shifts:
                    first_var = assigned(doctor, earlier.date, first.shift_id)
                    if first_var is None:
                        continue
                    ends_at = earlier.date.toordinal() * 24 + first.start_hour + first.hours
                    for second in later.shifts:
                        second_var = assigned(doctor, later.date, second.shift_id)
                        if second_var is None:
                            continue
                        starts_at = later.date.toordinal() * 24 + second.start_hour
                        gap = starts_at - ends_at
                        if not 0 <= gap < S04_MIN_TURNAROUND_HOURS:
                            continue
                        both = model.new_bool_var(
                            f"S-04_{doctor}_{earlier.date.isoformat()}_{first.shift_id}"
                            f"_{second.shift_id}"
                        )
                        # both >= first + second - 1: forced to 1 when the doctor works
                        # each side, free to be 0 otherwise, and the objective drives it
                        # down. NOT add_bool_and(...).only_enforce_if(both.negated()),
                        # which reads plausibly and asserts the reverse - it would force
                        # BOTH shifts onto the doctor whenever the penalty was not paid.
                        model.add(first_var + second_var - 1 <= both)
                        registry.add(
                            constraint_id="S-04",
                            description=(
                                f"{doctor} finishes {first.shift_id} on "
                                f"{earlier.date.strftime('%d %B')} and starts {second.shift_id} "
                                f"{gap} hours later. The practice accepts 8; this is less."
                            ),
                            entity_refs={
                                "doctorCode": doctor,
                                "date": later.date.isoformat(),
                                "shiftId": second.shift_id,
                            },
                            slack_var=both,
                            tier=Tier.PREFERENCE,
                            relative_weight=S04_WEIGHT,
                        )

    # ── H-05  A doctor with a Saturday standing rule  [CONFIRMED] ────────────────────
    # Stored as DATA on the instance, never hard-coded to a code. The principal asked
    # explicitly that almost everything be configurable, because doctors join and leave.
    for doctor in instance.unavailable_saturday:
        for day in instance.days:
            if day.weekday != SATURDAY:
                continue
            for shift in day.shifts:
                breach = assigned(doctor, day.date, shift.shift_id)
                if breach is None:
                    continue
                registry.add(
                    constraint_id="H-05",
                    description=(
                        f"{doctor} is never assigned a Saturday shift, but is assigned "
                        f"{shift.shift_id} on {day.date.strftime('%d %B')}."
                    ),
                    entity_refs={
                        "doctorCode": doctor,
                        "date": day.date.isoformat(),
                        "shiftId": shift.shift_id,
                    },
                    slack_var=breach,
                    tier=Tier.LEGAL,
                    relative_weight=10,
                )

    # ── H-06  Friday's back half TENDS to go to pool doctors  ────────────────────────
    #
    # DEMOTED on 2026-09-01, from Tier.LEGAL weight 10 to Tier.PREFERENCE weight 1.
    #
    # This was modelling an effect as a cause. "Friday's back half excludes D01-D04" was
    # encoded as a list of BANNED doctors and priced at 10^5. The anchors are not banned
    # from Friday evening - 17:00 is simply the first hour the pool exists, so the
    # pattern is a consequence of who is AVAILABLE. H-10 now models that cause directly.
    #
    # Two independent reasons the old weight was wrong. The principal confirmed H-06's
    # breaches were "requested" - a doctor asking for the shift - and a requested break
    # should be nearly free. And 11 breaches appear in 33 months, so at 10^5 the solver
    # would have fought hard to reproduce a tendency the practice does not hold.
    #
    # Still written against Pattern B's shift ids, NOT against "Friday": on a
    # public-holiday Friday Pattern B does not apply and these shifts do not exist.
    for doctor in instance.friday_back_half_excluded:
        for day in instance.days:
            for shift in day.shifts:
                if shift.shift_id not in FRIDAY_BACK_HALF:
                    continue
                breach = assigned(doctor, day.date, shift.shift_id)
                if breach is None:
                    continue
                registry.add(
                    constraint_id="H-06",
                    description=(
                        f"Friday's {shift.shift_id} shift usually goes to a pool doctor, "
                        f"but {doctor} is assigned it on {day.date.strftime('%d %B')}."
                    ),
                    entity_refs={
                        "doctorCode": doctor,
                        "date": day.date.isoformat(),
                        "shiftId": shift.shift_id,
                    },
                    slack_var=breach,
                    tier=Tier.PREFERENCE,
                    relative_weight=1,
                )

    # ── H-10  Structural availability  [CONFIRMED] ───────────────────────────────────
    #
    # Pool GPs cannot work an ordinary-weekday shift starting before 17:00 - they are at
    # their own practices. Confirmed by the principal and verified at 98.7% across 1,086
    # pool shifts in 33 months.
    #
    # DISTINCT from H-08. H-08 is a doctor DECLARING unavailability for a date, and it is
    # budgeted because unpriced declarations inflate. This is a standing fact about where
    # the doctor is: nobody declares it and it does not vary by date.
    #
    # Priced at Tier.COVERAGE, and DELIBERATELY ABOVE a coverage shortfall - weight 2
    # against the shortfall's 1.
    #
    # The first version priced them equally, reasoning that a doctor at another practice
    # and an empty slot both leave nobody in the building. True, but they are not equally
    # BAD: an empty slot is visible and tells the principal he has a problem, while a
    # phantom doctor produces a roster that looks complete and is not. Given the choice
    # the model must leave the gap showing.
    #
    # Elasticised rather than hard so it still always returns a solution rather than
    # reporting infeasible.
    #
    # Public holidays are exempt inside AvailabilityRule.blocks(), not here, so a caller
    # cannot forget it. See instance.py.
    for doctor, rule in instance.availability.items():
        if doctor not in instance.doctors:
            continue
        for day in instance.days:
            for shift in day.shifts:
                if not rule.blocks(day, shift):
                    continue
                breach = assigned(doctor, day.date, shift.shift_id)
                if breach is None:
                    continue
                registry.add(
                    constraint_id="H-10",
                    description=(
                        f"{doctor} cannot work before {rule.hour:02d}:00 on a weekday, but "
                        f"is assigned {shift.shift_id} on {day.date.strftime('%d %B')}."
                    ),
                    entity_refs={
                        "doctorCode": doctor,
                        "date": day.date.isoformat(),
                        "shiftId": shift.shift_id,
                    },
                    slack_var=breach,
                    tier=Tier.COVERAGE,
                    relative_weight=2,
                )

    # ── H-07  [INFERRED - CONFIRM]  behind a flag, DEFAULT OFF ───────────────────────
    # Scoped to PATTERN B, not to the weekday. That distinction is the whole constraint.
    #
    # It was originally written against `weekday == FRIDAY` on the strength of "zero
    # counterexamples in sixteen months". The primary source falsified that: D01 worked
    # the 07:00-17:00 long day on Friday 2 January 2026 - a Friday running Pattern C, so
    # the four-shift Friday split did not exist that day. Same on 26 December 2025, a
    # Friday that ran Pattern A.
    #
    # On every Friday that actually was a Pattern B day, D01 is absent. So the rule is
    # about the pattern, exactly like H-06 - and a weekday-scoped version is wrong on
    # precisely the days the pattern changes. See docs/domain/worked-examples.md.
    if flags.h07_d01_never_pattern_b:
        for day in instance.days:
            if day.pattern_id != "B":
                continue
            for shift in day.shifts:
                breach = assigned("D01", day.date, shift.shift_id)
                if breach is None:
                    continue
                registry.add(
                    constraint_id="H-07",
                    description=(
                        f"D01 is assigned the {shift.shift_id} shift on "
                        f"{day.date.strftime('%d %B')}, a four-shift Friday. Whether this is "
                        "a rule or a habit is unconfirmed."
                    ),
                    entity_refs={
                        "doctorCode": "D01",
                        "date": day.date.isoformat(),
                        "shiftId": shift.shift_id,
                        "patternId": day.pattern_id,
                    },
                    slack_var=breach,
                    tier=Tier.LEGAL,
                    relative_weight=10,
                )

    # ── S-05  Prefer the anchor doctor in their own recurring slot  [INFERRED] ───────
    if flags.s05_prefer_anchor_in_slot:
        for slot in instance.recurring_slots:
            for day in instance.days:
                if not slot.covers(day):
                    continue
                if not any(s.shift_id == slot.shift_id for s in day.shifts):
                    continue
                anchor_var = assigned(slot.doctor, day.date, slot.shift_id)
                if anchor_var is None:
                    # H-03: the anchor is not a member on this date. Their recurring slot is
                    # inherited by someone else, so "the anchor is missing from it" is not a
                    # violation — it is the workforce having changed.
                    continue
                # Penalise the anchor NOT being in their slot.
                absent = model.new_bool_var(
                    f"S-05_{slot.doctor}_{day.date.isoformat()}_{slot.shift_id}"
                )
                model.add(absent == 1 - anchor_var)
                registry.add(
                    constraint_id="S-05",
                    description=(
                        f"{slot.doctor} usually works {slot.shift_id} on this weekday but "
                        f"is not assigned it on {day.date.strftime('%d %B')}."
                    ),
                    entity_refs={
                        "doctorCode": slot.doctor,
                        "date": day.date.isoformat(),
                        "shiftId": slot.shift_id,
                    },
                    slack_var=absent,
                    # DEMOTED 2026-09-02, Tier.CONTRACT -> Tier.PREFERENCE. The weight is
                    # unchanged; the TIER was wrong, and wrong by a factor of 100.
                    #
                    # S-05 was the only soft constraint above the PREFERENCE tier, putting one
                    # anchor miss at 6,000 against a 10% fairness gain at 100. The catalogue's
                    # own table has S-01 at 100 and S-05 at 60, "relative within their tier",
                    # so the intended ordering was the reverse of what was built - and S-05 is
                    # the weakest-evidenced soft constraint, [INFERRED] and never confirmed.
                    #
                    # ⚠️ MEASURED, AND IT CHANGED NOTHING. Anchor adherence stayed perfect and
                    # cumulative fairness did not move, because moving one shift changes a
                    # doctor's 33-month ratio by about a tenth of a percentage point - so S-01
                    # can never outbid S-05 at any weight either side. The demotion is kept
                    # because it aligns code with the catalogue and removes a latent 100x
                    # distortion, NOT because it fixed the symptom. See docs/DECISIONS.md.
                    tier=Tier.PREFERENCE,
                    relative_weight=60,
                )

    # ── S-09  Hold each doctor near their historical share of a rotated slot  [INFERRED]
    #
    # The 68% of the roster S-05 cannot see. S-05 needs a 2/3 dominant holder and finds 7
    # slots; the other 18 are rotations, and with no term for them the objective fills them
    # on fairness arithmetic alone. That is how September 2026 put the practice principal on
    # 15 shifts - second busiest of thirteen - with not one weekend among them: he was
    # pinned to his three S-05 anchors, that spent his load budget, and nothing in the model
    # had an opinion about Saturday morning, where he historically takes 38%.
    #
    # A BOUNDED RANGE, NOT A POINT. share x occurrences gives a fraction, and the doctor is
    # free anywhere in [round(expected), ceil(expected)] - paying only outside it.
    #
    # ⚠️ THE LOW BOUND IS round(), NOT floor(), AND THAT IS THE WHOLE CONSTRAINT.
    #
    # floor() was tried first and is wrong in a way that is invisible in a single test: a
    # free interval is a tie, and S-01 breaks every tie downward, because the doctors who
    # hold large shares are exactly the ones carrying the most cumulative burden. So the
    # solver lands on the floor every month. Measured: D01 holds 38% of Saturday mornings,
    # and with floor() he got 1 of 4 in September and 1 of 5 in October - inside the interval
    # both times, and drifting below his real rate forever. round() puts the free zone where
    # the fraction actually points: 0.38 x 5 = 1.9 -> [2, 2], 0.38 x 4 = 1.52 -> [2, 2],
    # 0.28 x 4 = 1.14 -> [1, 2].
    #
    # It still self-limits at the tail: 0.04 x 4 = 0.16 -> [0, 1], binding nothing.
    if flags.s09_hold_slot_share and instance.slot_shares:
        by_slot: dict[tuple[int, str], list[SlotShare]] = {}
        for share in instance.slot_shares:
            by_slot.setdefault((share.weekday, share.shift_id), []).append(share)

        for (weekday, shift_id), shares in by_slot.items():
            occurrences = [
                day
                for day in instance.days
                if day.weekday == weekday and any(s.shift_id == shift_id for s in day.shifts)
            ]
            if not occurrences:
                continue

            # ⚠️ Rounding each doctor up independently can demand more shifts than the slot
            # has. Shares sum to 1, so the EXPECTATIONS always fit - but round() can add up
            # to half a shift per doctor, and thirteen doctors is six spare shifts of drift.
            # Every doctor over the line would then carry a violation nobody could clear, at
            # a slot that was correctly filled. floor() can never overshoot, so it is the
            # fallback, and the whole slot falls back together rather than picking losers.
            def bound(expected: float) -> tuple[int, int]:
                # ⚠️ A SHARE SMALLER THAN ONE WHOLE SHIFT CANNOT DEMAND ONE. Below 1 the low
                # bound is 0, not round(). D06 holds 15% of Sunday mornings - 0.6 of a shift
                # across the month - and round() made that a requirement to take one, which
                # is not a habit, it is arithmetic dressed as one. Above 1 the doctor really
                # does hold the slot regularly and round() is what stops S-01 shaving them
                # down to the floor every month.
                return (round(expected) if expected >= 1 else 0, math.ceil(expected))

            bounds = {s.doctor: bound(s.share * len(occurrences)) for s in shares}
            if sum(low for low, _ in bounds.values()) > len(occurrences):
                bounds = {
                    s.doctor: (math.floor(s.share * len(occurrences)), high)
                    for s, (_, high) in ((s, bounds[s.doctor]) for s in shares)
                }

            weekday_name = calendar.day_name[weekday]
            for share in shares:
                held = [
                    var
                    for day in occurrences
                    if (var := assigned(share.doctor, day.date, shift_id)) is not None
                ]
                if not held:
                    # H-03: not a member on any of these dates. Their share is inherited.
                    continue

                low, high = bounds[share.doctor]
                # Never demand more than the doctor can actually be given: H-03 may have
                # removed some occurrences, and a bound above what remains is unsatisfiable
                # by construction.
                high = min(high, len(held))
                low = min(low, high)

                total = sum(held)
                below = model.new_int_var(0, len(held), f"S-09_below_{share.doctor}_{shift_id}")
                above = model.new_int_var(0, len(held), f"S-09_above_{share.doctor}_{shift_id}")
                model.add(total + below >= low)
                model.add(total - above <= high)

                for slack, direction, bound in ((below, "fewer", low), (above, "more", high)):
                    registry.add(
                        constraint_id="S-09",
                        description=(
                            f"{share.doctor} works about {round(share.share * 100)}% of "
                            f"{weekday_name} {shift_id}, and this roster gives them "
                            f"{direction} than {bound} of the month's {len(occurrences)}."
                        ),
                        entity_refs={
                            "doctorCode": share.doctor,
                            "shiftId": shift_id,
                            "weekday": weekday_name,
                        },
                        slack_var=slack,
                        tier=Tier.PREFERENCE,
                        relative_weight=S09_WEIGHT,
                    )

    # ── S-01  Equalise CUMULATIVE burden, normalised by opportunity  [CONFIRMED goal] ─
    #
    # "S-01 is the feature that justifies the project." Solving each month independently is
    # fair-looking and actually unfair: if a doctor took three of four Christmas-week nights
    # last December, a within-month-fair January is not fair.
    #
    # ⚠️ NORMALISED BY THE BURDEN OF EACH DOCTOR'S OPPORTUNITY SET, never by headcount or
    # FTE - ADR-0012, and the reason is not a nicety. A weekends-only doctor works nothing
    # but expensive shifts, so any per-head divisor reports them as overloaded and the
    # objective responds by taking away the only work they can do. The opportunity set is
    # computed from the model itself: the slots this doctor is structurally allowed to work.
    #
    # ⚠️ NOT A DISPERSION MEASURE. Gini, Jain, standard deviation, MAD and range are all
    # non-monotonic - each improves when the LEAST-loaded doctor is given more work. What is
    # minimised here is one-sided: excess ABOVE a fair share, which can never be reduced by
    # loading someone who is already under.
    #
    # ⚠️ THIS IS LEXIMAX LEVEL ONE, NOT FULL LEXIMAX. The peak carries the weight and a
    # per-doctor excess term breaks ties beneath it. True leximax needs iterative solving -
    # minimise the peak, freeze it, minimise the next - which the single weighted objective
    # this registry builds cannot express. The gap matters when one doctor's carry-in makes
    # their ratio unfixable: the peak then goes flat and only the tie-breaker still
    # discriminates. Recorded rather than hidden.
    if flags.s01_equalise_cumulative_burden and any(s.burden_weight > 0 for _, s in slots):
        # Integer arithmetic throughout: CP-SAT has no floats. Weights are scaled by 100, so
        # 2.5 becomes 250 and anything finer than 0.01 is not representable.
        #
        # ⚠️ THE WEIGHT COMES OFF THE SLOT, NOT OUT OF A TABLE HERE. Since contract 1.3.0 the
        # sender resolves it from its own burden schedule and sends it per shift. The previous
        # version looked it up in a flat five-key map, which could not express Christmas night
        # at 8.0 or a Pattern C long day at 1.5 - so this side optimised one weighting while
        # the analytics reported another and no test could see the difference.
        points = {
            (day.date, shift.shift_id): round(shift.burden_weight * BURDEN_SCALE)
            for day, shift in slots
        }

        # ⚠️ THE DENOMINATOR IS SENT, NOT DERIVED, AND THAT IS THE POINT.
        #
        # An earlier version computed each doctor's opportunity here from H-05 and H-10 and
        # added it to the entitlement carried on the wire. Those are two different definitions
        # of "could have worked" - structural rules against observed day-class x shift-kind
        # cells - summed into one number. `entitlementWeights` on the TypeScript side is the
        # single implementation of `revealed-opportunity` (ADR-0012), and it now spans the
        # whole period the fairness verdict covers, including this month.
        #
        # The rule this follows: where a quantity exists on both sides of the boundary, send
        # it rather than recompute it. Recomputing is how the weekday integers went wrong.
        ledger_points = {
            doctor: round(instance.burden_ledger.get(doctor, (0.0, 0.0))[0] * BURDEN_SCALE)
            for doctor in instance.doctors
        }
        share_points = {
            doctor: round(instance.burden_ledger.get(doctor, (0.0, 0.0))[1] * BURDEN_SCALE)
            for doctor in instance.doctors
        }

        opportunity_total = sum(share_points.values())
        month_points = sum(points.values())
        burden_total = month_points + sum(ledger_points.values())

        if opportunity_total > 0 and burden_total > 0:
            peak = model.new_int_var(0, RATIO_SCALE * 100, "S-01_peak_ratio")
            excesses: list[tuple[str, cp_model.IntVar, int]] = []

            for doctor in instance.doctors:
                share = share_points[doctor]
                if share == 0:
                    # No opportunity means no fair share, and dividing by it would force this
                    # doctor's burden to zero rather than leaving them out of the comparison.
                    continue
                # fair_share is what perfect fairness would have given them, in points.
                fair_share = burden_total * share // opportunity_total
                if fair_share == 0:
                    continue

                # Only slots this doctor could actually hold. Summing over slots outside their
                # membership would be summing over variables that do not exist; more subtly,
                # their fair share already spans only the period they were a member for, so
                # numerator and denominator stay on the same footing.
                carried = ledger_points[doctor] + sum(
                    points[day.date, shift.shift_id] * var
                    for day, shift in slots
                    if (var := assigned(doctor, day.date, shift.shift_id)) is not None
                )
                # ratio x RATIO_SCALE <= peak, kept multiplicative so no division is needed.
                model.add(carried * RATIO_SCALE <= peak * fair_share)

                over = model.new_int_var(0, RATIO_SCALE * 100, f"S-01_over_{doctor}")
                model.add(over * fair_share >= carried * RATIO_SCALE - RATIO_SCALE * fair_share)
                excesses.append((doctor, over, fair_share))

            if excesses:
                peak_over = model.new_int_var(0, RATIO_SCALE * 100, "S-01_peak_over")
                model.add_max_equality(peak_over, [peak - RATIO_SCALE, 0])
                registry.add(
                    constraint_id="S-01",
                    description=(
                        "The most heavily loaded doctor is carrying more than their fair "
                        "share of the total burden, counting previous months."
                    ),
                    entity_refs={"measure": "peakLoadRatio", "scale": RATIO_SCALE},
                    slack_var=peak_over,
                    tier=Tier.PREFERENCE,
                    relative_weight=S01_PEAK_WEIGHT,
                )
                for doctor, over, _ in excesses:
                    registry.add(
                        constraint_id="S-01",
                        description=(
                            f"{doctor} is carrying more than their fair share of the burden, "
                            "counting previous months."
                        ),
                        entity_refs={"doctorCode": doctor, "scale": RATIO_SCALE},
                        slack_var=over,
                        tier=Tier.PREFERENCE,
                        relative_weight=S01_SPREAD_WEIGHT,
                    )

    # ── H-11  A doctor is not assigned a cell they cannot work  [CONFIRMED] ──────────
    #
    # The principal's own list, 4 September 2026. Six pool doctors cannot work a Saturday
    # morning, one cannot work any night, one cannot stay overnight on a Sunday, one works
    # weekends only.
    #
    # ⚠️ ELASTIC, like H-05 and for the same reason: every behavioural "never" in this
    # catalogue has been falsified by the practice's own rosters, and D02's Saturday rule
    # already has a documented exception path. Warn and scar, never block.
    for doctor, cells in instance.cell_exclusions.items():
        for day, shift in slots:
            if (_day_class(day), str(shift.kind)) not in cells:
                continue
            breach = assigned(doctor, day.date, shift.shift_id)
            if breach is None:
                continue
            registry.add(
                constraint_id="H-11",
                description=(
                    f"{doctor} does not work {_day_class(day)} {shift.kind} shifts but is "
                    f"assigned {shift.shift_id} on {day.date.strftime('%d %B')}."
                ),
                entity_refs={
                    "doctorCode": doctor,
                    "date": day.date.isoformat(),
                    "shiftId": shift.shift_id,
                },
                slack_var=breach,
                tier=Tier.CONTRACT,
                relative_weight=H11_WEIGHT,
            )

    # H-11's pair shape: at most N shifts inside one weekend.
    for doctor, limit in instance.max_shifts_per_weekend.items():
        weekends: dict[dt.date, list[cp_model.BoolVarT]] = {}
        for day, shift in slots:
            key = _weekend_key(day, shift)
            if key is None:
                continue
            var = assigned(doctor, day.date, shift.shift_id)
            if var is not None:
                weekends.setdefault(key, []).append(var)
        for key, in_weekend in weekends.items():
            if len(in_weekend) <= limit:
                continue
            over = model.new_int_var(0, len(in_weekend), f"H-11_wknd_{doctor}_{key}")
            model.add(over >= sum(in_weekend) - limit)
            registry.add(
                constraint_id="H-11",
                description=(
                    f"{doctor} is assigned more than {limit} shift(s) in the weekend of "
                    f"{key.strftime('%d %B')}."
                ),
                entity_refs={"doctorCode": doctor, "weekendOf": key.isoformat()},
                slack_var=over,
                tier=Tier.CONTRACT,
                relative_weight=H11_WEIGHT,
            )

    # ── H-12  A doctor's monthly shift count stays within their agreed range  [CONFIRMED]
    #
    # Given by the principal on 4 September 2026 as per-doctor maxima plus one floor for
    # everybody, and given with its own mode attached:
    #
    #     "These numbers shouldn't be treated as hard constraints, because if the practice
    #      is low on doctors for a month then some of the doctors will need to work more."
    #
    # ⚠️ TIER.CONTRACT, WHICH PUTS IT FOUR ORDERS BELOW COVERAGE. That is the whole point:
    # if the only way to cover a slot is to exceed someone's ceiling, cover the slot. A
    # ceiling that outranks coverage produces an uncovered shift, which is the one thing
    # this practice cannot have.
    #
    # ⚠️ THE FLOOR IS WHY THIS EXISTS AT ALL. Without it S-01 starves whoever is over their
    # cumulative fair share and nothing stops it reaching zero - the September 2026 solve
    # gave two of thirteen doctors NO shifts while another got nineteen, and reported
    # OPTIMAL. Building the ceilings without the floor would have been building the half
    # that constrains and not the half that protects.
    total_slots = len(slots)
    for doctor in instance.doctors:
        worked = [
            var
            for day, shift in slots
            if (var := assigned(doctor, day.date, shift.shift_id)) is not None
        ]
        if not worked:
            # H-03 says they are not a member of any day here. A floor would be asking for
            # shifts that cannot exist.
            continue

        minimum = instance.monthly_minimum_shifts
        if minimum is not None and minimum > 0:
            under = model.new_int_var(0, minimum, f"H-12_under_{doctor}")
            model.add(under >= minimum - sum(worked))
            registry.add(
                constraint_id="H-12",
                description=(f"{doctor} is rostered fewer than {minimum} shifts this month."),
                entity_refs={"doctorCode": doctor, "bound": "minimum", "value": minimum},
                slack_var=under,
                tier=Tier.CONTRACT,
                relative_weight=H12_MINIMUM_WEIGHT,
            )

        maximum = instance.monthly_maximum_shifts.get(doctor)
        if maximum is not None:
            over = model.new_int_var(0, total_slots, f"H-12_over_{doctor}")
            model.add(over >= sum(worked) - maximum)
            registry.add(
                constraint_id="H-12",
                description=(
                    f"{doctor} is rostered more than their agreed {maximum} shifts this month."
                ),
                entity_refs={"doctorCode": doctor, "bound": "maximum", "value": maximum},
                slack_var=over,
                tier=Tier.CONTRACT,
                relative_weight=H12_MAXIMUM_WEIGHT,
            )

    # ── S-08  Spread public-holiday burden across the year  [CONFIRMED as a goal] ────
    #
    # The principal, unprompted, asked what mattered most to him:
    #
    #     "The fairness scale is very important, and the fact that all the public holidays
    #      throughout the year are shared by the doctors so that the same small handful of
    #      doctors don't cover the public holidays every year."
    #
    # ⚠️ THIS PROTECTS SOMETHING THAT ALREADY WORKS. Over 2024-2025 the four anchors took
    # 12-18% of all shifts and only 6-11% of holidays; the pool doctors took 2-5% of shifts
    # and 5-9% of holidays. Holidays run the OTHER WAY round from ordinary work, on purpose,
    # and the top four rotates year to year. He is not reporting a problem.
    #
    # ⚠️ AND S-01 CANNOT SEE IT, WHICH IS WHY THIS IS A SEPARATE CONSTRAINT. S-01 equalises
    # TOTAL burden and has no opinion about its composition: a doctor can be perfectly fair
    # on the total while carrying every holiday in the year. Worse, H-10 exempts public
    # holidays - a pool GP's own practice is closed - so on a holiday EVERYONE is available
    # and nothing else in the objective prefers anyone. Asked for December 2026 with this
    # block absent, the solver gave three of nine holiday slots to a single doctor who
    # historically takes a tenth of them.
    #
    # Deliberately the same shape as S-01 - peak excess plus a per-doctor tie-breaker over
    # a ratio to a fair share - because it is the same question asked of a subset of slots.
    # What differs is the SPAN: twelve months rather than three, because there are only
    # about forty-four holiday slots in a year and three months of them says nothing.
    if flags.s08_spread_holiday_burden and instance.holiday_ledger:
        holiday_slots = [(day, shift) for day, shift in slots if day.is_public_holiday]
        if holiday_slots:
            holiday_points = {
                (day.date, shift.shift_id): round(shift.burden_weight * BURDEN_SCALE)
                for day, shift in holiday_slots
            }
            carried_points = {
                doctor: round(instance.holiday_ledger.get(doctor, (0.0, 0.0))[0] * BURDEN_SCALE)
                for doctor in instance.doctors
            }
            share_points = {
                doctor: round(instance.holiday_ledger.get(doctor, (0.0, 0.0))[1] * BURDEN_SCALE)
                for doctor in instance.doctors
            }

            opportunity_total = sum(share_points.values())
            month_points = sum(holiday_points.values())
            burden_total = month_points + sum(carried_points.values())

            if opportunity_total > 0 and burden_total > 0:
                peak = model.new_int_var(0, RATIO_SCALE * 100, "S-08_peak_ratio")
                overs: list[tuple[str, cp_model.IntVarT]] = []

                for doctor in instance.doctors:
                    share = share_points[doctor]
                    if share == 0:
                        # No holiday opportunity means no holiday fair share. Dividing by it
                        # would drive this doctor's holiday count to zero rather than leaving
                        # them out of a comparison they do not belong in.
                        continue
                    fair_share = burden_total * share // opportunity_total
                    if fair_share == 0:
                        continue

                    carried = carried_points[doctor] + sum(
                        holiday_points[day.date, shift.shift_id] * var
                        for day, shift in holiday_slots
                        if (var := assigned(doctor, day.date, shift.shift_id)) is not None
                    )
                    model.add(carried * RATIO_SCALE <= peak * fair_share)

                    over = model.new_int_var(0, RATIO_SCALE * 100, f"S-08_over_{doctor}")
                    model.add(over * fair_share >= carried * RATIO_SCALE - RATIO_SCALE * fair_share)
                    overs.append((doctor, over))

                if overs:
                    peak_over = model.new_int_var(0, RATIO_SCALE * 100, "S-08_peak_over")
                    model.add_max_equality(peak_over, [peak - RATIO_SCALE, 0])
                    registry.add(
                        constraint_id="S-08",
                        description=(
                            "One doctor is carrying more than their share of the year's "
                            "public holidays."
                        ),
                        entity_refs={"measure": "peakHolidayRatio", "scale": RATIO_SCALE},
                        slack_var=peak_over,
                        tier=Tier.PREFERENCE,
                        relative_weight=S08_PEAK_WEIGHT,
                    )
                    for doctor, over in overs:
                        registry.add(
                            constraint_id="S-08",
                            description=(
                                f"{doctor} is carrying more than their share of the year's "
                                "public holidays."
                            ),
                            entity_refs={"doctorCode": doctor, "scale": RATIO_SCALE},
                            slack_var=over,
                            tier=Tier.PREFERENCE,
                            relative_weight=S08_SPREAD_WEIGHT,
                        )

    # ── S-06  Minimise churn against the previously published roster  [ASSUMED] ──────
    #
    # "A re-solve that returns a globally better but completely different roster is a
    # product failure" - docs/domain/constraints.md. The principal has already told
    # thirteen people what they are working, over WhatsApp, and cannot unsay it.
    #
    # Priced at Tier.PREFERENCE weight 80, NOT Tier.CONTRACT. Deliberate, and the reason
    # matters: at CONTRACT it would outweigh a hundred PREFER_NOTs, so a re-solve would
    # keep everyone in place while trampling the stated preferences that usually CAUSED
    # the re-solve. Within PREFERENCE it sits above S-03 (30) and S-02 (20) as the
    # catalogue's relative weights say it should, and a preference still beats inertia
    # roughly three to one.
    #
    # THE GRADUATED CONTROL IS NOT BUILT. The catalogue asks for churn as a "how much can
    # it rearrange?" dial; what exists is on/off via `mode`. A dial needs a bounded
    # in-tier weight on the wire, and the contract deliberately ignores per-request
    # weights because a caller reordering the tier hierarchy is the safety property this
    # whole scheme protects. That is a contract change, not a model change.
    if flags.s06_minimise_churn:
        slots_by_key = {(day.date, shift.shift_id): day for day, shift in instance.shift_slots()}
        for ref in instance.previous_published:
            # A slot that no longer exists, or a doctor who has left, is skipped rather
            # than penalised. Penalising a move nobody can avoid adds a constant to every
            # solution and buys no signal, while making the cost breakdown read as though
            # the solver chose to churn.
            if (ref.date, ref.shift_id) not in slots_by_key:
                continue
            if ref.doctor not in instance.doctors:
                continue

            previous_var = assigned(ref.doctor, ref.date, ref.shift_id)
            if previous_var is None:
                # H-03: they have left since the roster was published. Charging churn for a
                # move nobody could avoid is exactly what the surrounding block already
                # declines to do for a slot that no longer exists.
                continue

            moved = model.new_bool_var(f"S-06_{ref.doctor}_{ref.date.isoformat()}_{ref.shift_id}")
            model.add(moved == 1 - previous_var)
            registry.add(
                constraint_id="S-06",
                description=(
                    f"{ref.doctor} was already published for {ref.shift_id} on "
                    f"{ref.date.strftime('%d %B')} and has been moved off it."
                ),
                entity_refs={
                    "doctorCode": ref.doctor,
                    "date": ref.date.isoformat(),
                    "shiftId": ref.shift_id,
                },
                slack_var=moved,
                tier=Tier.PREFERENCE,
                relative_weight=80,
            )

    # ── Preferences: S-02, S-03, and the hard-but-budgeted types ─────────────────────
    #
    # ✅ `tentative` = "IF NECESSARY", implemented 2026-09-06. [CONFIRMED] 2026-09-04.
    #
    # ⚠️ THE FIX IS A SIGN FLIP, NOT A SMALLER NUMBER — which is why two earlier attempts to
    # write it as a scalar failed.
    #
    # This block once computed `weight_scale = 1 if not tentative else 0`, commented it
    # "tentative = reduced", and used it as `30 * max(weight_scale, 1)` — 30 either way. The
    # flag crossed the wire, was parsed, was documented, and did nothing. The arithmetic
    # could not express the intention because the intention was not a discount.
    #
    # The principal confirmed `±` means the doctor is NOT offering the date but will take it
    # if the roster cannot be covered otherwise. So for a tentative PREFER:
    #
    #   a firm PREFER  penalises NOT assigning it   →  slack on `1 - var`, weight 20
    #   a tentative one penalises     ASSIGNING it  →  slack on `var`,     weight 10
    #
    # Same tier, opposite variable. Anything that only scaled the weight was pushing the
    # solver to spend the fallback MORE eagerly the more it was "discounted", because the
    # penalty was on missing it.
    #
    # The whole rule, applied to every type: TENTATIVE MOVES A PREFERENCE ONE STEP TOWARD
    # NEUTRAL AND NEVER PAST IT.
    #
    #   PREFER        miss costs 20         →  take-up costs 10   (reported as S-03)
    #   PREFER_NOT    assignment costs 30   →  assignment costs 10
    #   UNAVAILABLE   assignment at LEGAL   →  assignment at PREFERENCE, 100
    #   MUST          —                     →  refused at the wire; see contract.py
    #
    # A tentative take-up is reported under S-03 rather than S-02 because S-02 is about a
    # request being MISSED, and nothing was missed here — the doctor got something they had
    # asked to avoid unless needed, which is exactly what S-03 describes.
    for preference in instance.preferences:
        for date in preference.dates:
            day = next((d for d in instance.days if d.date == date), None)
            if day is None:
                continue
            targets = [
                s
                for s in day.shifts
                if preference.shift_ids is None or s.shift_id in preference.shift_ids
            ]

            # ⚠️ A WHOLE-DAY "PREFER" IS SATISFIED BY *ANY* SHIFT THAT DAY, NOT ALL OF THEM.
            #
            # Registered once per DATE rather than once per shift. The per-shift version
            # priced "I can work the weekend of the 4th to the 6th" as nine separate wishes
            # and then reported eight of them broken when the doctor got exactly what they
            # asked for. On the September 2026 diary that inflated S-02 to 170 violations
            # and about a quarter of the whole objective, and it would have shown a doctor
            # their request had been "mostly refused" when it had been granted.
            #
            # A preference naming SPECIFIC shifts keeps the per-shift treatment below,
            # because there each named shift genuinely is a separate wish.
            if preference.type is PreferenceType.PREFER and preference.shift_ids is None:
                day_vars = [
                    var
                    for s in targets
                    if (var := assigned(preference.doctor, date, s.shift_id)) is not None
                ]
                if day_vars:
                    worked_that_day = model.new_bool_var(
                        f"S-02_day_{preference.doctor}_{date.isoformat()}"
                    )
                    model.add_max_equality(worked_that_day, day_vars)
                    if preference.tentative:
                        # The sign flip. Penalise WORKING it, not missing it — and once per
                        # date, for the same reason the firm branch is once per date.
                        registry.add(
                            constraint_id="S-03",
                            description=(
                                f"{preference.doctor} offered {date.strftime('%d %B')} only "
                                "if necessary, and the roster called on it."
                            ),
                            entity_refs={
                                "doctorCode": preference.doctor,
                                "date": date.isoformat(),
                                "sourceToken": preference.source_token,
                            },
                            slack_var=worked_that_day,
                            tier=Tier.PREFERENCE,
                            relative_weight=TENTATIVE_TAKE_UP_WEIGHT,
                        )
                    else:
                        missed_day = model.new_bool_var(
                            f"S-02_missed_{preference.doctor}_{date.isoformat()}"
                        )
                        model.add(missed_day == 1 - worked_that_day)
                        registry.add(
                            constraint_id="S-02",
                            description=(
                                f"{preference.doctor} asked to work "
                                f"{date.strftime('%d %B')} and was not rostered that day."
                            ),
                            entity_refs={
                                "doctorCode": preference.doctor,
                                "date": date.isoformat(),
                            },
                            slack_var=missed_day,
                            tier=Tier.PREFERENCE,
                            relative_weight=20,
                        )
                continue

            for shift in targets:
                var = assigned(preference.doctor, date, shift.shift_id)
                if var is None:
                    # H-03: a preference for a date they are not a member on. Nothing to
                    # honour and nothing to breach — they cannot be assigned it either way.
                    continue
                pretty = date.strftime("%d %B")

                if preference.type is PreferenceType.UNAVAILABLE:
                    registry.add(
                        constraint_id="H-08",
                        description=(
                            f"{preference.doctor} is unavailable on {pretty} but is "
                            f"assigned {shift.shift_id}."
                        ),
                        entity_refs={
                            "doctorCode": preference.doctor,
                            "date": date.isoformat(),
                            "shiftId": shift.shift_id,
                            "sourceToken": preference.source_token,
                        },
                        slack_var=var,
                        # "I probably cannot" is a strong objection, not a bar. Demoted out
                        # of LEGAL entirely rather than discounted within it, because the
                        # tiers are orders of magnitude apart and a firm UNAVAILABLE must
                        # stay ~500x dearer than a tentative one.
                        tier=Tier.PREFERENCE if preference.tentative else Tier.LEGAL,
                        relative_weight=(
                            TENTATIVE_UNAVAILABLE_WEIGHT if preference.tentative else 5
                        ),
                    )
                elif preference.type is PreferenceType.PREFER_NOT:
                    registry.add(
                        constraint_id="S-03",
                        description=(
                            f"{preference.doctor} asked not to work {pretty} but is "
                            f"assigned {shift.shift_id}."
                        ),
                        entity_refs={
                            "doctorCode": preference.doctor,
                            "date": date.isoformat(),
                            "shiftId": shift.shift_id,
                        },
                        slack_var=var,
                        tier=Tier.PREFERENCE,
                        relative_weight=TENTATIVE_TAKE_UP_WEIGHT if preference.tentative else 30,
                    )
                elif preference.type is PreferenceType.PREFER and preference.tentative:
                    # The sign flip again, for a preference naming SPECIFIC shifts. Here each
                    # named shift really is a separate offer, so the take-up is per shift.
                    registry.add(
                        constraint_id="S-03",
                        description=(
                            f"{preference.doctor} offered {shift.shift_id} on {pretty} only "
                            "if necessary, and the roster called on it."
                        ),
                        entity_refs={
                            "doctorCode": preference.doctor,
                            "date": date.isoformat(),
                            "shiftId": shift.shift_id,
                            "sourceToken": preference.source_token,
                        },
                        slack_var=var,
                        tier=Tier.PREFERENCE,
                        relative_weight=TENTATIVE_TAKE_UP_WEIGHT,
                    )
                elif preference.type is PreferenceType.PREFER:
                    missed = model.new_bool_var(
                        f"S-02_{preference.doctor}_{date.isoformat()}_{shift.shift_id}"
                    )
                    model.add(missed == 1 - var)
                    registry.add(
                        constraint_id="S-02",
                        description=(
                            f"{preference.doctor} asked to work {pretty} but was not "
                            f"assigned {shift.shift_id}."
                        ),
                        entity_refs={
                            "doctorCode": preference.doctor,
                            "date": date.isoformat(),
                            "shiftId": shift.shift_id,
                        },
                        slack_var=missed,
                        tier=Tier.PREFERENCE,
                        relative_weight=20,
                    )
                elif preference.type is PreferenceType.MUST:
                    missed = model.new_bool_var(
                        f"H-09_{preference.doctor}_{date.isoformat()}_{shift.shift_id}"
                    )
                    model.add(missed == 1 - var)
                    registry.add(
                        constraint_id="H-09",
                        description=(
                            f"{preference.doctor} committed to working {pretty} but is "
                            f"not assigned {shift.shift_id}."
                        ),
                        entity_refs={
                            "doctorCode": preference.doctor,
                            "date": date.isoformat(),
                            "shiftId": shift.shift_id,
                        },
                        slack_var=missed,
                        tier=Tier.LEGAL,
                        relative_weight=5,
                    )

    # ── The objective: nothing but the registry ──────────────────────────────────────
    # If a penalty is not in the registry it is not in the objective. That invariant is
    # what makes the violations report trustworthy.
    terms = registry.objective_terms()
    model.minimize(sum(var * weight for var, weight in terms))

    return BuiltModel(model=model, assign=assign, registry=registry, instance=instance)


@dataclass
class SolveResult:
    status: str
    assignments: list[dict[str, str]]
    violations: list[dict[str, Any]]
    cost_by_tier: dict[str, int]
    objective: int
    wall_clock_seconds: float
    # L3, solve-run diagnostics (docs/ops/diagnostics.md): "a failed or surprising solve must be
    # reproducible from its row alone", and CP-SAT is not deterministic across versions or
    # `num_workers` -- a reproduction that does not pin both is not a reproduction. Returned here,
    # not re-derived elsewhere, so there is exactly one place that can drift from what was
    # actually used.
    num_workers: int
    cp_sat_version: str


def solve(
    built: BuiltModel,
    time_budget_seconds: float = 30.0,
    *,
    deterministic: bool = False,
) -> SolveResult:
    """Solve, and never return 'infeasible'.

    ``TIMED_OUT`` with a usable roster is normal and correct - the budget expired and the
    incumbent was returned. It is a quality statement, not a failure.

    ⚠️ THIS MODEL IS UNDER-DETERMINED, AND ``deterministic`` EXISTS BECAUSE OF IT.

    Found 6 September 2026 while comparing solved rosters against the practice's real one:
    eight consecutive solves of an IDENTICAL model returned FOUR different rosters, every one
    of them at objective 11,547. Many assignments are genuinely interchangeable - the pool
    slots have no dominant holder and every pool doctor prices the same - so "the optimal
    roster" is a set, not a roster, and parallel workers pick an arbitrary member of it.

    Consequences, both of which cost real time before this was understood:

    1. **A single solve's agreement with a target roster is not a measurement.** The same
       configuration scored anywhere from 51/94 to 59/94 against September 2026. Any such
       comparison must average over runs, or fix the seed with this flag.
    2. **Pressing "generate" twice will show the admin two different rosters.** S-06's churn
       penalty handles this ACROSS published versions but not within one sitting.

    ``deterministic`` keeps all eight workers and adds ``interleave_search`` with a fixed
    seed, which is OR-Tools' own reproducible-parallel mode. Measured: four runs, all
    ``OPTIMAL`` at 11,547, ONE distinct roster, ~4s against ~0.4s. Ten times slower and
    exactly right, which is the correct trade for a measurement.

    ⚠️ TWO WRONG VERSIONS OF THIS FLAG CAME FIRST, and both looked like they worked.

    Dropping to ``num_workers = 1`` does not make the search reproducible, it makes it too
    slow to finish: one worker never proved optimality here at any budget tried, returning
    whichever incumbent the clock caught. Three runs gave 13,130 / 13,281 / 13,242 — all
    worse than the 11,547 eight workers find in under a second, and *less* reproducible than
    the default it replaced. Swapping the wall-clock limit for ``max_deterministic_time``
    fixed the reproducibility of the stopping point and not the problem: 82 seconds of work
    still only reached 12,946.

    **The parallel workers are not redundant copies** — they run different strategies and
    need each other to close this model. Serialising the search is not a slower route to the
    same answer; it is a different, worse one.
    """
    num_workers = 8
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_budget_seconds
    solver.parameters.num_workers = num_workers
    if deterministic:
        solver.parameters.random_seed = 0
        solver.parameters.interleave_search = True
    status = solver.solve(built.model)

    status_name = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "TIMED_OUT",
        cp_model.INFEASIBLE: "ERROR",
        cp_model.MODEL_INVALID: "ERROR",
        cp_model.UNKNOWN: "ERROR",
    }[status]

    assignments: list[dict[str, str]] = []
    violations: list[dict[str, Any]] = []
    tiers: dict[str, int] = {}
    objective = 0

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for (doctor, date, shift_id), var in built.assign.items():
            if solver.value(var):
                assignments.append(
                    {"date": date.isoformat(), "shiftId": shift_id, "doctorCode": doctor}
                )
        assignments.sort(key=lambda a: (a["date"], a["shiftId"]))
        violations = built.registry.violations(solver)
        tiers = built.registry.cost_by_tier(solver)
        objective = int(solver.objective_value)

    return SolveResult(
        status=status_name,
        assignments=assignments,
        violations=violations,
        cost_by_tier=tiers,
        objective=objective,
        wall_clock_seconds=solver.wall_time,
        num_workers=num_workers,
        cp_sat_version=ortools.__version__,
    )
