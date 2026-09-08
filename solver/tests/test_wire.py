"""Weekday wire-format tests.

These pin an ASYMMETRY on purpose. This side maps MONDAY to 0; the TypeScript side maps it
to 1. Both are right. If someone "fixes" either side to agree with the other, one of these
tests fails loudly - which is the entire point, because the alternative failure mode is a
doctor rostered on the wrong day with no error anywhere.

The mirror test is lib/contract/weekday.test.ts.
"""

from __future__ import annotations

import datetime as dt

import pytest

from call_roster_solver.instance import FRIDAY, MONDAY, SATURDAY, SUNDAY, AvailabilityRule
from call_roster_solver.wire import (
    WEEKDAY_NAMES,
    is_weekday_name,
    name_from_weekday,
    names_from_weekdays,
    weekday_from_name,
    weekdays_from_names,
)


def test_monday_is_zero_on_this_side() -> None:
    """⚠️ The TypeScript side maps MONDAY to 1. Do not reconcile them; convert at the boundary."""
    assert weekday_from_name("MONDAY") == 0
    assert weekday_from_name("SUNDAY") == 6
    assert weekday_from_name("SATURDAY") == 5


def test_the_names_match_the_instance_module_constants() -> None:
    """instance.py declares MONDAY..SUNDAY = range(7). These must not drift apart."""
    assert weekday_from_name("MONDAY") == MONDAY
    assert weekday_from_name("FRIDAY") == FRIDAY
    assert weekday_from_name("SATURDAY") == SATURDAY
    assert weekday_from_name("SUNDAY") == SUNDAY


def test_agrees_with_date_weekday_for_a_known_week() -> None:
    # 2025-02-03 is a Monday, so seven consecutive dates cover the week in this side's order.
    monday = dt.date(2025, 2, 3)
    for offset, expected in enumerate(WEEKDAY_NAMES):
        date = monday + dt.timedelta(days=offset)
        assert name_from_weekday(date.weekday()) == expected


def test_an_unknown_name_raises_rather_than_defaulting() -> None:
    # A silent fallback here puts a doctor on the wrong day.
    for bad in ("Monday", "MON", "", "monday"):
        with pytest.raises(ValueError, match="Not a weekday name"):
            weekday_from_name(bad)


def test_out_of_range_raises_rather_than_wrapping() -> None:
    """Python would silently accept -1 and return SUNDAY. That is the bug this prevents."""
    for bad in (7, -1, 100):
        with pytest.raises(ValueError, match="out of range"):
            name_from_weekday(bad)


def test_is_weekday_name_accepts_every_name_and_rejects_near_misses() -> None:
    assert all(is_weekday_name(name) for name in WEEKDAY_NAMES)
    assert not is_weekday_name("TUES")
    assert not is_weekday_name("monday")


def test_round_trips_the_D07_shape() -> None:
    """D07 and D09 alternate a Monday 15:00-23:00, the only exceptions in 1,086 pool shifts."""
    rule = AvailabilityRule(hour=17, except_weekdays=frozenset({MONDAY}))
    assert names_from_weekdays(rule.except_weekdays) == ["MONDAY"]
    assert weekdays_from_names(["MONDAY"]) == rule.except_weekdays


def test_list_conversions_deduplicate_and_sort() -> None:
    assert names_from_weekdays([2, 0, 2]) == ["MONDAY", "WEDNESDAY"]
    assert weekdays_from_names(["FRIDAY", "MONDAY", "FRIDAY"]) == frozenset({0, 4})


def test_the_empty_case_which_is_the_common_one() -> None:
    # Most doctors have no weekday exception at all.
    assert names_from_weekdays(frozenset()) == []
    assert weekdays_from_names([]) == frozenset()


def test_every_name_round_trips_through_the_integer() -> None:
    for name in WEEKDAY_NAMES:
        assert name_from_weekday(weekday_from_name(name)) == name


def test_every_integer_round_trips_through_the_name() -> None:
    for weekday in range(7):
        assert weekday_from_name(name_from_weekday(weekday)) == weekday
