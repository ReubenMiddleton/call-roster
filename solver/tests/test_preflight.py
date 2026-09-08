"""Pre-flight arithmetic tests.

The first test here is the regression test for a real finding: the property suite
generated a 2-doctor, 3-day instance and the solver correctly reported a coverage
shortfall of three - but "shortfall 3" is a useless answer to give a non-technical admin
when the truth is "you do not have enough doctors."
"""

from __future__ import annotations

import datetime as dt

from call_roster_solver.instance import (
    Day,
    Instance,
    Preference,
    PreferenceType,
    september_2026,
)
from call_roster_solver.preflight import preflight


def test_two_doctors_three_days_is_caught_before_solving() -> None:
    """The counterexample Hypothesis found, kept as a regression test.

    3 days of Pattern A = 9 shift slots. H-02 caps each doctor at one shift per day, so
    2 doctors over 3 days supply at most 6 doctor-shifts. Three slots cannot be filled by
    anybody, and no solver can change that.
    """
    instance = Instance(
        doctors=["D01", "D02"],
        days=[
            Day(date=dt.date(2026, 1, 1), pattern_id="A"),
            Day(date=dt.date(2026, 1, 2), pattern_id="A"),
            Day(date=dt.date(2026, 1, 3), pattern_id="A"),
        ],
    )

    result = preflight(instance)

    assert not result, "pre-flight must reject an arithmetically impossible instance"
    assert result.total_demand == 9
    assert result.total_supply == 6
    assert result.failures

    # The message must name the date and the numbers, because that is what makes it
    # actionable. "Infeasible" is not.
    assert any("01 January 2026" in failure for failure in result.failures)
    assert any("3 shifts need filling" in failure for failure in result.failures)
    assert any("2 doctors are available" in failure for failure in result.failures)


def test_september_2026_passes_preflight() -> None:
    """The real month is comfortably satisfiable, so the solver should be invoked."""
    result = preflight(september_2026())

    assert result
    assert result.total_demand == 94
    # 30 days x 13 doctors, since H-02 makes a day's supply a headcount.
    assert result.total_supply == 390
    assert not result.failures


def test_a_single_bad_day_is_caught_even_with_ample_total_capacity() -> None:
    """The per-day check catches what the total misses.

    A month can have plenty of total capacity while one particular day has almost nobody
    available. Only checking the total would let that through to the solver, which would
    then produce a roster with an unexplained gap on that one day.
    """
    instance = september_2026()
    blocked_date = instance.days[10].date
    # Leave two doctors available on a 3-shift day.
    instance.preferences = [
        Preference(
            doctor=doctor,
            type=PreferenceType.UNAVAILABLE,
            dates=frozenset({blocked_date}),
            source_token="NOT",
        )
        for doctor in instance.doctors[:11]
    ]

    result = preflight(instance)

    assert not result
    assert result.total_demand < result.total_supply, "total capacity is still ample"
    assert len(result.failures) == 1
    assert blocked_date.strftime("%d %B %Y") in result.failures[0]


def test_shift_scoped_unavailability_does_not_remove_a_days_supply() -> None:
    """A doctor unavailable for one shift is still available for the others that day.

    Getting this wrong would make pre-flight over-reject and block solves that are
    perfectly satisfiable - which is worse than under-rejecting, because it stops the
    admin working at all.
    """
    instance = september_2026()
    instance.preferences = [
        Preference(
            doctor=doctor,
            type=PreferenceType.UNAVAILABLE,
            dates=frozenset({instance.days[0].date}),
            shift_ids=frozenset({"std-night"}),
            source_token="NOT",
        )
        for doctor in instance.doctors
    ]

    assert preflight(instance), "shift-scoped unavailability must not reduce day supply"


def test_prefer_not_does_not_reduce_supply() -> None:
    """PREFER_NOT is a preference the solver may outvote, not a removal of supply.

    Treating it as hard here would block solves the principal expects to succeed - he
    routinely assigns people to shifts they would rather not work when coverage demands
    it, and the product must let him.
    """
    instance = september_2026()
    instance.preferences = [
        Preference(
            doctor=doctor,
            type=PreferenceType.PREFER_NOT,
            dates=frozenset(day.date for day in instance.days),
        )
        for doctor in instance.doctors
    ]

    assert preflight(instance), "PREFER_NOT must not be treated as unavailability"
