"""Request-parsing tests.

Two jobs. The first half parses fixtures/solver-request.json - the payload the TypeScript
side also reads - and asserts the resulting Instance. The second half asserts that bad input
is REFUSED with a message naming the field, because a parser that accepts a malformed
request is worse than no parser: it produces a plausible, wrong roster.

The fixture is shared on purpose. See fixtures/README.md.
"""

from __future__ import annotations

import copy
import datetime as dt
import json
from pathlib import Path
from typing import Any

import pytest

from call_roster_solver.contract import ContractError, parse_request
from call_roster_solver.instance import PATTERNS, AssignmentRef, PreferenceType, ShiftKind
from call_roster_solver.model import build, solve
from call_roster_solver.wire import weekday_from_name

FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "solver-request.json"


def _payload() -> dict[str, Any]:
    """A fresh deep copy, so a mutating test cannot leak into the next one."""
    with FIXTURE.open(encoding="utf-8") as handle:
        loaded: dict[str, Any] = json.load(handle)
    return copy.deepcopy(loaded)


# ── The happy path ───────────────────────────────────────────────────────────────────


def test_the_shared_fixture_parses() -> None:
    instance = parse_request(_payload())

    assert instance.doctors == ["D01", "D02", "D03", "D06", "D07"]
    assert len(instance.days) == 4
    assert [day.date.isoformat() for day in instance.days] == [
        "2026-09-01",
        "2026-09-04",
        "2026-09-07",
        "2026-09-24",
    ]


def test_shifts_come_from_the_payload_not_the_pattern_table() -> None:
    """⚠️ The regression test for a single-tenant leak.

    Day.shifts used to read a module-global PATTERNS table keyed by patternId. The contract
    sent the shifts; the solver looked up its own; they agreed only because there is exactly
    one practice. A second tenant with different hours would silently have been rostered on
    this one's times.
    """
    instance = parse_request(_payload())
    for day in instance.days:
        assert day.explicit_shifts is not None, f"{day.date} fell back to the pattern table"

    # And prove the fallback is genuinely not being used: change the payload's hours to
    # something no pattern in the table has, and the parsed Instance must follow the payload.
    payload = _payload()
    payload["days"][0]["shifts"][0]["end"] = "14:00"
    changed = parse_request(payload)
    assert changed.days[0].shifts[0].end_hour == 14
    assert PATTERNS["A"][0].end_hour == 15, "the table itself must not have been mutated"


def test_pattern_b_keeps_its_fourth_shift() -> None:
    # Friday has four shifts, not three. Anything assuming three breaks here.
    instance = parse_request(_payload())
    friday = next(day for day in instance.days if day.pattern_id == "B")
    assert len(friday.shifts) == 4
    assert [shift.shift_id for shift in friday.shifts] == [
        "fri-early",
        "fri-midday",
        "fri-evening",
        "fri-night",
    ]


def test_an_overnight_shift_has_positive_hours() -> None:
    """23:00-07:00 is eight hours, not minus sixteen."""
    instance = parse_request(_payload())
    night = next(
        shift for day in instance.days for shift in day.shifts if shift.shift_id == "std-night"
    )
    assert night.ends_next_day is True
    assert night.hours == 8
    assert night.is_night is True
    assert night.kind is ShiftKind.NIGHT


def test_the_public_holiday_survives_parsing() -> None:
    """H-10's exemption depends on this flag, and it is the counter-intuitive branch."""
    instance = parse_request(_payload())
    holiday = next(day for day in instance.days if day.date.isoformat() == "2026-09-24")
    assert holiday.is_public_holiday is True
    assert all(
        not day.is_public_holiday for day in instance.days if day.date.isoformat() != "2026-09-24"
    )


def test_availability_arrives_with_the_weekday_exception_intact() -> None:
    """⚠️ The reason weekdays cross as names.

    D07's exception is MONDAY. On this side MONDAY is 0; in TypeScript it is 1. Had the
    contract carried an integer, this assertion would read 1 and mean Tuesday.
    """
    instance = parse_request(_payload())

    assert instance.availability["D06"].hour == 17
    assert instance.availability["D06"].except_weekdays == frozenset()

    assert instance.availability["D07"].except_weekdays == frozenset({weekday_from_name("MONDAY")})
    assert instance.availability["D07"].except_weekdays == frozenset({0})


def test_recurring_slots_arrive_with_the_right_weekday() -> None:
    instance = parse_request(_payload())
    by_doctor = {slot.doctor: slot for slot in instance.recurring_slots}
    assert by_doctor["D02"].weekday == weekday_from_name("MONDAY")
    assert by_doctor["D03"].weekday == weekday_from_name("TUESDAY")
    assert by_doctor["D03"].shift_id == "std-morning"


def test_preferences_keep_their_type_and_tentativeness() -> None:
    instance = parse_request(_payload())
    by_doctor = {preference.doctor: preference for preference in instance.preferences}

    assert by_doctor["D06"].type is PreferenceType.UNAVAILABLE
    assert by_doctor["D06"].tentative is False
    assert by_doctor["D06"].source_token == "NOT"
    assert by_doctor["D06"].shift_ids is None, "null shiftIds means the whole day"

    # The diary's plus-minus modifier.
    assert by_doctor["D03"].type is PreferenceType.PREFER_NOT
    assert by_doctor["D03"].tentative is True
    assert by_doctor["D03"].shift_ids == frozenset({"std-night"})


def test_H07_ships_off_and_the_mode_is_what_decides() -> None:
    """The whole point of carrying modes as data: a confirmed answer flips a switch."""
    instance = parse_request(_payload())
    assert instance.flags.h07_d01_never_pattern_b is False

    payload = _payload()
    for constraint in payload["constraints"]:
        if constraint["id"] == "H-07":
            constraint["mode"] = "WARN"
    assert parse_request(payload).flags.h07_d01_never_pattern_b is True


def test_a_parsed_request_actually_solves() -> None:
    """End to end. A parser that produces an Instance the model rejects has proved nothing."""
    instance = parse_request(_payload())
    result = solve(build(instance))
    assert result.status in ("OPTIMAL", "FEASIBLE", "TIMED_OUT")
    assert result.assignments, "no assignments at all"


# ── Refusals ─────────────────────────────────────────────────────────────────────────


def test_an_unknown_top_level_field_is_refused() -> None:
    payload = _payload()
    payload["fte"] = 1.0  # removed in 1.1.0 - see NEEDS_YOUR_INPUT question 36
    with pytest.raises(ContractError, match="unknown field"):
        parse_request(payload)


def test_an_unknown_nested_field_is_refused() -> None:
    """Not only at the top level. A dropped nested field is just as wrong and harder to see."""
    payload = _payload()
    payload["doctors"][0]["fte"] = 0.4
    with pytest.raises(ContractError, match=r"doctors\[0\]"):
        parse_request(payload)


def test_a_weekday_integer_is_refused_with_an_explanation() -> None:
    """⚠️ The bug this whole mechanism exists to prevent.

    An integer here is not a type error - it is a SEMANTIC one. 1 means Monday to the sender
    and Tuesday to this side, and nothing would have complained.
    """
    payload = _payload()
    payload["recurringSlots"][0]["weekday"] = 0
    with pytest.raises(ContractError, match="NAMES, not integers"):
        parse_request(payload)

    payload = _payload()
    payload["availability"][1]["rules"][0]["exceptWeekdays"] = [1]
    with pytest.raises(ContractError, match="NAMES, not integers"):
        parse_request(payload)


def test_a_misspelt_weekday_is_refused_rather_than_defaulted() -> None:
    payload = _payload()
    payload["recurringSlots"][0]["weekday"] = "Monday"
    with pytest.raises(ContractError, match="Not a weekday name"):
        parse_request(payload)


def test_a_major_version_mismatch_is_refused() -> None:
    payload = _payload()
    payload["contractVersion"] = "2.0.0"
    with pytest.raises(ContractError, match="not supported"):
        parse_request(payload)


def test_a_minor_version_bump_is_accepted() -> None:
    """A minor bump is additive by definition, so 1.0.0 and 1.9.0 both read."""
    for version in ("1.0.0", "1.9.3"):
        payload = _payload()
        payload["contractVersion"] = version
        assert parse_request(payload).doctors  # does not raise


def test_a_shift_with_no_kind_is_refused() -> None:
    """kind drives Shift.is_night, which drives H-04. Guessing it from the times is wrong."""
    payload = _payload()
    del payload["days"][0]["shifts"][2]["kind"]
    with pytest.raises(ContractError, match="required field is missing"):
        parse_request(payload)


def test_an_unknown_shift_kind_is_refused_and_lists_the_valid_ones() -> None:
    payload = _payload()
    payload["days"][0]["shifts"][0]["kind"] = "twilight"
    with pytest.raises(ContractError, match="unknown shift kind"):
        parse_request(payload)


def test_an_overnight_shift_that_does_not_say_so_is_refused() -> None:
    """Without this, 23:00-07:00 parses as minus sixteen hours and burden goes negative."""
    payload = _payload()
    payload["days"][0]["shifts"][2]["endsNextDay"] = False
    with pytest.raises(ContractError, match="ends at or before it starts"):
        parse_request(payload)


def test_a_boundary_off_the_hour_is_refused_not_rounded() -> None:
    """Rounding a shift boundary changes who is on duty."""
    payload = _payload()
    payload["days"][0]["shifts"][0]["end"] = "15:30"
    with pytest.raises(ContractError, match="not on the hour"):
        parse_request(payload)


def test_a_day_outside_the_horizon_is_refused() -> None:
    """A silently solved out-of-horizon day publishes dates the admin did not ask about."""
    payload = _payload()
    payload["days"][0]["date"] = "2026-10-01"
    with pytest.raises(ContractError, match="outside the horizon"):
        parse_request(payload)


def test_a_duplicate_date_is_refused() -> None:
    payload = _payload()
    payload["days"][1]["date"] = payload["days"][0]["date"]
    with pytest.raises(ContractError, match="duplicate date"):
        parse_request(payload)


def test_a_day_with_no_shifts_is_refused() -> None:
    payload = _payload()
    payload["days"][0]["shifts"] = []
    with pytest.raises(ContractError, match="not a day off"):
        parse_request(payload)


def test_availability_for_an_unknown_doctor_is_refused() -> None:
    """Either a stale record or the wrong request. Both are worth stopping for."""
    payload = _payload()
    payload["availability"][0]["doctorCode"] = "D99"
    with pytest.raises(ContractError, match="is not in this request"):
        parse_request(payload)


def test_a_second_availability_rule_is_refused_rather_than_dropped() -> None:
    """The solver models one rule per doctor. Silently taking the first would be worse."""
    payload = _payload()
    payload["availability"][0]["rules"].append(
        {"kind": "NO_WEEKDAY_BEFORE", "hour": 9},
    )
    with pytest.raises(ContractError, match="expected exactly one rule"):
        parse_request(payload)


def test_an_unknown_availability_rule_kind_is_refused() -> None:
    payload = _payload()
    payload["availability"][0]["rules"][0]["kind"] = "NO_NIGHTS"
    with pytest.raises(ContractError, match="unknown availability rule kind"):
        parse_request(payload)


def test_an_hour_out_of_range_is_refused() -> None:
    payload = _payload()
    payload["availability"][0]["rules"][0]["hour"] = 24
    with pytest.raises(ContractError, match="out of range"):
        parse_request(payload)


def test_a_boolean_hour_is_refused() -> None:
    """bool is an int in Python, so `"hour": true` would otherwise parse as hour 1."""
    payload = _payload()
    payload["availability"][0]["rules"][0]["hour"] = True
    with pytest.raises(ContractError, match="expected an integer"):
        parse_request(payload)


def test_an_unknown_preference_type_is_refused() -> None:
    payload = _payload()
    payload["preferences"][0]["type"] = "MAYBE"
    with pytest.raises(ContractError, match="unknown type"):
        parse_request(payload)


def test_a_preference_with_no_dates_is_refused() -> None:
    payload = _payload()
    payload["preferences"][0]["dates"] = []
    with pytest.raises(ContractError, match="no meaning"):
        parse_request(payload)


def test_a_reversed_horizon_is_refused() -> None:
    payload = _payload()
    payload["horizon"] = {"start": "2026-09-30", "end": "2026-09-01"}
    with pytest.raises(ContractError, match="precedes start"):
        parse_request(payload)


def test_a_reversed_validity_interval_is_refused() -> None:
    payload = _payload()
    payload["recurringSlots"][0]["validUntil"] = "2023-01-01"
    with pytest.raises(ContractError, match="precedes validFrom"):
        parse_request(payload)


def test_a_duplicate_doctor_code_is_refused() -> None:
    payload = _payload()
    payload["doctors"][1]["code"] = "D01"
    with pytest.raises(ContractError, match="duplicate doctor code"):
        parse_request(payload)


def test_an_empty_doctor_list_is_refused() -> None:
    payload = _payload()
    payload["doctors"] = []
    with pytest.raises(ContractError, match="Nothing can be rostered"):
        parse_request(payload)


def test_a_malformed_date_is_refused() -> None:
    payload = _payload()
    payload["days"][0]["date"] = "1 September 2026"
    with pytest.raises(ContractError, match="not an ISO date"):
        parse_request(payload)


def test_the_error_names_the_field_not_the_request() -> None:
    """'invalid request' is not actionable when the payload has sixteen top-level fields."""
    payload = _payload()
    payload["availability"][1]["rules"][0]["kind"] = "NONSENSE"
    with pytest.raises(ContractError) as caught:
        parse_request(payload)
    assert caught.value.path == "availability[1].rules[0].kind"


def test_a_non_object_payload_is_refused() -> None:
    for bad in ([], "a request", 7, None):
        with pytest.raises(ContractError, match="expected an object"):
            parse_request(bad)


# ── previousPublished, consumed by S-06 since 2026-09-02 ────────────────────────────


def test_previous_published_reaches_the_instance() -> None:
    """The fixture's single published assignment must arrive as an AssignmentRef.

    It was validated-but-discarded for a year of this project's life, and the fixture
    carried it so the shape would be proven the day something read it. This is that day.
    """
    instance = parse_request(_payload())
    assert instance.previous_published == [
        AssignmentRef(date=dt.date(2026, 9, 1), shift_id="std-morning", doctor="D03")
    ]


def test_previous_published_defaults_to_empty() -> None:
    """A first solve has no previous roster, and that is not an error."""
    payload = _payload()
    del payload["previousPublished"]
    assert parse_request(payload).previous_published == []


def test_previous_published_accepts_a_doctor_who_has_left() -> None:
    """The one place a doctor code is deliberately NOT validated against the roll.

    A roster published before a departure legitimately names someone who is gone.
    Rejecting it would make the last month before any departure unparseable; the model
    skips the ref instead. See _parse_assignment_refs.
    """
    payload = _payload()
    payload["previousPublished"] = [
        {"date": "2026-09-01", "shiftId": "std-morning", "doctorCode": "D14"}
    ]
    instance = parse_request(payload)
    assert instance.previous_published[0].doctor == "D14"
    assert "D14" not in instance.doctors


def test_two_doctors_in_one_published_slot_is_refused() -> None:
    """The published roster had one doctor per slot. Two means the caller built it wrong.

    Silently keeping the last would make the churn penalty quietly wrong, which is worse
    than loudly absent.
    """
    payload = _payload()
    payload["previousPublished"] = [
        {"date": "2026-09-01", "shiftId": "std-morning", "doctorCode": "D03"},
        {"date": "2026-09-01", "shiftId": "std-morning", "doctorCode": "D04"},
    ]
    with pytest.raises(ContractError, match="duplicate slot"):
        parse_request(payload)


def test_an_unknown_field_in_a_published_assignment_is_refused() -> None:
    payload = _payload()
    payload["previousPublished"][0]["reason"] = "swapped"
    with pytest.raises(ContractError, match="unknown field"):
        parse_request(payload)


def test_S06_mode_off_reaches_the_flags() -> None:
    """The "let it rearrange freely" control is DATA, exactly like H-07's."""
    payload = _payload()
    entry = next(c for c in payload["constraints"] if c["id"] == "S-06")
    assert entry["mode"] == "WARN", "the fixture should ship churn ON"
    assert parse_request(payload).flags.s06_minimise_churn is True

    entry["mode"] = "OFF"
    assert parse_request(payload).flags.s06_minimise_churn is False


def test_time_budget_reaches_the_instance() -> None:
    """⚠️ Regression, 6 September 2026.

    timeBudgetSeconds was listed as a known field - so it was not rejected - and then never
    read and never type-checked. The contract documented it as "the solver returns its
    incumbent best when this expires" and the budget actually used came from a CLI flag.
    A string would have passed silently.

    The fourth field found this week to be validated, documented and unused. The others
    were H-03's membership dates, the tentative flag, and burdenWeights.
    """
    payload = _payload()
    payload["timeBudgetSeconds"] = 12.5
    assert parse_request(payload).time_budget_seconds == 12.5


def test_time_budget_is_optional() -> None:
    payload = _payload()
    payload.pop("timeBudgetSeconds", None)
    assert parse_request(payload).time_budget_seconds is None


def test_time_budget_refuses_a_non_number() -> None:
    payload = _payload()
    payload["timeBudgetSeconds"] = "thirty"
    with pytest.raises(ContractError, match="expected a number of seconds"):
        parse_request(payload)


def test_time_budget_refuses_zero() -> None:
    """A budget of zero returns whatever the first propagation produced and calls it a
    roster. Refused rather than clamped."""
    payload = _payload()
    payload["timeBudgetSeconds"] = 0
    with pytest.raises(ContractError, match="not a time budget"):
        parse_request(payload)


def test_a_tentative_must_is_refused_rather_than_resolved() -> None:
    """A commitment made only if necessary is not a commitment.

    `tentative` means "if necessary" [CONFIRMED 2026-09-04]; MUST is something the doctor has
    already committed to. Every reading of the combination rosters somebody against what they
    actually said, so the parser refuses it — rule 4, no silent default for anything semantic.
    """
    payload = _payload()
    payload["preferences"][0]["type"] = "MUST"
    payload["preferences"][0]["tentative"] = True
    with pytest.raises(ContractError, match="cannot be tentative"):
        parse_request(payload)


def test_a_firm_must_is_still_accepted() -> None:
    """The control: only the combination is refused, not MUST itself."""
    payload = _payload()
    payload["preferences"][0]["type"] = "MUST"
    payload["preferences"][0]["tentative"] = False
    parse_request(payload)


def test_H13_a_lock_on_a_non_member_is_refused() -> None:
    """H-03 wins: it removes the assignment entirely, so there is nothing to lock.

    Refused at the wire rather than in the model, where the same problem would surface as an
    ERROR status with nothing to point at. Silently dropping the lock is the worst option.
    """
    payload = _payload()
    payload["doctors"][0]["availableFrom"] = "2030-01-01"
    payload["lockedAssignments"] = [
        {
            "date": payload["days"][0]["date"],
            "shiftId": payload["days"][0]["shifts"][0]["shiftId"],
            "doctorCode": payload["doctors"][0]["code"],
        }
    ]
    with pytest.raises(ContractError, match="not a member"):
        parse_request(payload)


def test_H13_two_locks_on_one_slot_are_refused() -> None:
    """Single cover. The same rule and the same parser as previousPublished."""
    payload = _payload()
    ref = {
        "date": payload["days"][0]["date"],
        "shiftId": payload["days"][0]["shifts"][0]["shiftId"],
    }
    payload["lockedAssignments"] = [
        {**ref, "doctorCode": payload["doctors"][0]["code"]},
        {**ref, "doctorCode": payload["doctors"][1]["code"]},
    ]
    with pytest.raises(ContractError, match="duplicate slot"):
        parse_request(payload)


def test_H13_a_lock_on_a_shift_the_day_does_not_have_is_refused() -> None:
    """A day's shifts are a property of the DATE, so this is as likely a wrong pattern as a
    typo — and the message says so."""
    payload = _payload()
    payload["lockedAssignments"] = [
        {
            "date": payload["days"][0]["date"],
            "shiftId": "no-such-shift",
            "doctorCode": payload["doctors"][0]["code"],
        }
    ]
    with pytest.raises(ContractError, match="has no shift"):
        parse_request(payload)


def test_H13_a_valid_lock_reaches_the_instance() -> None:
    """The control, and the thing that was missing for weeks: accepted IS NOT used."""
    payload = _payload()
    payload["lockedAssignments"] = [
        {
            "date": payload["days"][0]["date"],
            "shiftId": payload["days"][0]["shifts"][0]["shiftId"],
            "doctorCode": payload["doctors"][0]["code"],
        }
    ]
    instance = parse_request(payload)
    assert len(instance.locked_assignments) == 1
    assert instance.locked_assignments[0].doctor == payload["doctors"][0]["code"]
