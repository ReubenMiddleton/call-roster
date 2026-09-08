"""Instance types, and the September 2026 instance built from confirmed domain facts.

Doctor codes only - D01..D15. Never a real name, including in fixtures and docstrings.
The mapping lives in the gitignored ``private/doctor-codes.md``. See ``AGENTS.md``.

Everything here traces to ``docs/domain/shift-patterns.md`` and
``docs/domain/constraints.md``, and carries the same confidence tags. An ``[INFERRED]``
fact must not be modelled as though it were ``[CONFIRMED]``.
"""

from __future__ import annotations

import calendar
import datetime as dt
from dataclasses import dataclass, field
from enum import StrEnum


class ShiftKind(StrEnum):
    """Burden-relevant classification. Times live on the Shift, not here.

    ⚠️ REALIGNED 2026-09-01 to match lib/analytics/types.ts, which is the correct vocabulary.

    This enum previously held seven members including FRI_EARLY, FRI_MIDDAY and FRI_EVENING.
    Those are pattern POSITIONS, not burden classes - and the mismatch was not cosmetic:

    - The glossary defines the burden axis as "day class x shift kind", so kind is a BURDEN
      concept. "The second shift of a Friday" is not a burden class.
    - The label already lied for one of the three patterns: Pattern C's red-evening shift
      carried FRI_EVENING, and a Pattern C day is not a Friday.
    - Six of the seven members earned nothing. The only consumer is is_night, which reads
      NIGHT. The rest were decoration with a maintenance cost.
    - And they differed from the TypeScript side across the wire, which is the same class of
      bug as the weekday integers: a value meaning something on one side and nothing on the
      other. "long_day" against "long-day" would have been rejected outright.

    Five members now, spelled exactly as TypeScript spells them.
    """

    MORNING = "morning"
    AFTERNOON = "afternoon"
    EVENING = "evening"
    NIGHT = "night"
    LONG_DAY = "long-day"


@dataclass(frozen=True)
class Shift:
    shift_id: str
    kind: ShiftKind
    start_hour: int
    end_hour: int
    ends_next_day: bool = False
    burden_weight: float = 0.0
    """S-01. The agreed cost of this slot, resolved by TypeScript from the tenant schedule.

    Sent per slot since contract 1.3.0 rather than derived here from a flat key table. The
    table could not express Christmas night at 8.0 or a Pattern C long day at 1.5, so the
    solver optimised one weighting while the analytics reported another and neither side
    could tell. Defaults to 0.0 so the hand-written fixtures need not restate it; a real
    request always carries it.
    """

    @property
    def hours(self) -> int:
        if self.ends_next_day:
            return (24 - self.start_hour) + self.end_hour
        return self.end_hour - self.start_hour

    @property
    def is_night(self) -> bool:
        return self.kind is ShiftKind.NIGHT


# ── The three patterns. docs/domain/shift-patterns.md ────────────────────────────────

# Pattern A - "Standard". Sun, Mon, Tue, Wed, Thu, Sat.  [CONFIRMED]
PATTERN_A: tuple[Shift, ...] = (
    Shift("std-morning", ShiftKind.MORNING, 7, 15),
    Shift("std-afternoon", ShiftKind.AFTERNOON, 15, 23),
    Shift("std-night", ShiftKind.NIGHT, 23, 7, ends_next_day=True),
)

# Pattern B - "Friday". Fridays only, four shifts not three.  [CONFIRMED]
PATTERN_B: tuple[Shift, ...] = (
    Shift("fri-early", ShiftKind.MORNING, 7, 12),
    Shift("fri-midday", ShiftKind.AFTERNOON, 12, 17),
    Shift("fri-evening", ShiftKind.EVENING, 17, 23),
    Shift("fri-night", ShiftKind.NIGHT, 23, 7, ends_next_day=True),
)

# Pattern C - "Reduced". Thin staffing.  [INFERRED - high confidence]
# The *cause* is [CONFIRMED]: not enough available doctors, so someone works longer.
PATTERN_C: tuple[Shift, ...] = (
    Shift("red-longday", ShiftKind.LONG_DAY, 7, 17),
    Shift("red-evening", ShiftKind.EVENING, 17, 23),
    Shift("red-night", ShiftKind.NIGHT, 23, 7, ends_next_day=True),
)

PATTERNS: dict[str, tuple[Shift, ...]] = {"A": PATTERN_A, "B": PATTERN_B, "C": PATTERN_C}


@dataclass(frozen=True)
class Day:
    """One date. The pattern is a property of the DATE, not the weekday.

    The weekday supplies a default; any date can override it. This is the single most
    important schema consequence in the project - see docs/domain/shift-patterns.md.
    """

    date: dt.date
    pattern_id: str
    is_public_holiday: bool = False

    explicit_shifts: tuple[Shift, ...] | None = None
    """The day's actual shifts, as sent over the contract. Authoritative when present.

    ⚠️ THE FALLBACK BELOW IS A FIXTURE CONVENIENCE, NOT A PRODUCTION PATH.

    The global PATTERNS table holds the pilot practice's three patterns. Reading shifts
    from it is a single-tenant assumption of exactly the kind ADR-0010 warns about - and
    the contract already sends the shifts per date, so the assumption is unnecessary as
    well as wrong. A second tenant with a four-shift Saturday would silently get this
    practice's times.

    contract.py therefore ALWAYS populates this, and never falls through. The fallback
    exists so september_2026() and 41 tests can keep writing Day(date=..., pattern_id="A")
    without restating three shifts every time.
    """

    @property
    def shifts(self) -> tuple[Shift, ...]:
        """This day's shifts. Explicit if supplied, else the pattern table's default.

        A day's shift structure is a property of the DATE, not the weekday: the weekday
        supplies a default and any date can override it. That is what pattern_id is - a
        per-date pointer, not a weekday rule.
        """
        if self.explicit_shifts is not None:
            return self.explicit_shifts
        return PATTERNS[self.pattern_id]

    @property
    def weekday(self) -> int:
        """Monday = 0 .. Sunday = 6."""
        return self.date.weekday()


class PreferenceType(StrEnum):
    UNAVAILABLE = "UNAVAILABLE"
    PREFER_NOT = "PREFER_NOT"
    PREFER = "PREFER"
    MUST = "MUST"


@dataclass(frozen=True)
class Preference:
    doctor: str
    type: PreferenceType
    dates: frozenset[dt.date]
    shift_ids: frozenset[str] | None = None
    tentative: bool = False
    source_token: str | None = None
    """Provenance. 'NOT' for the diary's second list - see docs/domain/preferences.md."""


@dataclass(frozen=True)
class RecurringSlot:
    """A (weekday, shift, doctor) triple with a validity interval.

    Holding one or more of these is what makes a doctor an "anchor". It is NOT a role
    and NOT an enum - see docs/product/glossary.md. This is what let D05 replace D04 and
    D03 on two specific slots in June 2026 with no special-casing at all.
    """

    doctor: str
    weekday: int
    shift_id: str
    valid_from: dt.date | None = None
    valid_until: dt.date | None = None

    def covers(self, day: Day) -> bool:
        if day.weekday != self.weekday:
            return False
        if self.valid_from is not None and day.date < self.valid_from:
            return False
        # Guard-clause chain kept deliberately: three independent reasons to reject read
        # far more clearly than one negated conjunction.
        if self.valid_until is not None and day.date > self.valid_until:  # noqa: SIM103
            return False
        return True


@dataclass
class FeatureFlags:
    """[INFERRED] and [ASSUMED] constraints live here, DEFAULT OFF.

    The asymmetry that sets the defaults: if a rule is really a habit and we encode it,
    we silently remove the principal's own flexibility on his own roster, invisibly. If
    it is real and we omit it, he sees it in the draft and tells us. The second failure
    is cheap and visible; the first is expensive and invisible.

    A confirmed answer flips a switch here rather than triggering a rewrite.
    """

    h07_d01_never_pattern_b: bool = False
    """H-07 [FALSIFIED as an absolute]. Scoped to PATTERN B, not to the weekday.

    Originally written as "never a Friday" on the strength of zero counterexamples in 16
    months. Falsified by the primary source: D01 worked the long day on Friday 2 January
    2026, a Friday running Pattern C.

    CORRECTED 2026-09-02. This docstring used to add "on every Friday that was actually a
    Pattern B day, D01 is absent - so the rule is about the pattern." That was FALSE. All
    33 transcribed months contain 26 Pattern B Fridays worked by D01, and the rescoping
    was fitted to a single counterexample without being checked against the rest.

    Worse, it is not a habit either: D01 worked 53% of Pattern B Fridays before August
    2024 and 9% after, and the step coincides with D04 entering the Friday rotation. The
    behaviour follows a colleague's availability, so it would likely reverse if D04 left.

    LEAVE THIS FLAG OFF even if the principal confirms the rule. He would be describing
    the current era accurately and the encoded rule would still be wrong for the next one.
    See docs/domain/constraints.md.
    """

    s05_prefer_anchor_in_slot: bool = True
    """S-05 [INFERRED] but SOFT, so enabling it costs nothing that cannot be outvoted."""

    s01_equalise_cumulative_burden: bool = True
    """S-01 [CONFIRMED as a goal]. ON by default - unlike the [INFERRED] flags above.

    "S-01 is the feature that justifies the project": solving each month independently is
    fair-looking and actually unfair. The goal is confirmed; only the WEIGHTS are
    [ASSUMED], and those are question 35. Shipping it off would ship a solver that has no
    opinion about fairness at all, which is what it was before 2 September 2026.
    """

    s09_hold_slot_share: bool = True
    """S-09 [INFERRED] but SOFT, on the same reasoning as s05_prefer_anchor_in_slot.

    ON by default despite being [INFERRED], because the alternative is worse than the risk.
    S-05 covers 7 slots; the other 18 are 68% of the roster, and with nothing modelling them
    the objective fills them on fairness arithmetic alone. That produced the September 2026
    solve in which the practice principal worked 15 shifts, second busiest of thirteen, and
    not one of them a weekend - every one of them an S-05 anchor. Shipping this off ships
    that roster.

    Outvotable at the PREFERENCE tier by anything that matters, and inert when slot_shares
    is empty, so a first solve with no history is unaffected.
    """

    s08_spread_holiday_burden: bool = True
    """S-08 [CONFIRMED as a goal]. Spread public-holiday burden over a twelve-month ledger.

    ON by default. The GOAL is the principal's own, volunteered unprompted on 4 September
    2026 as the thing that matters most to him - "all the public holidays throughout the
    year are shared by the doctors so that the same small handful don't cover them every
    year". The MECHANISM below is mine, which is why the window is a named constant with
    its reasoning attached rather than a number inline.

    Sits out on its own when holiday_ledger is empty, so a first solve is unaffected.
    """

    s06_minimise_churn: bool = True
    """S-06 [ASSUMED]. Penalise moving a slot that was already published.

    ON by default, unlike the other two flags, and the asymmetry is deliberate: the
    others encode a rule that might be a habit, so being wrong costs the principal his
    own flexibility invisibly. This one only says "prefer not to rearrange what thirteen
    people have already been told", which is a product property rather than a claim about
    the practice. Being wrong about it costs a re-solve that moves more than it needed to,
    and that is visible in the diff.

    ``mode: "OFF"`` in the request turns it off - which is the "let it rearrange freely"
    control docs/domain/constraints.md asks for, at its coarsest. A graduated version
    needs a contract change; see the note in model.py.
    """


@dataclass(frozen=True)
class AssignmentRef:
    """One doctor placed in one slot on one date.

    The wire shape of both ``previousPublished`` and ``lockedAssignments``. Deliberately
    the same type for both: they refer to the same thing and differ only in what the
    model does with them - S-06 penalises moving away from the first, and a lock forbids
    moving away from the second.
    """

    date: dt.date
    shift_id: str
    doctor: str


@dataclass(frozen=True)
class AvailabilityRule:
    """H-10 [CONFIRMED]. A standing fact about where a doctor is, not a declaration.

    Distinct from a Preference of type UNAVAILABLE, and the distinction is load-bearing:
    H-08 is a doctor SAYING they are unavailable on a date, which is budgeted because
    unpriced declarations inflate. This is structural - pool GPs are at their own
    practices until late afternoon. Nobody declares it and it does not vary by date.

    Source: the principal, asked what triggers the reduced 07:00-17:00 pattern - "GPs
    can't work before 17:00 since they are working at other practices." Verified at
    98.7% across 1,086 pool shifts in 33 months.
    """

    hour: int
    """Cannot work an ordinary-weekday shift starting before this hour."""

    except_weekdays: frozenset[int] = frozenset()
    """Weekdays the rule does not apply to, Monday = 0.

    Exists for a real case: two pool doctors alternate a Monday 15:00-23:00 shift
    fortnightly, the only exceptions in 1,086 pool shifts. Without this they would be
    modelled as unable to work it.
    """

    def blocks(self, day: Day, shift: Shift) -> bool:
        """Whether this rule forbids the doctor from working the slot.

        Public holidays are exempt INTRINSICALLY, not by caller convention: on a holiday
        the GPs' own practices are closed, so they are free. Forty such daytime shifts
        appear in 33 months, and that asymmetry is what confirmed the mechanism rather
        than merely the pattern. Leaving it to the caller would reintroduce the error.
        """
        if day.is_public_holiday:
            return False
        if day.weekday > FRIDAY:  # Saturday or Sunday
            return False
        if day.weekday in self.except_weekdays:
            return False
        return shift.start_hour < self.hour


@dataclass(frozen=True)
class SlotShare:
    """S-09. One doctor's historical share of a slot with NO dominant holder.

    S-05 covers the 7 slots one doctor holds outright; this covers the other 18, which are
    68% of the roster. Both are habit; the difference is that a rotation is shared, so the
    target is an interval over the month's occurrences rather than a name on a slot.

    NEVER carries a slot that also appears in recurring_slots - the two partition the slots
    and the weights are not calibrated for a slot priced twice. The TypeScript builder
    refuses the overlap; see docs/domain/constraints.md#s-09.
    """

    doctor: str
    weekday: int
    shift_id: str
    share: float

    def matches(self, day: Day, shift_id: str) -> bool:
        return day.weekday == self.weekday and shift_id == self.shift_id


@dataclass
class Instance:
    doctors: list[str]
    days: list[Day]
    recurring_slots: list[RecurringSlot] = field(default_factory=list)
    slot_shares: list[SlotShare] = field(default_factory=list)
    locked_assignments: list[AssignmentRef] = field(default_factory=list)
    """H-13. Cells the scheduler pinned before solving. Structurally hard.

    The mirror of H-03: that one is enforced by never creating the variable, this one by
    fixing it to 1. There is no roster at any price in which a locked doctor is absent from
    their slot - and unlike every other rule here that is correct, because a lock is not a
    statement about how the practice usually works. It is the scheduler exercising the
    override that "warn and scar, never block" exists to protect.

    Being hard, it could make an instance unsatisfiable, so the two ways it could are refused
    at the wire instead: a lock on a non-member (H-03 wins, and there is no variable to fix)
    and two locks on one slot. See docs/domain/constraints.md#h-13.
    """
    preferences: list[Preference] = field(default_factory=list)
    unavailable_saturday: frozenset[str] = frozenset()
    """H-05 [CONFIRMED]. Per-doctor standing rule, stored as DATA not hard-coded."""
    friday_back_half_excluded: frozenset[str] = frozenset()
    """H-06. A weak tendency, NOT a ban - see the note in model.py.

    Kept because the tendency is real and the ID is referenced in tests and messages, but
    demoted to the PREFERENCE tier on 2026-09-01. The anchors are not forbidden Friday
    evening: 17:00 is simply the first hour the pool exists, so the pattern is a
    consequence of H-10 availability. The principal confirmed its breaches were requested.
    """
    availability: dict[str, AvailabilityRule] = field(default_factory=dict)
    """H-10 [CONFIRMED]. Structural availability, by doctor code.

    Absent means no restriction. Stored as DATA, never hard-coded to a code, because
    doctors join and leave and their other jobs change.
    """
    burden_weights: dict[str, float] = field(default_factory=dict)
    """S-01. The agreed cost of one shift, keyed by day class and shift kind.

    Keys are the contract's: public_holiday, sunday, saturday, weekday_night, weekday_day.
    Empty disables S-01 - with no weights there is no burden to equalise, and inventing a
    default here would optimise a fairness objective nobody agreed to.

    ⚠️ COARSER THAN THE LEDGER'S SCHEDULE, and knowingly so. The TypeScript side prices
    Christmas night at 8.0 and a Pattern C long day at 1.5; five flat keys cannot express
    either, so the solver values them at 5.0 and 1.0. That is 2 nights and 14 long days in
    33 months. Recorded in docs/architecture/solver-contract.md; the fix is a resolved
    per-slot weight on the wire, which removes the second implementation entirely.
    """

    burden_ledger: dict[str, tuple[float, float]] = field(default_factory=dict)
    """S-01. ``doctor -> (cumulative burden carried, entitlement)`` before this month.

    The whole point of the constraint: a within-month-fair January is not fair if someone
    took three of four Christmas-week nights last December. A paper diary structurally
    cannot do this, and it is the reason the project exists - see docs/domain/fairness.md.

    ⚠️ BOTH HALVES, and the second is not optional. Dividing a cumulative burden by a
    SINGLE MONTH's opportunity share is dimensionally wrong: a doctor who joined last month
    carries almost nothing against a full month's share, reads as enormously under-loaded,
    and the solver hands them everything. That was the first implementation's behaviour on
    2026-09-02 and it produced a roster further from the practice's habits on every axis
    than any month in three years. `entitlement` is the burden of what they COULD have
    worked over the same span the carry-in covers - ADR-0012.

    Absent means a first solve, which is correct: no carry-in, no history to normalise by.
    """

    cell_exclusions: dict[str, frozenset[tuple[str, str]]] = field(default_factory=dict)
    """H-11 [CONFIRMED]. Per-doctor forbidden (day class, shift kind) cells, by code.

    Given by the principal on 4 September 2026 as a plain list: six pool doctors cannot
    work a Saturday morning, one cannot work any night, one cannot sleep at the hospital on
    a Sunday night, one works weekends only.

    ⚠️ STORED AS THE LIST HE GAVE, NOT AS A THEORY ABOUT IT. Six doctors sharing "no
    Saturday morning" is almost certainly one rule about pool GPs whose own practices open
    on a Saturday morning - the same mechanism as H-10 - but turning his list into a class
    rule is exactly the move that produced H-06's backwards model, which took 33 months of
    data to unpick. Question 46 asks him; until then this is nine independent facts.

    "Weekends only" is expressed as exclusion from every weekday cell, so one mechanism
    covers both shapes rather than two.
    """

    max_shifts_per_weekend: dict[str, int] = field(default_factory=dict)
    """H-11's other shape: at most N shifts within one weekend, by doctor code.

    D04 cannot work two weekend shifts in the same weekend. That is a constraint on a PAIR
    of slots rather than on a cell, so it cannot be expressed as an exclusion - it is a
    sequence constraint like H-04.

    A weekend is Friday 17:00 to Monday 07:00, [CONFIRMED] 2026-08-31, and shifts are
    grouped by the Saturday they belong to.
    """

    time_budget_seconds: float | None = None
    """How long the sender is willing to wait. None means the caller decides.

    ⚠️ ACCEPTED, DOCUMENTED AND IGNORED UNTIL 6 SEPTEMBER 2026. The contract has always
    carried timeBudgetSeconds and described it as "the solver returns its incumbent best
    when this expires"; the parser listed it as a known field so it was not rejected, never
    read it, and never type-checked it - so a string would have passed silently and the
    budget actually used came from a command-line flag.

    The fourth field this week found to be validated, documented and unused. The others
    were H-03's membership dates, the tentative flag, and burdenWeights. The shape of the
    bug is always the same: the sender believes it is honoured and nothing says otherwise.
    """

    monthly_minimum_shifts: int | None = None
    """H-12 [CONFIRMED]. The floor every doctor should reach in a month. None disables it.

    Two, at this practice. Practice-wide rather than per-doctor because that is how the
    principal stated it on 4 September 2026: per-doctor MAXIMA, and a single minimum "for
    all doctors".

    ⚠️ THE FLOOR IS NOT A NICETY. Without it S-01 starves whoever is over their cumulative
    fair share, and nothing stops it reaching zero: the September 2026 solve gave D03 and
    D08 no shifts at all while D04 got nineteen, and reported OPTIMAL doing it. A fairness
    objective with no floor under it does not produce a gentler roster, it produces an
    absurd one.
    """

    monthly_maximum_shifts: dict[str, int] = field(default_factory=dict)
    """H-12 [CONFIRMED]. Per-doctor monthly ceilings, by code. Absent means no ceiling.

    ⚠️ DELIBERATELY NOT HARD, on the principal's own instruction: "these numbers shouldn't
    be treated as hard constraints, because if the practice is low on doctors for a month
    then some of the doctors will need to work more." That is the clearest statement of
    "warn and scar, never block" anyone has given about this product, and it arrived
    unprompted. A system that refuses to exceed a ceiling in the month three doctors are
    away is a system he stops using in the month he needs it most.

    Counts every shift, weekday and weekend alike - he was explicit that the maxima
    "include week shifts".
    """

    holiday_ledger: dict[str, tuple[float, float]] = field(default_factory=dict)
    """S-08. ``doctor -> (holiday burden carried, holiday entitlement)``, over TWELVE months.

    ⚠️ A DIFFERENT SPAN from burden_ledger's three, and that is the point rather than an
    inconsistency. The principal asked for public holidays to be shared "throughout the
    year". South Africa has twelve statutory holidays, so this practice sees about
    forty-four holiday slots a year; three months of them is roughly eleven, spread over
    thirteen doctors, which is not enough to be fair with.

    ⚠️ WHAT THIS PROTECTS IS ALREADY WORKING. Measured over 2024-2025, the four anchor
    doctors take 12-18% of all shifts but only 6-11% of public holidays, while the pool
    doctors take 2-5% of shifts and 5-9% of holidays - the practice deliberately runs
    holidays the OTHER WAY round, and the top four rotates year to year. S-08 exists to
    stop the solver undoing that, not to correct it.

    And the solver does undo it. Asked for December 2026 without S-08 it gave three of nine
    holiday slots to one doctor who historically takes a tenth of them. The mechanism is
    H-10: a pool GP's own practice is closed on a public holiday, so on a holiday everyone
    is available and nothing in the objective prefers anyone. S-01 cannot see the
    difference because it optimises TOTAL burden and has no opinion about its composition.

    Empty means no holiday history, and S-08 sits out rather than inventing a baseline.
    """

    membership: dict[str, tuple[dt.date | None, dt.date | None]] = field(default_factory=dict)
    """H-03 [CONFIRMED]. ``doctor -> (available_from, available_until)``, either end open.

    Doctors join and leave, and this practice's roster records twenty-one such changes in
    thirty-three months - so rostering someone outside their window is not a hypothetical.

    ⚠️ ENFORCED BY NOT CREATING THE VARIABLE, not by a penalty. Assigning a doctor who has
    left is not a violation to weigh against others, it is nonsense - there is no roster in
    which it is the lesser evil. This is the one place a structural bar is right, and it is
    consistent with the catalogue's wording: "THE system SHALL NOT assign".

    It still degrades gracefully, because H-01 coverage is elastic: a day on which nobody is
    a member reports a shortfall rather than making the model infeasible.

    Absent means no restriction, which is what a request that does not carry membership
    should mean. **The wire has always carried `availableFrom`/`availableUntil` and the
    parser has always validated them; until 3 September 2026 it then discarded them and
    H-03 was not enforced at all** - the same failure as the four fields that were
    validated, documented and never sent on 2 September. See docs/DECISIONS.md.
    """

    previous_published: list[AssignmentRef] = field(default_factory=list)
    """S-06 [ASSUMED]. The roster this solve is replacing, if there is one.

    Empty for a first solve, which is the common case and costs nothing. A reference to a
    slot or a doctor this request does not contain is not an error - a doctor can leave
    and a day's shift structure can change between publications - so the model skips
    those and reports the count rather than penalising a move nobody could avoid.
    """

    flags: FeatureFlags = field(default_factory=FeatureFlags)

    def shift_slots(self) -> list[tuple[Day, Shift]]:
        return [(day, shift) for day in self.days for shift in day.shifts]


# ── The September 2026 instance ───────────────────────────────────────────────────────

ALL_DOCTORS: list[str] = [f"D{n:02d}" for n in range(1, 14)]

MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY = range(7)


def september_2026() -> Instance:
    """One real month, built only from [CONFIRMED] facts.

    September 2026 begins on a Tuesday, so the Friday-Sunday weekends are 4-6, 11-13,
    18-20 and 25-27. That is what makes the request diary's first list decodable as
    weekend availability - [INFERRED], and not relied on here.

    The weekday anchor pattern is docs/domain/shift-patterns.md, all [CONFIRMED]:

        Mon   D03 / D05 / D02        (D05 took the afternoon from D04 in Jun 2026)
        Tue   D01 / D05 / D04        (D05 took the afternoon from D03 in Jun 2026)
        Wed   D02 / D01 / pool
        Thu   D04 / D02 / D01        - the most stable day in the entire dataset
        Fri   early+midday rotate D03/D04/D02;  evening+night pool only  (H-06)
        Sat   D01 by default;  never D02        (H-05)
        Sun   anyone, subject to H-04
    """
    year, month = 2026, 9
    _, days_in_month = calendar.monthrange(year, month)

    days: list[Day] = []
    for day_number in range(1, days_in_month + 1):
        date = dt.date(year, month, day_number)
        # No public holidays in September 2026. Heritage Day (24 Sep) fell in 2025.
        pattern = "B" if date.weekday() == FRIDAY else "A"
        days.append(Day(date=date, pattern_id=pattern))

    # D05 joined ~22 June 2026 and took over two specific recurring slots. Neither D03
    # nor D04 left. Modelled as validity intervals, which is the whole point of ADR-0008.
    handover = dt.date(2026, 6, 22)

    recurring = [
        RecurringSlot("D03", MONDAY, "std-morning"),
        RecurringSlot("D04", MONDAY, "std-afternoon", valid_until=handover),
        RecurringSlot("D05", MONDAY, "std-afternoon", valid_from=handover),
        RecurringSlot("D02", MONDAY, "std-night"),
        RecurringSlot("D01", TUESDAY, "std-morning"),
        RecurringSlot("D03", TUESDAY, "std-afternoon", valid_until=handover),
        RecurringSlot("D05", TUESDAY, "std-afternoon", valid_from=handover),
        RecurringSlot("D04", TUESDAY, "std-night"),
        RecurringSlot("D02", WEDNESDAY, "std-morning"),
        RecurringSlot("D01", WEDNESDAY, "std-afternoon"),
        RecurringSlot("D04", THURSDAY, "std-morning"),
        RecurringSlot("D02", THURSDAY, "std-afternoon"),
        RecurringSlot("D01", THURSDAY, "std-night"),
    ]

    return Instance(
        doctors=list(ALL_DOCTORS),
        days=days,
        recurring_slots=recurring,
        # H-05 [CONFIRMED]: D02 is never assigned a Saturday shift.
        unavailable_saturday=frozenset({"D02"}),
        # H-06: a tendency, not a ban. Priced at the PREFERENCE tier - see model.py.
        friday_back_half_excluded=frozenset({"D01", "D02", "D03", "D04"}),
        # H-10 [CONFIRMED]: pool GPs are at their own practices until 17:00 on a
        # weekday. Verified at 98.7% across 1,086 pool shifts in 33 months, and
        # derived from history by lib/analytics/availability.ts, which reproduces
        # this exact split from the assignments alone.
        #
        # D07 and D09 carry a Monday exception: they alternate a Monday 15:00-23:00
        # fortnightly, the only exceptions in the whole dataset. Question X asks
        # whether that is a standing arrangement.
        availability={
            "D06": AvailabilityRule(hour=17),
            "D07": AvailabilityRule(hour=17, except_weekdays=frozenset({MONDAY})),
            "D08": AvailabilityRule(hour=17),
            "D09": AvailabilityRule(hour=17, except_weekdays=frozenset({MONDAY})),
            "D10": AvailabilityRule(hour=17),
            "D11": AvailabilityRule(hour=17),
            "D12": AvailabilityRule(hour=17),
            "D13": AvailabilityRule(hour=17),
        },
        flags=FeatureFlags(),
    )
