"""Tests that check documented *inferences* about the domain, not just the code.

This file exists because A5's stated purpose is to discover which constraints are
mis-modelled. A test that fails here is a finding about the practice, not a bug - so each
one records what it is checking and what a failure would mean.
"""

from __future__ import annotations

import datetime as dt

from call_roster_solver.instance import Preference, PreferenceType, september_2026
from call_roster_solver.model import build, solve
from call_roster_solver.preflight import preflight

SUNDAY = 6
MONDAY = 0


def test_sunday_night_exclusions_are_derived_not_listed() -> None:
    """Checks the brief's key `[INFERRED]` claim: model the rule, derive the list.

    The principal originally described avoiding a specific set of five doctors on Sunday
    nights. The brief argues that is not a standing list at all - it is **H-04 expressing
    itself** through whoever happens to hold Monday commitments. A doctor holding Monday
    night cannot also work Sunday night without producing back-to-back nights.

    If this passes, the documented inference is sound and hard-coding five names would be
    wrong - it would break the moment a Monday anchor slot changes hands, which is exactly
    what happened in June 2026.

    If it fails, the inference is wrong and the exclusion list is a genuine separate rule
    that must be asked about.
    """
    instance = september_2026()
    assert preflight(instance)
    result = solve(build(instance), time_budget_seconds=20.0)

    monday_night_anchors = {
        slot.doctor
        for slot in instance.recurring_slots
        if slot.weekday == MONDAY and slot.shift_id == "std-night"
    }
    assert monday_night_anchors, "fixture no longer has a Monday-night anchor"

    assigned = {
        (a["doctorCode"], dt.date.fromisoformat(a["date"]), a["shiftId"])
        for a in result.assignments
    }

    for doctor, date, shift_id in assigned:
        if doctor not in monday_night_anchors:
            continue
        if date.weekday() != SUNDAY or "night" not in shift_id:
            continue
        # They worked a Sunday night. H-04 must then have kept them off Monday night.
        monday = date + dt.timedelta(days=1)
        monday_night = any(
            d == doctor and dd == monday and "night" in sid for d, dd, sid in assigned
        )
        assert not monday_night, (
            f"{doctor} works Sunday {date} night AND Monday {monday} night — H-04 "
            "should have prevented this, so the rule is not being derived correctly"
        )


def test_anchor_pattern_survives_realistic_preference_pressure() -> None:
    """A stress run: does the model still honour the anchor pattern under real pressure?

    The preferences here are **synthetic**, not transcribed from the diary — the diary
    photograph is not on disk (task B2). They reproduce its documented *shape*: a
    weekend-availability list plus a longer `NOT` range per doctor. Their purpose is to
    load the model, not to represent anybody's actual requests.

    What this checks: with a third of the roster declaring unavailability, coverage still
    holds, and the anchor doctors are still mostly in their own slots rather than being
    scattered to satisfy preferences.
    """
    instance = september_2026()

    # Synthetic: several pool doctors away for a long stretch, in the shape of a
    # `NOT 23-30` diary entry.
    late_month = frozenset(day.date for day in instance.days if day.date.day >= 23)
    instance.preferences = [
        Preference(
            doctor=doctor,
            type=PreferenceType.UNAVAILABLE,
            dates=late_month,
            source_token="NOT",
        )
        for doctor in ("D06", "D07", "D08", "D09")
    ]

    assert preflight(instance), "stress instance should still be arithmetically feasible"
    result = solve(build(instance), time_budget_seconds=20.0)

    assert result.status in ("OPTIMAL", "TIMED_OUT")
    assert len(result.assignments) == len(instance.shift_slots()), "coverage was abandoned"
    assert result.cost_by_tier["coverage"] == 0

    # The unavailable doctors must not be assigned in their declared window without an
    # explanation attached.
    unexplained = [
        a
        for a in result.assignments
        if a["doctorCode"] in {"D06", "D07", "D08", "D09"}
        and dt.date.fromisoformat(a["date"]).day >= 23
        and not any(
            v["entityRefs"].get("doctorCode") == a["doctorCode"]
            and v["entityRefs"].get("date") == a["date"]
            for v in result.violations
        )
    ]
    assert not unexplained, f"assigned during declared unavailability, unexplained: {unexplained}"

    # S-05 keeps the anchors in place: the recurring slots that exist this month should be
    # overwhelmingly held by their anchor. Not all of them - H-04 and preferences can
    # legitimately outvote it - but a collapse here would mean S-05's weight is wrong.
    applicable = [
        (slot, day)
        for slot in instance.recurring_slots
        for day in instance.days
        if slot.covers(day) and any(s.shift_id == slot.shift_id for s in day.shifts)
    ]
    held = sum(
        1
        for slot, day in applicable
        if {"doctorCode": slot.doctor, "date": day.date.isoformat(), "shiftId": slot.shift_id}
        in [
            {"doctorCode": a["doctorCode"], "date": a["date"], "shiftId": a["shiftId"]}
            for a in result.assignments
        ]
    )
    assert applicable, "fixture has no applicable recurring slots"
    ratio = held / len(applicable)
    assert ratio >= 0.9, (
        f"anchors hold only {ratio:.0%} of their own recurring slots under pressure; "
        "S-05's weight may be too low relative to the preference tier"
    )


def test_friday_pattern_b_produces_four_slots_not_three() -> None:
    """Fridays use Pattern B. A regression here would silently under-cover every Friday.

    Worth an explicit test because the mistake is invisible in a roster grid printed with
    three rows - the fourth Friday shift simply would not appear.
    """
    instance = september_2026()
    fridays = [day for day in instance.days if day.date.weekday() == 4]

    assert len(fridays) == 4, "September 2026 has four Fridays"
    for friday in fridays:
        assert friday.pattern_id == "B"
        assert len(friday.shifts) == 4

    # 26 non-Friday days x 3 + 4 Fridays x 4
    assert len(instance.shift_slots()) == 26 * 3 + 4 * 4 == 94
