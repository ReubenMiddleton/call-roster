"""Pre-flight arithmetic. Runs BEFORE the solver is ever invoked.

Why this exists, discovered the hard way
----------------------------------------
The property test in ``tests/test_properties.py`` generated a two-doctor, three-day
instance: 9 shift slots, but each doctor works at most one shift per day (H-02), so only
6 doctor-shifts are available. Three slots are *structurally* uncoverable.

The solver handled it correctly - it filled six slots and reported a coverage shortfall
of three - but that is a useless answer to give a non-technical user. It looks like the
software failed. What he needs is:

    "You cannot cover 1-3 January: 9 shifts need filling but only 2 doctors are
     available, which covers at most 6."

That is an arithmetic fact available in microseconds, and it needs no solver at all.
Checking it first turns "no solution found" into an actionable sentence, and it is why
the contract returns 422 with the failing dates rather than enqueueing a doomed solve.

**If a solve fails for a reason pre-flight could have named, the fix belongs here.**
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from .instance import Instance, PreferenceType


@dataclass
class PreflightResult:
    feasible: bool
    """False means do not invoke the solver at all."""

    total_demand: int = 0
    total_supply: int = 0
    failures: list[str] = field(default_factory=list)
    """Plain-language, addressed to the admin. Names the dates, not the constraints."""

    def __bool__(self) -> bool:
        return self.feasible


def _is_member(instance: Instance, doctor: str, date: dt.date) -> bool:
    """Whether H-03 lets this doctor hold a slot on this date. Absent window means always."""
    available_from, available_until = instance.membership.get(doctor, (None, None))
    if available_from is not None and date < available_from:
        return False
    # Guard-clause chain kept deliberately, matching RecurringSlot.covers: two independent
    # reasons to reject read better than one negated conjunction.
    if available_until is not None and date > available_until:  # noqa: SIM103
        return False
    return True


def preflight(instance: Instance) -> PreflightResult:
    """Check that demand can arithmetically be met, in total and on each individual day.

    Two checks, and the per-day one catches cases the total misses: a month can have
    ample total capacity while one particular Tuesday has nobody available.
    """
    failures: list[str] = []

    # Hard unavailability by date. UNAVAILABLE and (absent) leave remove supply;
    # PREFER_NOT does not, because it is a preference the solver may outvote.
    unavailable: dict[object, set[str]] = {}
    for preference in instance.preferences:
        if preference.type is not PreferenceType.UNAVAILABLE:
            continue
        # A whole-day unavailability removes the doctor from that day's supply. A
        # shift-scoped one does not, since they remain available for other shifts.
        if preference.shift_ids is not None:
            continue
        for date in preference.dates:
            unavailable.setdefault(date, set()).add(preference.doctor)

    total_demand = 0
    total_supply = 0

    for day in instance.days:
        demand = len(day.shifts)
        blocked = unavailable.get(day.date, set())
        # H-02 caps each doctor at one shift per day, so a day's supply is a headcount.
        #
        # ⚠️ MEMBERSHIP REMOVES SUPPLY, AND IGNORING IT MADE THIS CHECK LIE. H-03 is
        # structural - the assignment variable does not exist outside a doctor's window -
        # so a doctor who has left cannot cover anything at any price. Counting them here
        # let preflight report "feasible" for a day the solver then left uncovered, which
        # is exactly the failure this module exists to name first. Found 6 September 2026
        # by generating membership windows in the property tests.
        #
        # H-10 availability is deliberately NOT subtracted: it is elasticised at the
        # COVERAGE tier, so a pool GP on a weekday morning is expensive rather than
        # impossible, and treating it as lost supply would refuse solvable months.
        supply = len(
            [d for d in instance.doctors if d not in blocked and _is_member(instance, d, day.date)]
        )

        total_demand += demand
        total_supply += supply

        if demand > supply:
            shortfall = demand - supply
            pretty = day.date.strftime("%d %B %Y")
            failures.append(
                f"{pretty}: {demand} shifts need filling but only {supply} "
                f"{'doctor is' if supply == 1 else 'doctors are'} available "
                f"— {shortfall} short."
            )

    if total_demand > total_supply:
        failures.append(
            f"Across the whole period, {total_demand} shifts need filling but only "
            f"{total_supply} doctor-shifts are available — "
            f"{total_demand - total_supply} short."
        )

    return PreflightResult(
        feasible=not failures,
        total_demand=total_demand,
        total_supply=total_supply,
        failures=failures,
    )
