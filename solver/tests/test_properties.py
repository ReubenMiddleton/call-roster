"""Property-based tests. The highest-value tests in the project.

One property is worth more than fifty hand-written examples here, because you cannot
imagine the input that breaks a constraint solver and a generator can - and Hypothesis
shrinks the counterexample to a two-doctor, three-day case you can actually read.

A note on the tool
------------------
The plan named ``fast-check``. That is the right choice for the TypeScript side, but the
solver is Python, so its property tests belong in Hypothesis - fast-check's direct
equivalent. Driving the Python solver from a JavaScript test runner to honour the letter
of the plan would add a process boundary to the most valuable test in the suite for no
benefit. Recorded in docs/DECISIONS.md.
"""

from __future__ import annotations

import calendar
import datetime as dt
from dataclasses import replace

from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st

from call_roster_solver.instance import (
    SATURDAY,
    Day,
    FeatureFlags,
    Instance,
    Preference,
    PreferenceType,
    SlotShare,
)
from call_roster_solver.model import FRIDAY_BACK_HALF, build, solve
from call_roster_solver.preflight import preflight

# CP-SAT solves are seconds each, so keep the example count low and the deadline off.
SOLVER_SETTINGS = settings(
    max_examples=12,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)


@st.composite
def instances(draw: st.DrawFn) -> Instance:
    """Generate small, arbitrary but well-formed rostering instances.

    Deliberately small - 2 to 6 doctors, 3 to 10 days - because the interesting failures
    are at the boundaries where availability barely covers demand, not at realistic
    scale. Realistic scale is what the September instance is for.
    """
    doctor_count = draw(st.integers(min_value=2, max_value=6))
    doctors = [f"D{n:02d}" for n in range(1, doctor_count + 1)]

    day_count = draw(st.integers(min_value=3, max_value=10))
    year = draw(st.integers(min_value=2026, max_value=2028))
    month = draw(st.integers(min_value=1, max_value=12))
    _, days_in_month = calendar.monthrange(year, month)
    start_day = draw(st.integers(min_value=1, max_value=max(1, days_in_month - day_count)))

    days: list[Day] = []
    for offset in range(day_count):
        date = dt.date(year, month, start_day + offset)
        # Exercise all three patterns, including Pattern C on arbitrary dates - a day's
        # structure is a property of the DATE, so the generator must be free to override.
        pattern = draw(st.sampled_from(["A", "A", "A", "B", "C"]))
        days.append(Day(date=date, pattern_id=pattern))

    saturday_rule = draw(st.sets(st.sampled_from(doctors), max_size=1))
    friday_excluded = draw(st.sets(st.sampled_from(doctors), max_size=max(1, doctor_count - 2)))

    preferences: list[Preference] = []
    for doctor in doctors:
        if not draw(st.booleans()):
            continue
        chosen = draw(st.sets(st.sampled_from([d.date for d in days]), max_size=3))
        if not chosen:
            continue
        preferences.append(
            Preference(
                doctor=doctor,
                type=draw(st.sampled_from(list(PreferenceType))),
                dates=frozenset(chosen),
                tentative=draw(st.booleans()),
                source_token="NOT",
            )
        )

    # ⚠️ Membership, so H-03 is actually exercised. Added 6 September 2026: H-03 is the ONLY
    # structurally hard constraint in the model, the headline property below claims "every
    # genuinely hard constraint holds", and nothing generated a membership window - so the
    # one constraint that cannot be violated at any price was the one never tested.
    #
    # At most one doctor is given a window, and never the whole roster: starving everybody
    # makes coverage impossible and the instance would be discarded by pre-flight without
    # testing anything.
    membership: dict[str, tuple[dt.date | None, dt.date | None]] = {}
    if doctor_count > 2 and draw(st.booleans()):
        restricted = draw(st.sampled_from(doctors))
        boundary = draw(st.sampled_from([d.date for d in days]))
        # Either a joiner (available from the boundary) or a leaver (until the boundary).
        membership[restricted] = (boundary, None) if draw(st.booleans()) else (None, boundary)

    slot_shares = []
    if draw(st.booleans()):
        shift_ids = sorted({s.shift_id for day in days for s in day.shifts})
        for doctor in doctors:
            if not draw(st.booleans()):
                continue
            slot_shares.append(
                SlotShare(
                    doctor=doctor,
                    weekday=draw(st.sampled_from([d.weekday for d in days])),
                    shift_id=draw(st.sampled_from(shift_ids)),
                    share=draw(st.sampled_from([0.05, 0.25, 0.5, 0.8, 1.0])),
                )
            )

    return Instance(
        doctors=doctors,
        days=days,
        membership=membership,
        monthly_minimum_shifts=draw(st.sampled_from([None, 1, 2])),
        recurring_slots=[],
        # ⚠️ S-09 was listed as a catalogued ID while the generator produced no shares, so
        # the property never once exercised it - the same hole that hid H-03 for weeks.
        # Shares are drawn over the slots the days actually carry, so they are always
        # meaningful rather than silently skipped.
        slot_shares=slot_shares,
        preferences=preferences,
        unavailable_saturday=frozenset(saturday_rule),
        friday_back_half_excluded=frozenset(friday_excluded),
        flags=FeatureFlags(
            h07_d01_never_pattern_b=draw(st.booleans()),
            s05_prefer_anchor_in_slot=draw(st.booleans()),
        ),
    )


@SOLVER_SETTINGS
@given(instances())
def test_feasible_implies_hard_constraints_hold(instance: Instance) -> None:
    """**The single highest-value test in the project.**

    For any generated instance, if the solver returns a solution then every genuinely
    hard constraint holds on the result.

    Note what is and is not asserted. H-01 and H-02 are structural and must always hold.
    H-04, H-05 and H-06 are *elasticised* - they may be violated, but only with a
    corresponding registry entry explaining it. A violation with no explanation is the
    real bug, and it is what this test hunts.
    """
    # Coverage can only be expected where it is arithmetically possible. The generator
    # happily produces instances where demand exceeds supply — 2 doctors over 3 days is
    # 6 doctor-shifts against 9 slots — and those belong to pre-flight, not the solver.
    assume(preflight(instance).feasible)

    built = build(instance)
    result = solve(built, time_budget_seconds=10.0)

    assert result.status in ("OPTIMAL", "TIMED_OUT"), (
        f"solver reported {result.status}; the model must always return a solution"
    )

    # ⚠️ H-03 - the model's ONLY structural bar. A departed doctor on the roster is not the
    # lesser of two evils at any price, so unlike every other constraint here there is no
    # registry entry that could excuse it. Asserted first because it is the only assertion
    # in this test with no elastic escape.
    for assignment in result.assignments:
        window = instance.membership.get(assignment["doctorCode"])
        if window is None:
            continue
        available_from, available_until = window
        date = dt.date.fromisoformat(assignment["date"])
        assert available_from is None or date >= available_from, (
            f"{assignment['doctorCode']} assigned {date}, before joining on {available_from}"
        )
        assert available_until is None or date <= available_until, (
            f"{assignment['doctorCode']} assigned {date}, after leaving on {available_until}"
        )

    # H-01 - exactly one doctor per slot, and every slot covered.
    per_slot: dict[tuple[str, str], list[str]] = {}
    for assignment in result.assignments:
        per_slot.setdefault((assignment["date"], assignment["shiftId"]), []).append(
            assignment["doctorCode"]
        )
    for slot, assigned in per_slot.items():
        assert len(assigned) == 1, f"slot {slot} has {len(assigned)} doctors"
    assert len(per_slot) == len(instance.shift_slots()), "a slot was left uncovered"

    # H-02 - at most one shift per doctor per day. Structurally hard, no slack.
    per_doctor_day: dict[tuple[str, str], int] = {}
    for assignment in result.assignments:
        key = (assignment["doctorCode"], assignment["date"])
        per_doctor_day[key] = per_doctor_day.get(key, 0) + 1
    assert all(count == 1 for count in per_doctor_day.values()), "doctor double-booked in a day"

    pattern_b_dates = {day.date for day in instance.days if day.pattern_id == "B"}

    # Elastic constraints: any violation must be explained by a registry entry.
    explained = {
        (v["constraintId"], v["entityRefs"].get("doctorCode"), v["entityRefs"].get("date"))
        for v in result.violations
    }

    for assignment in result.assignments:
        doctor = assignment["doctorCode"]
        date = dt.date.fromisoformat(assignment["date"])

        if doctor in instance.unavailable_saturday and date.weekday() == SATURDAY:
            assert ("H-05", doctor, assignment["date"]) in explained, (
                f"H-05 violated for {doctor} on {date} with no registry entry"
            )

        if (
            doctor in instance.friday_back_half_excluded
            and assignment["shiftId"] in FRIDAY_BACK_HALF
        ):
            assert ("H-06", doctor, assignment["date"]) in explained, (
                f"H-06 violated for {doctor} on {date} with no registry entry"
            )

        # H-07 is scoped to PATTERN B, not to the weekday - a Friday running Pattern A or C
        # is simply not a Pattern B day and the constraint does not apply. Getting this wrong
        # is the bug the primary source exposed; see docs/domain/worked-examples.md.
        if instance.flags.h07_d01_never_pattern_b and doctor == "D01" and date in pattern_b_dates:
            assert ("H-07", doctor, assignment["date"]) in explained, (
                f"H-07 violated for {doctor} on {date} with no registry entry"
            )


@SOLVER_SETTINGS
@given(instances())
def test_every_violation_names_a_catalogued_constraint(instance: Instance) -> None:
    """No violation may appear without a catalogued ID and a readable message.

    The violations array is what the product shows a non-technical doctor. An entry with
    no ID cannot be traced to docs/domain/constraints.md, and one with a developer-facing
    message is not usable in the UI.
    """
    # H-02 joined this set on 2026-08-31, when it stopped being a hard constraint and became
    # a reportable one. The principal confirmed it "should be absolute but it has happened".
    known = {
        "H-01",
        "H-02",
        "H-04",
        "H-05",
        "H-06",
        "H-07",
        "H-08",
        "H-09",
        "H-10",
        # H-12 added 6 September 2026, when the generator gained monthly_minimum_shifts.
        # The set is every ID the model can emit; a missing one fails here rather than
        # reaching a user as an unexplainable violation.
        "H-12",
        "S-01",
        "S-02",
        "S-03",
        "S-05",
        "S-06",
        "S-08",
        "S-04",
        "S-09",
    }
    built = build(instance)
    result = solve(built, time_budget_seconds=10.0)

    for violation in result.violations:
        assert violation["constraintId"] in known, f"uncatalogued: {violation['constraintId']}"
        assert violation["message"], "violation has no message"
        assert violation["cost"] > 0, "zero-cost violation was reported"
        # Messages go to doctors, not developers.
        assert "slack" not in violation["message"].lower()
        assert "var" not in violation["message"].lower().split()


@SOLVER_SETTINGS
@given(instances())
def test_adding_unavailability_never_improves_the_objective(instance: Instance) -> None:
    """Metamorphic property: constraining an instance further cannot make it cheaper.

    A relation the objective must satisfy regardless of what the optimal roster is - so
    it catches sign errors, mis-scoped slacks and weights that accidentally reward a
    violation, none of which a single-instance assertion would notice.
    """
    baseline_built = build(instance)
    baseline = solve(baseline_built, time_budget_seconds=10.0)

    # ⚠️ dataclasses.replace, NOT a field-by-field rebuild.
    #
    # This was reconstructed by hand and therefore silently dropped every field added after
    # it was written - membership, the H-12 bounds, both ledgers, availability. The
    # "constrained" instance was then a DIFFERENT problem rather than a strictly tighter
    # one, so its objective could legitimately fall and the property looked violated.
    # Caught 6 September 2026 when the generator started producing membership windows.
    #
    # replace() carries everything and changes exactly one thing, which is what a
    # metamorphic test needs by definition.
    constrained = replace(
        instance,
        preferences=[
            *instance.preferences,
            Preference(
                doctor=instance.doctors[0],
                type=PreferenceType.UNAVAILABLE,
                dates=frozenset({instance.days[0].date}),
                source_token="NOT",
            ),
        ],
    )
    tighter = solve(build(constrained), time_budget_seconds=10.0)

    # Only compare when both solves proved optimality; a timed-out incumbent says
    # nothing about the true optimum and would make this assertion flaky.
    if baseline.status == "OPTIMAL" and tighter.status == "OPTIMAL":
        assert tighter.objective >= baseline.objective, (
            "adding an unavailability reduced the objective, which is impossible"
        )


@SOLVER_SETTINGS
@given(instances())
def test_coverage_is_never_traded_for_preferences(instance: Instance) -> None:
    """Coverage shortfall must always be zero while any doctor could cover the slot.

    The tier hierarchy exists to guarantee this. If it ever fails, the weights have been
    tuned wrongly and the emergency centre would be left unstaffed to keep people happy -
    the single worst failure this system could produce.
    """
    assume(preflight(instance).feasible)

    result = solve(build(instance), time_budget_seconds=10.0)
    if result.status in ("OPTIMAL", "TIMED_OUT"):
        assert result.cost_by_tier["coverage"] == 0, (
            "the solver left a slot uncovered despite available doctors"
        )


@SOLVER_SETTINGS
@given(instances())
def test_model_construction_is_deterministic(instance: Instance) -> None:
    """Building the same instance twice yields the same model shape.

    The solver's *output* is not deterministic - CP-SAT varies across versions, worker
    counts and machines. The *model* must be, which is what makes snapshotting it valid
    and snapshotting a roster invalid.
    """
    assert build(instance).canonical_text() == build(instance).canonical_text()
