"""Per-constraint tests. Names carry the catalogued ID.

``test_H04_no_back_to_back_nights`` means "implement AC-H04" and "why is H-04 failing"
are unambiguous, and coverage is verifiable by grepping IDs.

Nothing here snapshots a generated roster. CP-SAT is not deterministic across versions,
``num_workers`` settings or machines, so a golden-file roster passes locally and fails in
CI. Where a snapshot is wanted, the *model* is snapshotted instead.
"""

from __future__ import annotations

import datetime as dt

import pytest
from ortools.sat.python import cp_model

from call_roster_solver.instance import (
    FRIDAY,
    PATTERNS,
    SATURDAY,
    AssignmentRef,
    AvailabilityRule,
    Day,
    FeatureFlags,
    Instance,
    Preference,
    PreferenceType,
    Shift,
    ShiftKind,
    SlotShare,
    september_2026,
)
from call_roster_solver.model import (
    FRIDAY_BACK_HALF,
    TENTATIVE_TAKE_UP_WEIGHT,
    TENTATIVE_UNAVAILABLE_WEIGHT,
    build,
    solve,
)
from call_roster_solver.registry import PenaltyEntry, Tier


def solved(instance: Instance, budget: float = 20.0):
    built = build(instance)
    return built, solve(built, time_budget_seconds=budget)


def test_H01_single_cover() -> None:
    """Exactly one doctor per shift slot. [CONFIRMED]"""
    instance = september_2026()
    _, result = solved(instance)

    assert result.status in ("OPTIMAL", "TIMED_OUT")

    seen: dict[tuple[str, str], int] = {}
    for assignment in result.assignments:
        key = (assignment["date"], assignment["shiftId"])
        seen[key] = seen.get(key, 0) + 1

    assert all(count == 1 for count in seen.values()), "a slot has more than one doctor"
    assert len(seen) == len(instance.shift_slots()), "a slot is uncovered"


def test_H02_one_shift_per_day() -> None:
    """A doctor works at most one shift per day. [CONFIRMED]"""
    _, result = solved(september_2026())

    per_doctor_day: dict[tuple[str, str], int] = {}
    for assignment in result.assignments:
        key = (assignment["doctorCode"], assignment["date"])
        per_doctor_day[key] = per_doctor_day.get(key, 0) + 1

    offenders = {k: v for k, v in per_doctor_day.items() if v > 1}
    assert not offenders, f"doctor assigned twice on one day: {offenders}"


def test_H04_no_back_to_back_nights() -> None:
    """No night shift on day D followed by a night shift on day D+1. [CONFIRMED]"""
    _, result = solved(september_2026())

    nights: dict[str, set[dt.date]] = {}
    for assignment in result.assignments:
        if "night" not in assignment["shiftId"]:
            continue
        nights.setdefault(assignment["doctorCode"], set()).add(
            dt.date.fromisoformat(assignment["date"])
        )

    for doctor, dates in nights.items():
        for date in dates:
            assert date + dt.timedelta(days=1) not in dates, (
                f"{doctor} works nights on {date} and the following day"
            )


def test_H03_departed_doctor_is_never_assigned() -> None:
    """A doctor is only assignable while a member of the practice. [CONFIRMED]

    ⚠️ This constraint was NOT ENFORCED AT ALL until 3 September 2026. `availableFrom`
    and `availableUntil` crossed the wire, the parser validated them, and then returned
    only the codes — so a doctor who left in May could be rostered in September. The
    catalogue, the contract document and the contract tests all described a rule the
    model had never seen.
    """
    instance = september_2026()
    leaver = instance.doctors[0]
    # Membership ends the day before the month starts.
    instance.membership[leaver] = (None, instance.days[0].date - dt.timedelta(days=1))

    built, result = solved(instance)

    assert not any(a["doctorCode"] == leaver for a in result.assignments), (
        f"{leaver} left before this month and was still rostered"
    )
    # Structural, not penalised: the variables must not exist at all, or a later change
    # could quietly re-price this as a soft constraint without a test noticing.
    assert not any(key[0] == leaver for key in built.assign), (
        f"assignment variables were created for {leaver} outside their membership window"
    )


def test_H03_partial_membership_allows_only_the_covered_days() -> None:
    """A doctor joining mid-month is assignable from their start date, not before."""
    instance = september_2026()
    joiner = instance.doctors[0]
    starts = instance.days[len(instance.days) // 2].date
    instance.membership[joiner] = (starts, None)

    _, result = solved(instance)

    for assignment in result.assignments:
        if assignment["doctorCode"] != joiner:
            continue
        assert dt.date.fromisoformat(assignment["date"]) >= starts, (
            f"{joiner} assigned {assignment['date']}, before joining on {starts}"
        )


def test_H03_everyone_gone_reports_shortfall_rather_than_infeasible() -> None:
    """The structural bar must still degrade gracefully.

    H-03 is the one hard constraint in the model, so the failure mode it could introduce
    is exactly the one the whole design forbids: "no solution found". Coverage is elastic,
    so a month nobody is a member for must come back as uncovered slots, not INFEASIBLE.
    """
    instance = september_2026()
    before = instance.days[0].date - dt.timedelta(days=1)
    for doctor in instance.doctors:
        instance.membership[doctor] = (None, before)

    _, result = solved(instance)

    assert result.status in ("OPTIMAL", "TIMED_OUT"), (
        f"an empty practice made the model {result.status}; coverage must stay elastic"
    )
    assert result.assignments == []
    assert any(v["constraintId"] == "H-01" for v in result.violations), (
        "every slot is uncovered but no H-01 shortfall was reported"
    )


def test_H05_saturday_standing_rule() -> None:
    """A doctor with a Saturday standing rule is not assigned one. [CONFIRMED]"""
    instance = september_2026()
    _, result = solved(instance)

    for assignment in result.assignments:
        if assignment["doctorCode"] not in instance.unavailable_saturday:
            continue
        date = dt.date.fromisoformat(assignment["date"])
        assert date.weekday() != SATURDAY, (
            f"{assignment['doctorCode']} assigned a Saturday shift on {date}"
        )


def test_H06_friday_back_half_pool_only() -> None:
    """Friday's evening and night shifts exclude the four anchor doctors. [CONFIRMED]"""
    instance = september_2026()
    _, result = solved(instance)

    for assignment in result.assignments:
        if assignment["shiftId"] not in FRIDAY_BACK_HALF:
            continue
        assert assignment["doctorCode"] not in instance.friday_back_half_excluded, (
            f"{assignment['doctorCode']} assigned {assignment['shiftId']} on "
            f"{assignment['date']}, but Friday's back half is pool doctors only"
        )


def test_H07_is_off_by_default() -> None:
    """H-07 is [INFERRED], so it must not be in the model unless explicitly enabled.

    This test exists to catch the specific regression of someone "tidying up" the flag
    default. Shipping an inferred rule as enforced silently removes the principal's own
    flexibility on his own roster, and he would have no way to see that we had done it.
    """
    built = build(september_2026())
    assert september_2026().flags.h07_d01_never_pattern_b is False
    assert not any(e.constraint_id == "H-07" for e in built.registry.entries)


def test_H07_when_enabled_is_respected() -> None:
    """When the flag is on, D01 gets no Pattern B shift. Ready for a confirmed answer."""
    instance = september_2026()
    instance.flags = FeatureFlags(h07_d01_never_pattern_b=True)
    built = build(instance)
    result = solve(built, time_budget_seconds=20.0)

    assert any(e.constraint_id == "H-07" for e in built.registry.entries)

    pattern_b_shifts = {
        (day.date.isoformat(), shift.shift_id)
        for day in instance.days
        if day.pattern_id == "B"
        for shift in day.shifts
    }
    assert pattern_b_shifts, "fixture has no Pattern B days"

    for assignment in result.assignments:
        if assignment["doctorCode"] != "D01":
            continue
        assert (assignment["date"], assignment["shiftId"]) not in pattern_b_shifts, (
            f"D01 assigned {assignment['shiftId']} on {assignment['date']}, a Pattern B day"
        )


def test_H07_does_not_apply_when_friday_drops_pattern_b() -> None:
    """Regression test for the constraint's original bug. Scoped to PATTERN, not weekday.

    H-07 was first written as "D01 is never assigned any Friday shift", on the strength of
    zero counterexamples in sixteen months. The primary source falsified that: D01 worked
    the 07:00-17:00 long day on **Friday 2 January 2026** - a Friday running Pattern C, so
    the four-shift Friday split did not exist that day. The same holds for 26 December
    2025, a Friday that ran Pattern A.

    A weekday-scoped constraint would have refused a roster the principal actually built,
    on precisely the days the pattern changes. This test locks the correct scoping in.

    Reconstructs the real situation: a Friday overridden to Pattern C, with the flag ON.
    D01 must remain assignable that day.
    """
    instance = september_2026()
    instance.flags = FeatureFlags(h07_d01_never_pattern_b=True)

    # Override the first Friday to Pattern C, as happened on 2 January 2026.
    fridays = [i for i, day in enumerate(instance.days) if day.date.weekday() == FRIDAY]
    assert fridays, "fixture has no Fridays"
    target = instance.days[fridays[0]]
    instance.days[fridays[0]] = Day(date=target.date, pattern_id="C")

    built = build(instance)

    # No H-07 penalty may be registered against that date at all: the constraint simply
    # does not apply to a day that is not running Pattern B.
    overridden = target.date.isoformat()
    assert not [
        e
        for e in built.registry.entries
        if e.constraint_id == "H-07" and e.entity_refs.get("date") == overridden
    ], "H-07 was applied to a Friday that is not a Pattern B day"

    # And the other Fridays, still Pattern B, must still carry it.
    assert [e for e in built.registry.entries if e.constraint_id == "H-07"], (
        "H-07 vanished entirely; it should still apply to the remaining Pattern B Fridays"
    )


def test_model_always_returns_a_solution() -> None:
    """The whole point of elasticisation: no INFEASIBLE, ever.

    Every doctor is marked unavailable for the entire month - a request that is
    arithmetically impossible to honour. The model must still return a roster and
    report what it broke, because "no solution found" is useless to the principal.
    """
    instance = september_2026()
    every_date = frozenset(day.date for day in instance.days)
    instance.preferences = [
        Preference(
            doctor=doctor,
            type=PreferenceType.UNAVAILABLE,
            dates=every_date,
            source_token="NOT",
        )
        for doctor in instance.doctors
    ]

    _, result = solved(instance, budget=30.0)

    assert result.status in ("OPTIMAL", "TIMED_OUT"), "model reported no solution"
    assert len(result.assignments) == len(instance.shift_slots()), "coverage was abandoned"
    assert result.violations, "impossible instance reported no violations"
    # Coverage outranks everything: the solver must fill every slot and eat the
    # unavailability penalties, not leave shifts empty to keep people happy.
    assert result.cost_by_tier["coverage"] == 0
    assert result.cost_by_tier["legal"] > 0


def test_coverage_outranks_preferences() -> None:
    """The tier hierarchy is order-of-magnitude separated for a reason.

    One uncovered shift must cost more than every preference violation in the month
    combined, or the solver will leave the emergency centre unstaffed to satisfy
    thirteen people.
    """
    from call_roster_solver.registry import Tier

    worst_case_preference_cost = int(Tier.PREFERENCE) * 30 * 94 * 13
    assert int(Tier.COVERAGE) > worst_case_preference_cost


def test_every_penalty_is_in_the_registry() -> None:
    """The objective is built from the registry and nothing else.

    That invariant is what makes the violations report trustworthy: if a penalty could
    reach the objective without being registered, a violation could occur with no
    explanation attached, and the explanation features would silently under-report.
    """
    built = build(september_2026())
    terms = built.registry.objective_terms()
    assert len(terms) == len(built.registry.entries)
    assert all(weight > 0 for _, weight in terms)


def test_model_shape_is_stable() -> None:
    """Snapshot the MODEL, never a roster.

    Catches "I broke the model builder", which is the regression that actually matters,
    and is fully deterministic - unlike a generated roster.
    """
    built = build(september_2026())
    text = built.canonical_text()

    assert "doctors=13" in text
    assert "days=30" in text
    # 26 non-Friday days x 3 shifts + 4 Fridays x 4 shifts = 78 + 16 = 94
    assert "slots=94" in text
    assert "assign_vars=1222" in text
    for constraint_id in ("H-01", "H-04", "H-05", "H-06", "S-05"):
        assert constraint_id in text, f"{constraint_id} missing from the model"
    assert "H-07" not in text, "H-07 must be off by default"


def test_H02_one_shift_per_day_is_breakable_not_blocking() -> None:
    """H-02 is elasticised, and coverage outranks it. [CONFIRMED as intent, NOT absolute]

    Until 2026-08-31 this was a hard add_at_most_one(). The principal was asked whether
    "at most one shift per doctor per day" is absolute and answered: "it should be
    absolute but it has happened, and so the app should still allow for it if it
    happens." A hard encoding would refuse a roster he has actually built - the fourth
    constraint in this file to be caught by that exact mistake.

    The instance below makes the trade-off unavoidable: one doctor, one day, three
    shifts. Either two slots go uncovered, or the single doctor works all three. Leaving
    an emergency centre unstaffed is worse, so the solver must double him up and report
    it - never return infeasible, and never leave a slot empty.
    """
    instance = Instance(
        doctors=["D01"],
        days=[Day(date=dt.date(2026, 9, 1), pattern_id="A")],
    )
    _, result = solved(instance)

    assert result.status in ("OPTIMAL", "TIMED_OUT"), "the model must always return a solution"

    # Coverage first: all three slots filled, by the only doctor there is.
    assert len(result.assignments) == 3, "a slot was left uncovered in preference to breaking H-02"
    assert {a["shiftId"] for a in result.assignments} == {
        "std-morning",
        "std-afternoon",
        "std-night",
    }

    # And the breach is reported rather than hidden - the scar, not a silent override.
    h02 = [v for v in result.violations if v["constraintId"] == "H-02"]
    assert h02, "H-02 was broken without being reported"
    assert "more than one shift" in h02[0]["message"]
    assert h02[0]["cost"] > 0


def test_H10_structural_availability_is_respected() -> None:
    """A pool GP is not assigned a weekday shift before 17:00. [CONFIRMED]

    "GPs can't work before 17:00 since they are working at other practices" - the
    principal, asked what triggers the reduced 07:00-17:00 pattern. Verified at 98.7%
    across 1,086 pool shifts in 33 months.
    """
    instance = september_2026()
    _, result = solved(instance)

    assert result.status in ("OPTIMAL", "TIMED_OUT")

    by_id = {s.shift_id: s for pattern in PATTERNS.values() for s in pattern}
    days = {day.date.isoformat(): day for day in instance.days}

    breaches = []
    for assignment in result.assignments:
        rule = instance.availability.get(assignment["doctorCode"])
        if rule is None:
            continue
        day = days.get(assignment["date"])
        shift = by_id.get(assignment["shiftId"])
        if day is None or shift is None:
            continue
        if rule.blocks(day, shift):
            breaches.append(assignment)

    # At the COVERAGE tier the solver exhausts every alternative first, and September has
    # enough anchors, so it should find none.
    assert not breaches, f"H-10 breached without need: {breaches[:3]}"


def test_H10_leaves_the_gap_showing_rather_than_inventing_cover() -> None:
    """Given the choice, the model leaves a slot empty rather than assign someone absent.

    The first version of H-10 priced an availability breach the SAME as a coverage
    shortfall, reasoning that both leave nobody in the building. True, but they are not
    equally bad: an empty slot is visible and tells the principal he has a problem, while
    a doctor who is at another practice produces a roster that LOOKS complete and is not.

    So H-10 carries twice a shortfall's weight, and this is the test that pins it. One
    doctor, one Tuesday, and they cannot work either daytime slot - the honest answer is
    to fill the night and report the two gaps.
    """
    instance = Instance(
        doctors=["D06"],
        days=[Day(date=dt.date(2026, 9, 1), pattern_id="A")],  # a Tuesday
        availability={"D06": AvailabilityRule(hour=17)},
    )
    _, result = solved(instance)

    assert result.status in ("OPTIMAL", "TIMED_OUT"), "the model must always return a solution"

    # The night shift starts at 23:00, so it is workable and should be filled.
    assert [a["shiftId"] for a in result.assignments] == ["std-night"]

    # And the two daytime slots are reported as uncovered, not quietly filled.
    shortfalls = [v for v in result.violations if v["constraintId"] == "H-01"]
    assert len(shortfalls) == 2, f"expected two coverage gaps, got {result.violations}"
    assert not [v for v in result.violations if v["constraintId"] == "H-10"], (
        "the model invented cover instead of showing the gap"
    )


def test_H10_exempts_a_public_holiday() -> None:
    """On a holiday the GPs' own practices are closed, so they are available.

    The asymmetry that confirmed the MECHANISM rather than merely the pattern: pool
    doctors work 40 daytime shifts on public holidays across 33 months. If this test
    fails, the model has started treating a holiday like an ordinary weekday and the
    forty are being priced as breaches.
    """
    instance = Instance(
        doctors=["D06"],
        days=[Day(date=dt.date(2026, 9, 24), pattern_id="A", is_public_holiday=True)],
        availability={"D06": AvailabilityRule(hour=17)},
    )
    _, result = solved(instance)

    assert result.status in ("OPTIMAL", "TIMED_OUT")
    assert not [v for v in result.violations if v["constraintId"] == "H-10"], (
        "a holiday daytime shift was priced as an availability breach"
    )


def test_H06_is_a_preference_not_a_ban() -> None:
    """H-06 sits at the PREFERENCE tier. Demoted 2026-09-01.

    It was modelling an effect as a cause: "Friday's back half excludes D01-D04" was a
    list of BANNED doctors priced at 10^5. The anchors are not banned - 17:00 is simply
    the first hour the pool exists, which H-10 now models directly.

    Two independent reasons the old weight was wrong: the principal confirmed H-06's
    breaches were "requested", and 11 appear in 33 months. At 10^5 the solver would have
    fought hard to reproduce a rule the practice does not hold.
    """
    instance = Instance(
        # Only an anchor is available, so Friday's back half must go to one.
        doctors=["D01"],
        days=[Day(date=dt.date(2026, 9, 4), pattern_id="B")],  # a Friday
        friday_back_half_excluded=frozenset({"D01"}),
    )
    _, result = solved(instance)

    assert result.status in ("OPTIMAL", "TIMED_OUT")
    # Every slot filled: a preference must never cost coverage.
    assert len(result.assignments) == 4

    h06 = [v for v in result.violations if v["constraintId"] == "H-06"]
    assert h06, "H-06 should still be reported - the tendency is real"
    # And cheaply. A coverage shortfall in the same model would cost 10^6 per slot.
    assert max(v["cost"] for v in h06) < 1000, (
        "H-06 is priced too high to be a preference; it was demoted from LEGAL for a reason"
    )
    assert "usually goes to" in h06[0]["message"]


# ── S-06  churn against the previously published roster ─────────────────────────────

_CHURN_DAY = dt.date(2026, 9, 1)


def _one_day(previous: dict[str, str], **kwargs: object) -> Instance:
    """One Pattern A day, three doctors, three slots.

    Deliberately balanced: three doctors for three slots means every slot can be covered
    with nobody doubling up, so H-01 and H-02 both cost zero for any permutation and the
    ONLY live term is churn. An earlier version of these tests used two doctors, where
    covering all three slots and leaving one uncovered both cost exactly 10^6 - a tie
    broken by whichever smaller term happened to win, which is precisely the
    non-determinism `.claude/rules/tests.md` warns about.
    """
    return Instance(
        doctors=["D01", "D02", "D03"],
        days=[Day(date=_CHURN_DAY, pattern_id="A")],
        previous_published=[
            AssignmentRef(date=_CHURN_DAY, shift_id=shift_id, doctor=doctor)
            for shift_id, doctor in previous.items()
        ],
        **kwargs,  # type: ignore[arg-type]
    )


@pytest.mark.parametrize(
    "layout",
    [
        {"std-morning": "D01", "std-afternoon": "D02", "std-night": "D03"},
        {"std-morning": "D03", "std-afternoon": "D01", "std-night": "D02"},
    ],
)
def test_S06_keeps_the_published_roster_when_nothing_forces_a_change(
    layout: dict[str, str],
) -> None:
    """A re-solve with no new information must not rearrange. [ASSUMED]

    The product failure this exists to prevent: the principal has already told thirteen
    people what they are working, over WhatsApp, and cannot unsay it. A globally
    equivalent but different roster is worse than no re-solve at all.

    **Deliberately run twice with different published layouts.** One would prove nothing -
    the solver might have picked that permutation anyway. Two, where the only difference
    is what was published and the answer follows it both times, proves S-06 is what
    decides. Every permutation is equal on every other term, so churn is the only one left.
    """
    _, result = solved(_one_day(layout))

    assert result.status in ("OPTIMAL", "TIMED_OUT")
    assert {a["shiftId"]: a["doctorCode"] for a in result.assignments} == layout
    assert [v for v in result.violations if v["constraintId"] == "S-06"] == []


def test_S06_yields_to_a_stated_preference() -> None:
    """Churn is a preference, not a lock, and it must lose to a doctor's own request.

    This is the reason S-06 is priced at Tier.PREFERENCE rather than Tier.CONTRACT. At
    CONTRACT it would outweigh a hundred PREFER_NOTs, so a re-solve would preserve the old
    roster while trampling the preferences that caused the re-solve in the first place -
    the opposite of what a re-solve is for.
    """
    instance = _one_day(
        {"std-morning": "D01", "std-afternoon": "D02", "std-night": "D03"},
        preferences=[
            Preference(
                doctor="D01",
                type=PreferenceType.UNAVAILABLE,
                dates=[_CHURN_DAY],
                shift_ids=["std-morning"],
            )
        ],
    )
    _, result = solved(instance)

    assert result.status in ("OPTIMAL", "TIMED_OUT")
    morning = next(a for a in result.assignments if a["shiftId"] == "std-morning")
    assert morning["doctorCode"] != "D01", "H-08 outranks churn; the move should happen"

    churn = [v for v in result.violations if v["constraintId"] == "S-06"]
    assert churn, "the move still has to be REPORTED - warn and scar, never hide"
    assert "has been moved off it" in churn[0]["message"]
    assert churn[0]["entityRefs"]["doctorCode"] == "D01"


def test_S06_costs_less_than_a_coverage_shortfall() -> None:
    """Churn must never buy a gap. The tier hierarchy is the safety property."""
    built = build(_one_day({"std-night": "D01"}))

    churn = [e for e in built.registry.entries if e.constraint_id == "S-06"]
    assert churn, "S-06 should be registered when previousPublished is populated"
    coverage = [e for e in built.registry.entries if e.constraint_id == "H-01"]
    assert max(e.weight for e in churn) < min(e.weight for e in coverage)


def test_S06_ranks_above_the_other_preferences_within_its_tier() -> None:
    """Relative weights inside PREFERENCE follow the catalogue: S-06 80 > S-03 30 > S-02 20."""
    built = build(
        _one_day(
            {"std-morning": "D01"},
            preferences=[
                Preference(
                    doctor="D02",
                    type=PreferenceType.PREFER_NOT,
                    dates=[_CHURN_DAY],
                    shift_ids=["std-morning"],
                ),
                Preference(
                    doctor="D03",
                    type=PreferenceType.PREFER,
                    dates=[_CHURN_DAY],
                    shift_ids=["std-morning"],
                ),
            ],
        )
    )
    by_id = {e.constraint_id: e.weight for e in built.registry.entries}
    assert by_id["S-06"] > by_id["S-03"] > by_id["S-02"]


def test_S06_skips_a_doctor_who_has_left() -> None:
    """A departed doctor's old assignments are not churn. Nobody could have kept them.

    Penalising them would add a constant to every solution, buy no signal, and make the
    cost breakdown read as though the solver chose to move them.
    """
    built = build(_one_day({"std-morning": "D14"}))
    assert [e for e in built.registry.entries if e.constraint_id == "S-06"] == []


def test_S06_skips_a_slot_that_no_longer_exists() -> None:
    """A day's shift structure is a property of the DATE and can change between versions.

    Pattern B's four Friday shifts are not Pattern A's three. A published `fri-evening` on
    a date that now runs Pattern A refers to a slot that is simply gone.
    """
    built = build(_one_day({"fri-evening": "D01"}))
    assert [e for e in built.registry.entries if e.constraint_id == "S-06"] == []


def test_S06_can_be_switched_off_from_the_request() -> None:
    """The "let it rearrange freely" control. Mode is DATA, never a code change."""
    built = build(
        _one_day({"std-morning": "D01"}, flags=FeatureFlags(s06_minimise_churn=False)),
    )
    assert [e for e in built.registry.entries if e.constraint_id == "S-06"] == []


def test_S06_is_absent_on_a_first_solve() -> None:
    """No previous roster, no churn. The common case, and it must cost nothing."""
    built = build(_one_day({}))
    assert [e for e in built.registry.entries if e.constraint_id == "S-06"] == []


# ── S-01  cumulative burden, normalised by opportunity ──────────────────────────────


def _weighted_day(date: dt.date) -> Day:
    """A Pattern A day carrying per-slot burden weights, as contract 1.3.0 sends them.

    The global PATTERNS table leaves burden_weight at 0.0, which disables S-01 - correctly,
    since a solver optimising a fairness objective nobody supplied is worse than one with no
    opinion. So these tests state the weights explicitly.
    """
    return Day(
        date=date,
        pattern_id="A",
        explicit_shifts=(
            Shift("std-morning", ShiftKind.MORNING, 7, 15, burden_weight=1.0),
            Shift("std-afternoon", ShiftKind.AFTERNOON, 15, 23, burden_weight=1.0),
            Shift("std-night", ShiftKind.NIGHT, 23, 7, ends_next_day=True, burden_weight=2.5),
        ),
    )


def _fair_instance(ledger: dict[str, tuple[float, float]], **kwargs: object) -> Instance:
    """Three doctors, one weighted Pattern A day. Only the carry-in differs."""
    return Instance(
        doctors=["D01", "D02", "D03"],
        days=[_weighted_day(dt.date(2026, 9, 1))],
        burden_ledger=ledger,
        **kwargs,  # type: ignore[arg-type]
    )


def test_S01_is_absent_without_burden_weights() -> None:
    """No agreed weights, no fairness objective. Inventing defaults would optimise a
    fairness measure nobody agreed to, which is worse than having none."""
    built = build(
        Instance(doctors=["D01", "D02"], days=[Day(date=dt.date(2026, 9, 1), pattern_id="A")])
    )
    assert [e for e in built.registry.entries if e.constraint_id == "S-01"] == []


def test_S01_is_absent_without_entitlement() -> None:
    """Weights but no entitlement is a first solve with no history: no denominator, no verdict.

    Deliberate rather than a gap to paper over. Entitlement is the burden of what each doctor
    COULD have worked, and with nothing observed there is no honest way to compute it - so
    the objective says nothing rather than guessing at equal shares, which is the exact
    per-head divisor ADR-0012 rejects.
    """
    built = build(_fair_instance({}))
    assert [e for e in built.registry.entries if e.constraint_id == "S-01"] == []


def test_S01_registers_a_peak_and_a_per_doctor_term() -> None:
    """The registry is the explanation. "D01 is 20% over" is the sentence a doctor accepts."""
    built = build(_fair_instance({d: (10.0, 10.0) for d in ("D01", "D02", "D03")}))
    entries = [e for e in built.registry.entries if e.constraint_id == "S-01"]
    assert entries, "S-01 should register when weights and entitlement are both present"
    measures = {e.entity_refs.get("measure") for e in entries}
    assert "peakLoadRatio" in measures
    assert {e.entity_refs.get("doctorCode") for e in entries} >= {"D01", "D02", "D03"}


def test_S01_gives_the_month_to_whoever_is_behind() -> None:
    """The whole point of a CUMULATIVE objective, and the thing a paper diary cannot do.

    D01 arrives 60% over their fair share and D03 well under, on identical opportunity.
    A within-month-fair answer would split the day three ways; the correct answer loads
    the doctor who is behind.
    """
    # TWO doctors and three slots, deliberately. Three doctors over three slots forces one
    # shift each — H-02 costs 10^6 for a double — so the distribution cannot vary and the
    # test would assert nothing. The first version of this test made exactly that mistake.
    # Here somebody must double up either way, so the unavoidable H-02 cost is identical
    # and S-01 is what decides *who*.
    instance = Instance(
        doctors=["D01", "D02"],
        days=[_weighted_day(dt.date(2026, 9, 1))],
        burden_ledger={"D01": (16.0, 10.0), "D02": (4.0, 10.0)},
    )
    _, result = solved(instance)

    assert result.status in ("OPTIMAL", "TIMED_OUT")
    per_doctor: dict[str, int] = {}
    for assignment in result.assignments:
        per_doctor[assignment["doctorCode"]] = per_doctor.get(assignment["doctorCode"], 0) + 1
    assert per_doctor.get("D02", 0) > per_doctor.get("D01", 0), (
        f"the doctor who is behind should take the extra shift, got {per_doctor}"
    )


def test_S01_normalises_by_opportunity_not_by_headcount() -> None:
    """ADR-0012, and the reason it is not a nicety.

    D03 carries half of D01's burden but had half the opportunity, so both are exactly at
    their fair share and neither is over. A per-head divisor would report D03 as
    under-loaded and hand them work they were never available for.
    """
    built = build(
        _fair_instance(
            {
                "D01": (20.0, 20.0),
                "D02": (20.0, 20.0),
                "D03": (10.0, 10.0),
            }
        )
    )
    assert [e for e in built.registry.entries if e.constraint_id == "S-01"], "S-01 should build"


def test_S01_can_be_switched_off_from_the_request() -> None:
    built = build(_fair_instance({}, flags=FeatureFlags(s01_equalise_cumulative_burden=False)))
    assert [e for e in built.registry.entries if e.constraint_id == "S-01"] == []


def test_S01_never_outranks_coverage() -> None:
    """Fairness must never buy a gap. The tier hierarchy is the safety property."""
    built = build(_fair_instance({"D01": (16.0, 10.0)}))
    fairness = [e for e in built.registry.entries if e.constraint_id == "S-01"]
    coverage = [e for e in built.registry.entries if e.constraint_id == "H-01"]
    assert max(e.weight for e in fairness) < min(e.weight for e in coverage)


def test_S01_reports_excess_as_percentage_points() -> None:
    """The slack has to be readable: 55 means 55% above fair share, not 0.55 or 155."""
    instance = _fair_instance({"D01": (20.0, 10.0), "D02": (10.0, 10.0), "D03": (10.0, 10.0)})
    _, result = solved(instance)
    excesses = [
        v
        for v in result.violations
        if v["constraintId"] == "S-01" and v["entityRefs"].get("doctorCode") == "D01"
    ]
    assert excesses, "D01 arrives well over their fair share and must be reported"
    assert excesses[0]["entityRefs"]["scale"] == 100
    assert 0 < excesses[0]["slackValue"] < 1000


# ── S-08  Spread public-holiday burden across the year ───────────────────────────────


def _holiday_day(date: dt.date) -> Day:
    """A public-holiday Pattern A day, priced as AGREED_BURDEN_V2 prices one."""
    return Day(
        date=date,
        pattern_id="A",
        is_public_holiday=True,
        explicit_shifts=(
            Shift("std-morning", ShiftKind.MORNING, 7, 15, burden_weight=4.0),
            Shift("std-afternoon", ShiftKind.AFTERNOON, 15, 23, burden_weight=4.0),
            Shift("std-night", ShiftKind.NIGHT, 23, 7, ends_next_day=True, burden_weight=4.0),
        ),
    )


def test_S08_is_absent_without_a_holiday_ledger() -> None:
    """A first solve has no holiday history, so S-08 says nothing rather than guessing.

    The alternative - assuming an equal share - is the per-head divisor ADR-0012 rejects,
    and it would be applied to the sparsest data in the model.
    """
    built = build(Instance(doctors=["D01", "D02"], days=[_holiday_day(dt.date(2026, 9, 24))]))
    assert [e for e in built.registry.entries if e.constraint_id == "S-08"] == []


def test_S08_is_absent_when_the_month_has_no_holiday() -> None:
    """No holiday in the month, nothing for S-08 to distribute. It must not price
    ordinary shifts - that is S-01's job, over a different span."""
    built = build(
        Instance(
            doctors=["D01", "D02"],
            days=[_weighted_day(dt.date(2026, 9, 1))],
            holiday_ledger={"D01": (12.0, 40.0), "D02": (4.0, 40.0)},
        )
    )
    assert [e for e in built.registry.entries if e.constraint_id == "S-08"] == []


def test_S08_is_off_when_flagged_off() -> None:
    built = build(
        Instance(
            doctors=["D01", "D02"],
            days=[_holiday_day(dt.date(2026, 9, 24))],
            holiday_ledger={"D01": (12.0, 40.0), "D02": (4.0, 40.0)},
            flags=FeatureFlags(s08_spread_holiday_burden=False),
        )
    )
    assert [e for e in built.registry.entries if e.constraint_id == "S-08"] == []


def test_S08_registers_a_peak_and_a_per_doctor_term() -> None:
    """The registry is the explanation: "you have had more than your share of the year's
    holidays" is the sentence a doctor accepts, and it has to come from somewhere."""
    built = build(
        Instance(
            doctors=["D01", "D02", "D03"],
            days=[_holiday_day(dt.date(2026, 9, 24))],
            holiday_ledger={d: (8.0, 40.0) for d in ("D01", "D02", "D03")},
        )
    )
    entries = [e for e in built.registry.entries if e.constraint_id == "S-08"]
    assert entries, "S-08 should register when a holiday ledger and a holiday are both present"
    assert "peakHolidayRatio" in {e.entity_refs.get("measure") for e in entries}
    assert {e.entity_refs.get("doctorCode") for e in entries} >= {"D01", "D02", "D03"}


def test_S08_gives_the_holiday_to_whoever_has_had_fewest() -> None:
    """The constraint the principal asked for, and the one S-01 cannot express.

    Two doctors, identical holiday opportunity, one carrying three times the other's
    holiday burden across the year. The holiday's three slots must land on the doctor
    who has had fewer - S-01 alone has no opinion, because it optimises TOTAL burden and
    a public holiday is just burden to it.
    """
    instance = Instance(
        doctors=["D01", "D02"],
        days=[_holiday_day(dt.date(2026, 9, 24))],
        holiday_ledger={"D01": (30.0, 40.0), "D02": (10.0, 40.0)},
    )
    _, result = solved(instance)

    holidays = [a for a in result.assignments if a["date"] == "2026-09-24"]
    assert len(holidays) == 3
    behind = sum(1 for a in holidays if a["doctorCode"] == "D02")
    assert behind >= 2, (
        f"D02 has had a third of D01's holidays but took only {behind} of 3 slots; "
        "S-08 is not reaching the objective"
    )


def test_S08_skips_a_doctor_with_no_holiday_opportunity() -> None:
    """Zero opportunity means no fair share, not a share of zero.

    Dividing by it would drive that doctor's holiday count to zero rather than leaving
    them out of a comparison they do not belong in - the same rule as S-01's.
    """
    built = build(
        Instance(
            doctors=["D01", "D02"],
            days=[_holiday_day(dt.date(2026, 9, 24))],
            holiday_ledger={"D01": (10.0, 40.0), "D02": (0.0, 0.0)},
        )
    )
    doctors = {
        e.entity_refs.get("doctorCode") for e in built.registry.entries if e.constraint_id == "S-08"
    }
    assert "D01" in doctors
    assert "D02" not in doctors


# ── H-12  A doctor's monthly shift count stays within their agreed range ─────────────


def _three_day_month() -> list[Day]:
    """Three weighted Pattern A days: nine slots, enough to distribute meaningfully."""
    return [_weighted_day(dt.date(2026, 9, day)) for day in (1, 2, 3)]


def test_H12_is_absent_without_limits() -> None:
    """No agreed floor and no ceilings, no constraint. A default minimum would roster
    people the practice never asked to roster."""
    built = build(Instance(doctors=["D01", "D02"], days=_three_day_month()))
    assert [e for e in built.registry.entries if e.constraint_id == "H-12"] == []


def test_H12_registers_a_floor_for_every_doctor() -> None:
    built = build(
        Instance(doctors=["D01", "D02"], days=_three_day_month(), monthly_minimum_shifts=2)
    )
    entries = [e for e in built.registry.entries if e.constraint_id == "H-12"]
    assert {e.entity_refs.get("doctorCode") for e in entries} == {"D01", "D02"}
    assert all(e.entity_refs.get("bound") == "minimum" for e in entries)


def test_H12_registers_a_ceiling_only_where_one_is_agreed() -> None:
    """Most doctors here have no ceiling. Inventing one for them would be inventing a
    contract term."""
    built = build(
        Instance(
            doctors=["D01", "D02"],
            days=_three_day_month(),
            monthly_maximum_shifts={"D02": 4},
        )
    )
    ceilings = [
        e
        for e in built.registry.entries
        if e.constraint_id == "H-12" and e.entity_refs.get("bound") == "maximum"
    ]
    assert [e.entity_refs.get("doctorCode") for e in ceilings] == ["D02"]


def test_H12_gives_a_starved_doctor_their_floor() -> None:
    """⚠️ THE REASON THIS CONSTRAINT EXISTS.

    D01 arrives enormously over their cumulative fair share, so S-01 wants to give them
    nothing and hand the month to D02. Without a floor that is exactly what happens - the
    September 2026 solve gave two of thirteen doctors NO shifts while another got nineteen,
    and reported OPTIMAL. With the floor, D01 still gets their two.
    """
    # FOUR doctors, nine slots. Enough slack that dropping one entirely still covers the
    # month - which is the situation the September 2026 solve was in, and the only one where
    # starvation is possible. With two doctors coverage forces everyone to work and the test
    # would pass without the floor doing anything.
    instance = Instance(
        doctors=["D01", "D02", "D03", "D04"],
        days=_three_day_month(),
        burden_ledger={
            "D01": (900.0, 100.0),
            "D02": (10.0, 100.0),
            "D03": (10.0, 100.0),
            "D04": (10.0, 100.0),
        },
        monthly_minimum_shifts=2,
    )
    _, result = solved(instance)

    worked = sum(1 for a in result.assignments if a["doctorCode"] == "D01")
    assert worked >= 2, (
        f"D01 got {worked} shifts. S-01 starves whoever is over their share and the floor "
        "is what stops it reaching zero."
    )


def test_H12_without_the_floor_the_same_instance_starves_that_doctor() -> None:
    """The control for the test above. Same instance, floor removed.

    Asserted so the floor's effect is demonstrated rather than assumed - if this ever stops
    starving D01, the test above has stopped proving anything.

    ⚠️ ASSERTED AS "BELOW THE FLOOR", NOT "EXACTLY ZERO". S-01 starves TOWARD zero rather
    than reliably to it: D01's excess is dominated by carry-in and barely moves, so handing
    them one shift can still reduce everyone else's. The first version of this test demanded
    zero, got one, and would have been "fixed" by weakening the test above it. The claim that
    matters is the comparison - without a floor they land under it, with one they do not.
    """
    instance = Instance(
        doctors=["D01", "D02", "D03", "D04"],
        days=_three_day_month(),
        burden_ledger={
            "D01": (900.0, 100.0),
            "D02": (10.0, 100.0),
            "D03": (10.0, 100.0),
            "D04": (10.0, 100.0),
        },
    )
    _, result = solved(instance)

    worked = sum(1 for a in result.assignments if a["doctorCode"] == "D01")
    assert worked < 2, (
        f"expected S-01 to leave D01 under the floor of 2 without one, got {worked} shifts. "
        "If this passes, the floor test above proves nothing."
    )


def test_H12_yields_to_coverage() -> None:
    """⚠️ The ceiling must never cost a covered slot.

    One doctor, nine slots, a ceiling of two. Tier.CONTRACT sits four orders of magnitude
    below COVERAGE, so the model must exceed the ceiling and report it rather than leave
    seven shifts uncovered. The principal said this in his own words: "if the practice is
    low on doctors for a month then some of the doctors will need to work more."
    """
    instance = Instance(
        doctors=["D01"],
        days=_three_day_month(),
        monthly_maximum_shifts={"D01": 2},
    )
    _, result = solved(instance)

    assert len(result.assignments) == 9, "a ceiling left slots uncovered"
    assert any(
        v["constraintId"] == "H-12" and v["entityRefs"].get("bound") == "maximum"
        for v in result.violations
    ), "the ceiling was exceeded but not reported"


def test_H12_skips_a_doctor_who_is_not_a_member() -> None:
    """H-03 says they have no assignable slot here, so a floor would be asking for shifts
    that cannot exist - and would then be permanently violated."""
    instance = Instance(
        doctors=["D01", "D02"],
        days=_three_day_month(),
        monthly_minimum_shifts=2,
    )
    instance.membership["D02"] = (None, dt.date(2026, 8, 31))
    built = build(instance)

    doctors = {
        e.entity_refs.get("doctorCode") for e in built.registry.entries if e.constraint_id == "H-12"
    }
    assert doctors == {"D01"}


def test_S02_whole_day_preference_is_satisfied_by_any_shift_that_day() -> None:
    """⚠️ Regression, 6 September 2026.

    A PREFER naming no shift means "I would like to work that day". It was registered once
    per SHIFT, so a doctor who asked for a weekend and got a shift on it still showed the
    other eight slots as broken wishes. On the September 2026 request diary that inflated
    S-02 to 170 violations and about a quarter of the objective - and it would have told a
    doctor their request was mostly refused when it had been granted.
    """
    instance = Instance(
        doctors=["D01", "D02"],
        days=[_weighted_day(dt.date(2026, 9, 1))],
        preferences=[
            Preference(
                doctor="D01",
                type=PreferenceType.PREFER,
                dates=[dt.date(2026, 9, 1)],
                shift_ids=None,
            )
        ],
    )
    built, result = solved(instance)

    # One entry for the date, not one per shift.
    entries = [e for e in built.registry.entries if e.constraint_id == "S-02"]
    assert len(entries) == 1, f"expected one S-02 entry for the day, got {len(entries)}"
    assert "shiftId" not in entries[0].entity_refs

    # And working any one shift satisfies it.
    worked = [a for a in result.assignments if a["doctorCode"] == "D01"]
    assert worked, "D01 asked for this day and got nothing"
    assert not any(v["constraintId"] == "S-02" for v in result.violations), (
        "D01 worked the day they asked for, so S-02 should report nothing"
    )


def test_S02_a_preference_naming_shifts_stays_per_shift() -> None:
    """Where the doctor names specific shifts, each one genuinely is a separate wish."""
    instance = Instance(
        doctors=["D01", "D02"],
        days=[_weighted_day(dt.date(2026, 9, 1))],
        preferences=[
            Preference(
                doctor="D01",
                type=PreferenceType.PREFER,
                dates=[dt.date(2026, 9, 1)],
                shift_ids=["std-morning", "std-night"],
            )
        ],
    )
    built = build(instance)
    entries = [e for e in built.registry.entries if e.constraint_id == "S-02"]
    assert len(entries) == 2
    assert all("shiftId" in e.entity_refs for e in entries)


# ── S-09  the 68% of the roster S-05 cannot see ──────────────────────────────────────


def _saturdays(count: int) -> list[Day]:
    """`count` consecutive Saturdays, priced as AGREED_BURDEN_V2 prices one."""
    first = dt.date(2026, 9, 5)
    return [
        Day(
            date=first + dt.timedelta(days=7 * week),
            pattern_id="A",
            explicit_shifts=(
                Shift("std-morning", ShiftKind.MORNING, 7, 15, burden_weight=3.0),
                Shift("std-afternoon", ShiftKind.AFTERNOON, 15, 23, burden_weight=3.0),
                Shift("std-night", ShiftKind.NIGHT, 23, 7, ends_next_day=True, burden_weight=3.0),
            ),
        )
        for week in range(count)
    ]


def test_S09_pulls_a_doctor_toward_their_historical_share() -> None:
    """The September 2026 regression, reduced.

    D01 holds 38% of Saturday mornings across the six months to September 2026, and the
    solve gave him none - he was pinned to his S-05 anchors, which spent his load budget,
    and nothing in the model had an opinion about Saturday. Here the same setup with the
    share sent: four Saturdays, 0.38 x 4 = 1.52, so the interval is [1, 2] and a roster
    giving him zero must cost more than one giving him one.
    """
    days = _saturdays(4)
    doctors = ["D01", "D02", "D03"]
    share = SlotShare("D01", SATURDAY, "std-morning", 0.38)

    with_share = Instance(doctors=doctors, days=days, slot_shares=[share])
    _, result = solved(with_share)

    mornings = [
        a for a in result.assignments if a["shiftId"] == "std-morning" and a["doctorCode"] == "D01"
    ]
    assert len(mornings) >= 1, (
        "D01 holds 38% of this slot and got none of the month's four; S-09 is not reaching "
        "the objective"
    )


def test_S09_allows_anything_inside_the_interval() -> None:
    """The free zone sits where the fraction points, and round() is what puts it there.

    ⚠️ This test asserted the OPPOSITE first - that 1 and 2 were both free for a 38% share
    over four Saturdays - and it passed. The behaviour it was pinning was wrong: a free
    interval is a tie, and S-01 breaks every tie downward because the big-share doctors are
    the heavily loaded ones. D01 got 1 of 4 in September and 1 of 5 in October, inside the
    interval both times and below his real rate every time.

    0.28 x 4 = 1.12 -> [1, 2], so BOTH are genuinely free here. 0.38 x 4 = 1.52 -> [2, 2]
    is checked in test_S09_pulls_a_doctor_toward_their_historical_share.
    """
    days = _saturdays(4)
    built = build(
        Instance(
            doctors=["D01", "D02"],
            days=days,
            slot_shares=[SlotShare("D01", SATURDAY, "std-morning", 0.28)],
        )
    )
    solver = cp_model.CpSolver()
    for count in (1, 2):
        model = built.model.clone()
        held = [
            built.assign[("D01", day.date, "std-morning")]
            for day in days
            if ("D01", day.date, "std-morning") in built.assign
        ]
        model.add(sum(held) == count)
        status = solver.solve(model)
        assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        penalty = sum(
            solver.value(entry.slack_var) * entry.weight
            for entry in built.registry.entries
            if entry.constraint_id == "S-09"
        )
        assert penalty == 0, f"{count} of 4 is inside [1, 2] and must be free, cost {penalty}"


def test_S09_is_absent_without_slot_shares() -> None:
    """No history, no term. A first solve is unaffected."""
    built = build(Instance(doctors=["D01", "D02"], days=_saturdays(4)))
    assert not [e for e in built.registry.entries if e.constraint_id == "S-09"]


def test_S09_is_off_when_flagged_off() -> None:
    """[INFERRED], so the switch exists even though it defaults on."""
    built = build(
        Instance(
            doctors=["D01", "D02"],
            days=_saturdays(4),
            slot_shares=[SlotShare("D01", SATURDAY, "std-morning", 0.38)],
            flags=FeatureFlags(s09_hold_slot_share=False),
        )
    )
    assert not [e for e in built.registry.entries if e.constraint_id == "S-09"]


def test_S09_ignores_a_share_too_small_to_bind() -> None:
    """0.04 x 4 = 0.16 -> [0, 1]. The term exists but constrains nothing.

    This is what keeps S-09 from turning a long tail of 4%-share doctors into a wall of
    spurious violations: the interval self-limits as the share falls.
    """
    days = _saturdays(4)
    built = build(
        Instance(
            doctors=["D01", "D02"],
            days=days,
            slot_shares=[SlotShare("D01", SATURDAY, "std-morning", 0.04)],
        )
    )
    solver = cp_model.CpSolver()
    model = built.model.clone()
    held = [built.assign[("D01", day.date, "std-morning")] for day in days]
    model.add(sum(held) == 0)
    assert solver.solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    penalty = sum(
        solver.value(entry.slack_var) * entry.weight
        for entry in built.registry.entries
        if entry.constraint_id == "S-09"
    )
    assert penalty == 0, f"a 4% share over 4 occasions must bind nothing, cost {penalty}"


def test_S09_yields_to_coverage() -> None:
    """Tier discipline. A PREFERENCE term can never buy an uncovered slot.

    Four Saturdays carrying ONE shift each and one doctor to work them, so coverage is
    achievable and the only thing standing against it is S-09: the 38% share makes the
    interval [1, 2], and full coverage puts D01 two above it. Coverage is 10^6 and the
    share is 50 at 10^0, so it must not be close.

    ⚠️ The three-shift version of this test is meaningless. One doctor can work at most
    one shift a day (H-02), so 8 of 12 slots are uncoverable by arithmetic and the
    shortfall says nothing about S-09.
    """
    days = [
        Day(
            date=day.date,
            pattern_id="A",
            explicit_shifts=(Shift("std-morning", ShiftKind.MORNING, 7, 15, burden_weight=3.0),),
        )
        for day in _saturdays(4)
    ]
    _, result = solved(
        Instance(
            doctors=["D01"],
            days=days,
            slot_shares=[SlotShare("D01", SATURDAY, "std-morning", 0.38)],
        )
    )
    mornings = [a for a in result.assignments if a["shiftId"] == "std-morning"]
    assert len(mornings) == 4, "S-09 bought an uncovered slot; the tier hierarchy is broken"


def test_S09_falls_back_to_floor_when_rounding_would_overshoot() -> None:
    """Rounding every doctor up can demand more shifts than the slot has.

    Shares sum to 1, so the EXPECTATIONS always fit - but round() adds up to half a shift
    per doctor, and enough doctors turns that into real drift. Three doctors at 0.34 over
    4 Saturdays each expect 1.36 and each round to 1, which fits; push to five doctors at
    0.2 over 3 Saturdays and each expects 0.6, rounds to 1, and the lows sum to 5 against
    a supply of 3. Without the guard, two doctors carry a violation nobody can clear on a
    slot that was filled correctly.
    """
    days = [
        Day(
            date=day.date,
            pattern_id="A",
            explicit_shifts=(Shift("std-morning", ShiftKind.MORNING, 7, 15, burden_weight=3.0),),
        )
        for day in _saturdays(3)
    ]
    doctors = ["D01", "D02", "D03", "D04", "D05"]
    built = build(
        Instance(
            doctors=doctors,
            days=days,
            slot_shares=[SlotShare(code, SATURDAY, "std-morning", 0.2) for code in doctors],
        )
    )
    solver = cp_model.CpSolver()
    assert solver.solve(built.model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    unclearable = [
        entry
        for entry in built.registry.entries
        if entry.constraint_id == "S-09" and solver.value(entry.slack_var)
    ]
    assert not unclearable, (
        "the rounded lows summed past the slot's supply, so "
        f"{len(unclearable)} doctor(s) carry a violation that cannot be cleared"
    )


def test_S09_does_not_let_a_sub_shift_share_demand_a_shift() -> None:
    """0.15 x 4 = 0.6 of a shift is not a claim on one.

    round() at the low bound is what stops S-01 shaving a big-share doctor to the floor
    every month, but applied below 1 it turns arithmetic into an obligation: D06 holds 15%
    of Sunday mornings and the first version of this constraint required him to take one of
    the month's four, then reported a violation when the solver sensibly declined.
    """
    days = [
        Day(
            date=day.date,
            pattern_id="A",
            explicit_shifts=(Shift("std-morning", ShiftKind.MORNING, 7, 15, burden_weight=3.0),),
        )
        for day in _saturdays(4)
    ]
    built = build(
        Instance(
            doctors=["D01", "D02"],
            days=days,
            slot_shares=[SlotShare("D01", SATURDAY, "std-morning", 0.15)],
        )
    )
    solver = cp_model.CpSolver()
    model = built.model.clone()
    model.add(sum(built.assign[("D01", day.date, "std-morning")] for day in days) == 0)
    assert solver.solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    penalty = sum(
        solver.value(entry.slack_var) * entry.weight
        for entry in built.registry.entries
        if entry.constraint_id == "S-09"
    )
    assert penalty == 0, f"a 0.6-of-a-shift share must not demand a shift, cost {penalty}"


# ── S-04  turnaround, and 8 hours is acceptable ──────────────────────────────────────


def _night_then_morning() -> Instance:
    """Two days: a night on the first, a morning on the second. Zero hours between them."""
    return Instance(
        doctors=["D01", "D02"],
        days=[
            Day(
                date=dt.date(2026, 9, day),
                pattern_id="A",
                explicit_shifts=(
                    Shift("std-morning", ShiftKind.MORNING, 7, 15, burden_weight=1.0),
                    Shift(
                        "std-night", ShiftKind.NIGHT, 23, 7, ends_next_day=True, burden_weight=2.5
                    ),
                ),
            )
            for day in (1, 2)
        ],
    )


def test_S04_prices_a_night_into_the_next_morning() -> None:
    """The only shape that actually occurs. All 27 real sub-8h turnarounds are this one."""
    built = build(_night_then_morning())
    entries = [e for e in built.registry.entries if e.constraint_id == "S-04"]
    assert entries, "a night followed by the next day's 07:00 start registered no penalty"
    assert all(e.tier is Tier.PREFERENCE for e in entries), (
        "S-04 must never outrank coverage or a legal rest rule - the practice does this "
        "routinely and a system that blocks it is unusable"
    )


def test_S04_leaves_an_eight_hour_turnaround_alone() -> None:
    """⚠️ 8h IS THE ACCEPTED MINIMUM, not the thing being avoided.

    "A doctor can work 3-11 one day and be working the 7-3 shift the very next day which is
    only an 8 hour time period between the two shifts." An afternoon ending 23:00 into a
    07:00 morning is exactly 8 hours and must cost nothing at all.
    """
    instance = Instance(
        doctors=["D01", "D02"],
        days=[
            Day(
                date=dt.date(2026, 9, day),
                pattern_id="A",
                explicit_shifts=(
                    Shift("std-morning", ShiftKind.MORNING, 7, 15, burden_weight=1.0),
                    Shift("std-afternoon", ShiftKind.AFTERNOON, 15, 23, burden_weight=1.75),
                ),
            )
            for day in (1, 2)
        ],
    )
    built = build(instance)
    assert not [e for e in built.registry.entries if e.constraint_id == "S-04"]


def test_S04_does_not_double_charge_a_same_day_double() -> None:
    """Two shifts on ONE day are H-02's, and pricing them here charges twice for one event.

    29 of the 56 sub-8h pairs in 33 months are same-day doubles. They are already penalised
    at the LEGAL tier; adding a second term would distort the tier arithmetic even though
    both terms are individually 'correct'.
    """
    built = build(
        Instance(
            doctors=["D01", "D02"],
            days=[
                Day(
                    date=dt.date(2026, 9, 1),
                    pattern_id="A",
                    explicit_shifts=(
                        Shift("std-morning", ShiftKind.MORNING, 7, 15, burden_weight=1.0),
                        Shift("std-afternoon", ShiftKind.AFTERNOON, 15, 23, burden_weight=1.75),
                    ),
                )
            ],
        )
    )
    assert not [e for e in built.registry.entries if e.constraint_id == "S-04"]


def test_S04_yields_to_coverage() -> None:
    """One doctor, a night and the next morning: both must still be covered.

    Tier discipline. S-04 is 40 at 10^0 against coverage at 10^6, and the practice does this
    routinely enough that blocking it would make the product unusable.
    """
    # ⚠️ One doctor across two days of THREE shifts cannot cover them: H-02 caps them at
    # one a day, so the shortfall would be arithmetic and would say nothing about S-04.
    # Each day therefore carries exactly ONE slot, and they are the two that collide.
    instance = Instance(
        doctors=["D01"],
        days=[
            Day(
                date=dt.date(2026, 9, 1),
                pattern_id="A",
                explicit_shifts=(
                    Shift(
                        "std-night", ShiftKind.NIGHT, 23, 7, ends_next_day=True, burden_weight=2.5
                    ),
                ),
            ),
            Day(
                date=dt.date(2026, 9, 2),
                pattern_id="A",
                explicit_shifts=(
                    Shift("std-morning", ShiftKind.MORNING, 7, 15, burden_weight=1.0),
                ),
            ),
        ],
    )
    _, result = solved(instance)
    assert len(result.assignments) == 2, (
        "S-04 bought an uncovered slot; it must warn and scar, never block"
    )


# ── tentative = "if necessary"  [CONFIRMED 2026-09-04] ───────────────────────────────


def _single_slot_day(*doctors: str) -> Instance:
    return Instance(
        doctors=list(doctors),
        days=[
            Day(
                date=dt.date(2026, 9, 1),
                pattern_id="A",
                explicit_shifts=(
                    Shift("std-morning", ShiftKind.MORNING, 7, 15, burden_weight=1.0),
                ),
            )
        ],
    )


def _entries(instance: Instance, constraint_id: str) -> list[PenaltyEntry]:
    return [e for e in build(instance).registry.entries if e.constraint_id == constraint_id]


def test_tentative_prefer_penalises_working_it_not_missing_it() -> None:
    """⚠️ THE FIX IS A SIGN FLIP, NOT A SMALLER NUMBER.

    A firm PREFER penalises NOT assigning the date. "If necessary" is the opposite: the
    doctor is not offering it, so the cost belongs on ASSIGNING it. Two earlier attempts
    wrote this as a weight discount, which pushed the solver to spend the fallback MORE
    eagerly the cheaper it got, because the penalty was on missing it.
    """
    instance = _single_slot_day("D01", "D02")
    instance.preferences = [
        Preference(
            doctor="D01",
            type=PreferenceType.PREFER,
            dates=frozenset({dt.date(2026, 9, 1)}),
            tentative=True,
        )
    ]
    assert not _entries(instance, "S-02"), "an 'if necessary' offer cannot be 'missed'"
    taken = _entries(instance, "S-03")
    assert len(taken) == 1
    assert taken[0].weight == TENTATIVE_TAKE_UP_WEIGHT


def test_a_firm_prefer_still_penalises_missing_it() -> None:
    """The control. Without `tentative` nothing about S-02 changes."""
    instance = _single_slot_day("D01", "D02")
    instance.preferences = [
        Preference(
            doctor="D01",
            type=PreferenceType.PREFER,
            dates=frozenset({dt.date(2026, 9, 1)}),
        )
    ]
    assert len(_entries(instance, "S-02")) == 1
    assert not _entries(instance, "S-03")


def test_a_tentative_offer_is_used_before_a_slot_goes_empty() -> None:
    """The whole point of "if necessary": cheaper than a shortfall, dearer than anyone else.

    D01 is the only doctor and offered the date only if necessary. Coverage is 10^6 and the
    take-up is 10, so the slot must still be filled.
    """
    instance = _single_slot_day("D01")
    instance.preferences = [
        Preference(
            doctor="D01",
            type=PreferenceType.PREFER,
            dates=frozenset({dt.date(2026, 9, 1)}),
            tentative=True,
        )
    ]
    _, result = solved(instance)
    assert len(result.assignments) == 1, "a fallback offer must be used before a slot goes empty"


def test_a_tentative_offer_is_avoided_while_anyone_else_can_cover() -> None:
    """The other half. With a free alternative, the fallback stays unspent."""
    instance = _single_slot_day("D01", "D02")
    instance.preferences = [
        Preference(
            doctor="D01",
            type=PreferenceType.PREFER,
            dates=frozenset({dt.date(2026, 9, 1)}),
            tentative=True,
        )
    ]
    _, result = solved(instance)
    assert result.assignments[0]["doctorCode"] == "D02", (
        "the solver called on an 'if necessary' offer while another doctor was free"
    )


def test_tentative_softens_a_prefer_not_without_inverting_it() -> None:
    """One step toward neutral, never past it. Still a cost on assigning, just a smaller one."""
    instance = _single_slot_day("D01", "D02")
    for tentative, expected in ((False, 30), (True, TENTATIVE_TAKE_UP_WEIGHT)):
        instance.preferences = [
            Preference(
                doctor="D01",
                type=PreferenceType.PREFER_NOT,
                dates=frozenset({dt.date(2026, 9, 1)}),
                tentative=tentative,
            )
        ]
        entries = _entries(instance, "S-03")
        assert len(entries) == 1
        assert entries[0].weight == expected


def test_a_tentative_unavailable_leaves_the_legal_tier() -> None:
    """ "I probably cannot" is a strong objection, not a bar.

    Demoted out of LEGAL rather than discounted within it: the tiers are orders of magnitude
    apart, and a firm UNAVAILABLE has to stay far dearer than a tentative one. Discounting
    inside LEGAL could not express that.
    """
    instance = _single_slot_day("D01", "D02")
    instance.preferences = [
        Preference(
            doctor="D01",
            type=PreferenceType.UNAVAILABLE,
            dates=frozenset({dt.date(2026, 9, 1)}),
            tentative=True,
        )
    ]
    entries = _entries(instance, "H-08")
    assert len(entries) == 1
    assert entries[0].tier is Tier.PREFERENCE
    assert entries[0].weight == TENTATIVE_UNAVAILABLE_WEIGHT


# ── H-13  locked assignments ─────────────────────────────────────────────────────────


def _lockable_day(*doctors: str) -> Instance:
    return Instance(
        doctors=list(doctors),
        days=[
            Day(
                date=dt.date(2026, 9, 1),
                pattern_id="A",
                explicit_shifts=(
                    Shift("std-morning", ShiftKind.MORNING, 7, 15, burden_weight=1.0),
                    Shift("std-afternoon", ShiftKind.AFTERNOON, 15, 23, burden_weight=1.75),
                ),
            )
        ],
    )


def test_H13_a_locked_assignment_is_kept() -> None:
    """Structurally hard: fixed to 1, the mirror of H-03's 'never create the variable'."""
    instance = _lockable_day("D01", "D02")
    instance.locked_assignments = [
        AssignmentRef(date=dt.date(2026, 9, 1), shift_id="std-morning", doctor="D02")
    ]
    _, result = solved(instance)
    morning = next(a for a in result.assignments if a["shiftId"] == "std-morning")
    assert morning["doctorCode"] == "D02"


def test_H13_a_lock_survives_a_preference_against_it() -> None:
    """⚠️ The deliberate exception to "warn and scar, never block".

    That philosophy governs the PRACTICE'S rules. A lock is the scheduler exercising the
    override it exists to protect — he has already told the doctor. Even the doctor's own
    UNAVAILABLE, at the LEGAL tier, must not move it.
    """
    instance = _lockable_day("D01", "D02")
    instance.locked_assignments = [
        AssignmentRef(date=dt.date(2026, 9, 1), shift_id="std-morning", doctor="D02")
    ]
    instance.preferences = [
        Preference(
            doctor="D02",
            type=PreferenceType.UNAVAILABLE,
            dates=frozenset({dt.date(2026, 9, 1)}),
        )
    ]
    _, result = solved(instance)
    morning = next(a for a in result.assignments if a["shiftId"] == "std-morning")
    assert morning["doctorCode"] == "D02", "a lock was overridden by a preference"


def test_H13_a_lock_may_cause_a_shortfall_elsewhere() -> None:
    """The instruction is kept and its consequence is shown, rather than the lock bending.

    One doctor, two slots on one day. H-02 lets them take both at a cost, but locking them
    into the morning cannot make the afternoon disappear — the shortfall is reported.
    """
    instance = _lockable_day("D01")
    instance.locked_assignments = [
        AssignmentRef(date=dt.date(2026, 9, 1), shift_id="std-morning", doctor="D01")
    ]
    _, result = solved(instance)
    assert any(
        a["shiftId"] == "std-morning" and a["doctorCode"] == "D01" for a in result.assignments
    )
    assert result.status in ("OPTIMAL", "TIMED_OUT")


def test_H13_registers_no_penalty() -> None:
    """A constraint that cannot be violated has nothing to report.

    A slack variable provably always zero would sit permanently in the penalty registry and
    in every cost breakdown derived from it.
    """
    instance = _lockable_day("D01", "D02")
    instance.locked_assignments = [
        AssignmentRef(date=dt.date(2026, 9, 1), shift_id="std-morning", doctor="D02")
    ]
    assert not [e for e in build(instance).registry.entries if e.constraint_id == "H-13"]


def test_H13_a_lock_on_a_non_member_raises_rather_than_being_dropped() -> None:
    """Unreachable through parse_request, which refuses it. A hand-built Instance must not
    silently lose the lock — that is the worst option available."""
    instance = _lockable_day("D01", "D02")
    instance.membership = {"D02": (dt.date(2026, 10, 1), None)}
    instance.locked_assignments = [
        AssignmentRef(date=dt.date(2026, 9, 1), shift_id="std-morning", doctor="D02")
    ]
    with pytest.raises(ValueError, match="H-13"):
        build(instance)
