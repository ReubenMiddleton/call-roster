"""Weekday names for the solver contract, and the conversions to and from this side's integers.

⚠️ WHY THIS MODULE EXISTS

A weekday integer means two different days depending on which side of the boundary you are on.

    Python  date.weekday()      MONDAY = 0, SUNDAY = 6
    TS      Date.getUTCDay()    SUNDAY = 0, MONDAY = 1

Both are correct in their own language and neither can reasonably change. So the same
concept - "the Monday exception on D07's availability rule" - is 0 here and 1 there. Sent
as an integer it silently becomes SUNDAY on arrival, and nothing anywhere raises an error:
the roster is merely wrong, on the one day of the week nobody was looking at.

docs/architecture/solver-contract.md calls this boundary the highest-risk interface in the
system precisely because it can drift without a compile error. This is that drift, already
present in two live data structures - AvailabilityRule.except_weekdays and RecurringSlot.

So a weekday NEVER crosses the wire as an integer. It crosses as a name, and the
conversion happens exactly once per side, here.

The mirror module is lib/contract/weekday.ts.
"""

from __future__ import annotations

from typing import Final

# Monday-first, matching this side's integers, so WEEKDAY_NAMES[n] is a direct lookup.
# Do NOT reorder it to look like the TypeScript side.
WEEKDAY_NAMES: Final[tuple[str, ...]] = (
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
)

_BY_NAME: Final[dict[str, int]] = {name: index for index, name in enumerate(WEEKDAY_NAMES)}


def is_weekday_name(value: str) -> bool:
    """Whether a string is a valid wire weekday. Use before trusting external input."""
    return value in _BY_NAME


def weekday_from_name(name: str) -> int:
    """Wire name to this side's integer, where MONDAY is 0.

    Raises on an unknown name rather than returning a default. The contract says to reject
    unknown fields rather than ignore them, and the same reasoning applies with more force
    to a value: a silent fallback here puts a doctor on the wrong day.
    """
    try:
        return _BY_NAME[name]
    except KeyError:
        expected = ", ".join(WEEKDAY_NAMES)
        raise ValueError(f'Not a weekday name: "{name}". Expected one of {expected}.') from None


def name_from_weekday(weekday: int) -> str:
    """This side's integer to the wire name, where MONDAY is 0.

    Raises outside 0-6 instead of letting a negative index wrap, which Python would do
    silently: WEEKDAY_NAMES[-1] is "SUNDAY", not an error.
    """
    if not 0 <= weekday <= 6:
        raise ValueError(f"Weekday out of range: {weekday}. Expected 0-6, MONDAY = 0.")
    return WEEKDAY_NAMES[weekday]


def names_from_weekdays(weekdays: frozenset[int] | set[int] | list[int]) -> list[str]:
    """Convenience for the shape availability rules actually hold. Sorted, so output is stable."""
    return [name_from_weekday(weekday) for weekday in sorted(set(weekdays))]


def weekdays_from_names(names: list[str] | tuple[str, ...]) -> frozenset[int]:
    """The inverse. A frozenset, because that is what AvailabilityRule holds."""
    return frozenset(weekday_from_name(name) for name in names)
