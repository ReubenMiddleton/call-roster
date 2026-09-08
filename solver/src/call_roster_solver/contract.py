"""The wire boundary. Parses a solve request into an Instance.

This is the half of the boundary that did not exist. Until now the only way to get an
Instance was september_2026(), a hand-written fixture - so the contract described a payload
nothing could actually read, and every field in it was unverified by construction.

DESIGN RULES, all of them from docs/architecture/solver-contract.md:

1. REJECT UNKNOWN FIELDS, everywhere, not just at the top level. The contract says to
   reject rather than ignore, and it is right: a field the sender believes is being honoured
   and the receiver silently drops is the worst failure available here. It looks like a
   bug in the roster, months later, three languages from the cause.

2. WEEKDAYS ARRIVE AS NAMES. See wire.py for why - MONDAY is 0 here and 1 in TypeScript,
   both correct, and an integer on the wire silently becomes the wrong day.

3. SHIFTS COME FROM THE PAYLOAD, never from the global PATTERNS table. Day.explicit_shifts
   is always populated here. The table is a fixture convenience.

4. NO SILENT DEFAULTS FOR ANYTHING SEMANTIC. A missing optional field with an obvious
   default (tentative, endsNextDay) defaults. A missing required one raises. There is no
   third category, because "sensible default" is how a roster gets quietly built on the
   wrong assumption.

Deliberately hand-written rather than generated, for now. The contract document says to
generate Pydantic models from it, and that is still the right end state, but generating
types out of prose markdown is the wrong direction - the schema should be the source and
the document the rendering, not the reverse. Noted in docs/DECISIONS.md rather than
silently done differently. scripts/check-contract.mjs is what keeps the two aligned in the
meantime: it parses the document's own examples and fails the gate when they drift.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from .instance import (
    AssignmentRef,
    AvailabilityRule,
    Day,
    FeatureFlags,
    Instance,
    Preference,
    PreferenceType,
    RecurringSlot,
    Shift,
    ShiftKind,
    SlotShare,
)
from .wire import weekday_from_name, weekdays_from_names

# Any survives only INSIDE a generic. dict[str, Any] describes parsed JSON, whose values
# genuinely can be anything. It never appears as a bare parameter annotation: an `object`
# parameter cannot be indexed or iterated without narrowing first, which is the whole job
# of this module. Ruff ANN401 enforces the distinction, and it is right to.

SUPPORTED_MAJOR = 1
"""Accept 1.x, reject anything else. A minor bump is additive by definition."""


class ContractError(ValueError):
    """A request that cannot be trusted. Never partially applied.

    Carries the JSON path so the message names the offending field rather than the
    request. "availability[0].rules[0].kind" is actionable; "invalid request" is not.
    """

    def __init__(self, path: str, message: str) -> None:
        self.path = path
        super().__init__(f"{path}: {message}" if path else message)


# ── Field-level helpers ──────────────────────────────────────────────────────────────


def _reject_unknown(payload: dict[str, Any], allowed: set[str], path: str) -> None:
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise ContractError(
            path,
            f"unknown field(s) {', '.join(unknown)}. "
            f"Expected only: {', '.join(sorted(allowed))}. "
            "The contract rejects unknown fields rather than ignoring them - if this is a "
            "new field, bump contractVersion and regenerate both sides.",
        )


def _obj(payload: object, path: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ContractError(path, f"expected an object, got {type(payload).__name__}")
    return payload


def _seq(payload: object, path: str) -> list[Any]:
    # str is a sequence and would iterate character by character. Excluded explicitly.
    if not isinstance(payload, list):
        raise ContractError(path, f"expected an array, got {type(payload).__name__}")
    return payload


def _required(payload: dict[str, Any], key: str, path: str) -> object:
    if key not in payload:
        raise ContractError(f"{path}.{key}" if path else key, "required field is missing")
    return payload[key]


def _str(payload: dict[str, Any], key: str, path: str) -> str:
    value = _required(payload, key, path)
    if not isinstance(value, str):
        raise ContractError(f"{path}.{key}", f"expected a string, got {type(value).__name__}")
    return value


def _bool(payload: dict[str, Any], key: str, path: str, default: bool) -> bool:
    value = payload.get(key, default)
    if not isinstance(value, bool):
        raise ContractError(f"{path}.{key}", f"expected a boolean, got {type(value).__name__}")
    return value


def _int(payload: dict[str, Any], key: str, path: str) -> int:
    value = _required(payload, key, path)
    # bool is an int in Python. Excluded, or `"hour": true` would parse as hour 1.
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractError(f"{path}.{key}", f"expected an integer, got {type(value).__name__}")
    return value


def _date(value: object, path: str) -> dt.date:
    if not isinstance(value, str):
        raise ContractError(path, f"expected an ISO date string, got {type(value).__name__}")
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        raise ContractError(path, f'not an ISO date: "{value}". Expected YYYY-MM-DD.') from None


def _optional_date(obj: dict[str, object], key: str, path: str) -> dt.date | None:
    """An ISO date, or None for absent-or-explicitly-null.

    ``null`` and absent mean the same thing here - an open-ended membership window - and
    the TypeScript side sends an explicit ``null`` for ``availableUntil``, so treating the
    two differently would reject every ordinary request.
    """
    value = obj.get(key)
    if value is None:
        return None
    return _date(value, f"{path}.{key}")


def _optional_budget(obj: dict[str, Any], key: str, path: str) -> float | None:
    """A positive number of seconds, or None when absent.

    Zero and negatives are refused rather than clamped: a budget of zero would return
    whatever the first propagation produced and call it a roster.
    """
    value = obj.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractError(
            f"{path}.{key}" if path else key,
            f"expected a number of seconds, got {type(value).__name__}",
        )
    if value <= 0:
        raise ContractError(
            f"{path}.{key}" if path else key,
            f"{value} is not a time budget. A budget of zero returns whatever the first "
            "propagation produced and calls it a roster.",
        )
    return float(value)


def _optional_positive_int(obj: dict[str, Any], key: str, path: str) -> int | None:
    """A positive integer, or None when absent. H-12's monthly floor.

    Absent and null both mean "no floor", which is the honest default for a tenant who has
    not agreed one - inventing a minimum would roster people the practice never asked to
    roster.
    """
    value = obj.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractError(
            f"{path}.{key}" if path else key,
            f"expected an integer, got {type(value).__name__}",
        )
    if value < 0:
        raise ContractError(f"{path}.{key}" if path else key, f"{value} is negative")
    return value


def _hour(value: str, path: str) -> tuple[int, int]:
    """Parses "HH:MM" into (hour, minute).

    Shift boundaries in this practice are all on the hour, and the solver's Shift carries
    integer hours. A non-zero minute is therefore rejected rather than rounded - rounding
    a shift boundary changes who is on duty.
    """
    parts = value.split(":")
    if len(parts) != 2:
        raise ContractError(path, f'not a time: "{value}". Expected HH:MM.')
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except ValueError:
        raise ContractError(path, f'not a time: "{value}". Expected HH:MM.') from None
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        raise ContractError(path, f'time out of range: "{value}"')
    if minute != 0:
        raise ContractError(
            path,
            f'shift boundary "{value}" is not on the hour. The solver models integer hours; '
            "rounding a boundary would change who is on duty.",
        )
    return hour, minute


# ── Section parsers ──────────────────────────────────────────────────────────────────

_SHIFT_FIELDS = {"shiftId", "kind", "start", "end", "endsNextDay", "burdenWeight"}


def _parse_shift(payload: object, path: str) -> Shift:
    obj = _obj(payload, path)
    _reject_unknown(obj, _SHIFT_FIELDS, path)

    kind_raw = _str(obj, "kind", path)
    try:
        kind = ShiftKind(kind_raw)
    except ValueError:
        valid = ", ".join(k.value for k in ShiftKind)
        raise ContractError(
            f"{path}.kind", f'unknown shift kind "{kind_raw}". Expected: {valid}'
        ) from None

    start_hour, _ = _hour(_str(obj, "start", path), f"{path}.start")
    end_hour, _ = _hour(_str(obj, "end", path), f"{path}.end")
    ends_next_day = _bool(obj, "endsNextDay", path, default=False)

    # An overnight shift must say so. Without this, 23:00-07:00 parses as a -16 hour
    # shift and the burden arithmetic silently goes negative.
    if end_hour <= start_hour and not ends_next_day:
        raise ContractError(
            path,
            f"{_str(obj, 'shiftId', path)} ends at or before it starts "
            f"({start_hour:02d}:00-{end_hour:02d}:00) but endsNextDay is false",
        )

    # S-01's weight for this slot, resolved by the sender from its own burden schedule.
    # Semantic, so it does NOT get a silent default: a missing weight would price the slot at
    # zero and quietly exclude it from the fairness objective. Optional only in the sense that
    # a request omitting burdenWeights entirely disables S-01, which is checked in model.py.
    burden_weight = obj.get("burdenWeight", 0.0)
    if isinstance(burden_weight, bool) or not isinstance(burden_weight, (int, float)):
        raise ContractError(
            f"{path}.burdenWeight", f"expected a number, got {type(burden_weight).__name__}"
        )
    if burden_weight < 0:
        raise ContractError(
            f"{path}.burdenWeight",
            f"{burden_weight} is negative. A shift cannot reduce the burden a doctor has "
            "carried, and the objective would hand it out as a reward.",
        )

    return Shift(
        shift_id=_str(obj, "shiftId", path),
        kind=kind,
        start_hour=start_hour,
        end_hour=end_hour,
        ends_next_day=ends_next_day,
        burden_weight=float(burden_weight),
    )


_DAY_FIELDS = {"date", "patternId", "isPublicHoliday", "shifts"}


def _parse_day(payload: object, path: str) -> Day:
    obj = _obj(payload, path)
    _reject_unknown(obj, _DAY_FIELDS, path)

    shifts = _seq(_required(obj, "shifts", path), f"{path}.shifts")
    if not shifts:
        raise ContractError(
            f"{path}.shifts",
            "a day with no shifts is not a day off - it is a day with no cover. Send the "
            "shifts and let H-01 report the shortfall.",
        )

    parsed = tuple(
        _parse_shift(shift, f"{path}.shifts[{index}]") for index, shift in enumerate(shifts)
    )

    duplicates = sorted(
        {s.shift_id for s in parsed if [x.shift_id for x in parsed].count(s.shift_id) > 1}
    )
    if duplicates:
        raise ContractError(f"{path}.shifts", f"duplicate shiftId(s): {', '.join(duplicates)}")

    return Day(
        date=_date(_required(obj, "date", path), f"{path}.date"),
        pattern_id=_str(obj, "patternId", path),
        is_public_holiday=_bool(obj, "isPublicHoliday", path, default=False),
        explicit_shifts=parsed,
    )


_DAY_CLASSES = {"weekday", "saturday", "sunday", "public-holiday"}

_DOCTOR_FIELDS = {
    "code",
    "availableFrom",
    "availableUntil",
    "staffCategory",
    "maxShiftsPerMonth",
    "cannotWork",
    "maxShiftsPerWeekend",
}


def _parse_doctors(
    payload: object, path: str
) -> tuple[
    list[str],
    dict[str, tuple[dt.date | None, dt.date | None]],
    dict[str, int],
    dict[str, frozenset[tuple[str, str]]],
    dict[str, int],
]:
    """Codes, plus each doctor's membership window for H-03.

    ⚠️ The window used to be validated here and then dropped on the floor, so H-03 -
    `[CONFIRMED]`, and the rule that stops a departed doctor being rostered - was not
    enforced anywhere. Returning it is the fix; ``model.py`` declines to create the
    assignment variable outside it.
    """
    entries = _seq(payload, path)
    if not entries:
        raise ContractError(path, "no doctors. Nothing can be rostered.")

    codes: list[str] = []
    membership: dict[str, tuple[dt.date | None, dt.date | None]] = {}
    maxima: dict[str, int] = {}
    exclusions: dict[str, frozenset[tuple[str, str]]] = {}
    weekend_caps: dict[str, int] = {}
    for index, entry in enumerate(entries):
        item_path = f"{path}[{index}]"
        obj = _obj(entry, item_path)
        _reject_unknown(obj, _DOCTOR_FIELDS, item_path)
        code = _str(obj, "code", item_path)
        if code in codes:
            raise ContractError(item_path, f'duplicate doctor code "{code}"')
        codes.append(code)

        available_from = _optional_date(obj, "availableFrom", item_path)
        available_until = _optional_date(obj, "availableUntil", item_path)
        if (
            available_from is not None
            and available_until is not None
            and available_until < available_from
        ):
            raise ContractError(
                item_path,
                f'"{code}" has availableUntil {available_until.isoformat()} before '
                f"availableFrom {available_from.isoformat()}. A membership window that "
                "closes before it opens would silently make this doctor unrosterable.",
            )
        membership[code] = (available_from, available_until)

        # H-12. Absent means no ceiling, which is the common case - most doctors here have
        # none. Zero is refused rather than accepted as "never roster them": a doctor who
        # cannot work at all is expressed by their membership window, not by a ceiling of 0,
        # and accepting it here would give two ways to say one thing.
        maximum = obj.get("maxShiftsPerMonth")
        if maximum is not None:
            if isinstance(maximum, bool) or not isinstance(maximum, int):
                raise ContractError(
                    f"{item_path}.maxShiftsPerMonth",
                    f"expected an integer, got {type(maximum).__name__}",
                )
            if maximum < 1:
                raise ContractError(
                    f"{item_path}.maxShiftsPerMonth",
                    f"{maximum} is not a ceiling. A doctor who should not be rostered at "
                    "all is expressed by availableUntil, not by a maximum of zero.",
                )
            maxima[code] = maximum

        # H-11. Forbidden (day class, shift kind) cells, as the principal listed them.
        cells = obj.get("cannotWork")
        if cells is not None:
            pairs: set[tuple[str, str]] = set()
            for index, cell in enumerate(_seq(cells, f"{item_path}.cannotWork")):
                cell_path = f"{item_path}.cannotWork[{index}]"
                cell_obj = _obj(cell, cell_path)
                _reject_unknown(cell_obj, {"dayClass", "shiftKind"}, cell_path)
                day_class = _str(cell_obj, "dayClass", cell_path)
                if day_class not in _DAY_CLASSES:
                    raise ContractError(
                        f"{cell_path}.dayClass",
                        f'"{day_class}" is not a day class. '
                        f"Expected one of: {', '.join(sorted(_DAY_CLASSES))}.",
                    )
                kind = _str(cell_obj, "shiftKind", cell_path)
                try:
                    ShiftKind(kind)
                except ValueError:
                    raise ContractError(
                        f"{cell_path}.shiftKind", f'"{kind}" is not a shift kind'
                    ) from None
                pairs.add((day_class, kind))
            if pairs:
                exclusions[code] = frozenset(pairs)

        per_weekend = obj.get("maxShiftsPerWeekend")
        if per_weekend is not None:
            if isinstance(per_weekend, bool) or not isinstance(per_weekend, int):
                raise ContractError(
                    f"{item_path}.maxShiftsPerWeekend",
                    f"expected an integer, got {type(per_weekend).__name__}",
                )
            if per_weekend < 0:
                raise ContractError(f"{item_path}.maxShiftsPerWeekend", "is negative")
            weekend_caps[code] = per_weekend
    return codes, membership, maxima, exclusions, weekend_caps


_AVAILABILITY_FIELDS = {"doctorCode", "rules", "derivedFrom"}
_RULE_FIELDS = {"kind", "hour", "exceptWeekdays"}
_DERIVED_FROM_FIELDS = {"shiftsObserved", "contradictions"}


def _parse_availability(payload: object, path: str, known: set[str]) -> dict[str, AvailabilityRule]:
    """H-10. One rule per doctor for now - the only kind the domain has produced.

    Modelled as a LIST of rules on the wire even though the solver holds one, because the
    shape that will actually arrive next is a second rule ("not Wednesdays at all"), and a
    list absorbs that without a contract bump. Parsing more than one is refused loudly
    rather than silently taking the first.
    """
    result: dict[str, AvailabilityRule] = {}
    for index, entry in enumerate(_seq(payload, path)):
        item_path = f"{path}[{index}]"
        obj = _obj(entry, item_path)
        _reject_unknown(obj, _AVAILABILITY_FIELDS, item_path)

        doctor = _str(obj, "doctorCode", item_path)
        if doctor not in known:
            raise ContractError(
                f"{item_path}.doctorCode",
                f'"{doctor}" is not in this request\'s doctors. Availability for a doctor '
                "who cannot be rostered is either a stale record or the wrong request.",
            )
        if doctor in result:
            raise ContractError(item_path, f'duplicate availability for "{doctor}"')

        if "derivedFrom" in obj:
            _reject_unknown(
                _obj(obj["derivedFrom"], f"{item_path}.derivedFrom"),
                _DERIVED_FROM_FIELDS,
                f"{item_path}.derivedFrom",
            )

        rules = _seq(_required(obj, "rules", item_path), f"{item_path}.rules")
        if len(rules) != 1:
            raise ContractError(
                f"{item_path}.rules",
                f"expected exactly one rule, got {len(rules)}. The solver models a single "
                "NO_WEEKDAY_BEFORE rule per doctor; a second kind needs a contract change, "
                "not a silently dropped rule.",
            )

        rule_path = f"{item_path}.rules[0]"
        rule = _obj(rules[0], rule_path)
        _reject_unknown(rule, _RULE_FIELDS, rule_path)

        kind = _str(rule, "kind", rule_path)
        if kind != "NO_WEEKDAY_BEFORE":
            raise ContractError(
                f"{rule_path}.kind",
                f'unknown availability rule kind "{kind}". Expected NO_WEEKDAY_BEFORE.',
            )

        hour = _int(rule, "hour", rule_path)
        if not 0 <= hour <= 23:
            raise ContractError(f"{rule_path}.hour", f"out of range: {hour}. Expected 0-23.")

        names = _seq(rule.get("exceptWeekdays", []), f"{rule_path}.exceptWeekdays")
        for name in names:
            if not isinstance(name, str):
                raise ContractError(
                    f"{rule_path}.exceptWeekdays",
                    f"weekdays cross the wire as NAMES, not integers - got "
                    f"{type(name).__name__}. MONDAY is 0 here and 1 in TypeScript; an "
                    "integer would silently mean the wrong day. See wire.py.",
                )
        try:
            except_weekdays = weekdays_from_names([str(name) for name in names])
        except ValueError as error:
            raise ContractError(f"{rule_path}.exceptWeekdays", str(error)) from None

        result[doctor] = AvailabilityRule(hour=hour, except_weekdays=except_weekdays)
    return result


_PREFERENCE_FIELDS = {"doctorCode", "type", "tentative", "dates", "shiftIds", "sourceToken"}


def _parse_preferences(payload: object, path: str, known: set[str]) -> list[Preference]:
    preferences: list[Preference] = []
    for index, entry in enumerate(_seq(payload, path)):
        item_path = f"{path}[{index}]"
        obj = _obj(entry, item_path)
        _reject_unknown(obj, _PREFERENCE_FIELDS, item_path)

        doctor = _str(obj, "doctorCode", item_path)
        if doctor not in known:
            raise ContractError(
                f"{item_path}.doctorCode", f'"{doctor}" is not in this request\'s doctors'
            )

        type_raw = _str(obj, "type", item_path)
        try:
            preference_type = PreferenceType(type_raw)
        except ValueError:
            valid = ", ".join(t.value for t in PreferenceType)
            raise ContractError(
                f"{item_path}.type", f'unknown type "{type_raw}". Expected: {valid}'
            ) from None

        tentative = _bool(obj, "tentative", item_path, default=False)
        if tentative and preference_type is PreferenceType.MUST:
            # `tentative` is "if necessary" [CONFIRMED 2026-09-04]; MUST is a commitment the
            # doctor has already made. A commitment made only if necessary is not one, and
            # every reading of it rosters somebody against what they actually said - so this
            # is refused rather than resolved. Rule 4: no silent default for anything
            # semantic.
            raise ContractError(
                item_path,
                'a MUST cannot be tentative. "tentative" means "if necessary" and a MUST is '
                "a commitment already made. Send PREFER with tentative, or MUST without it.",
            )

        dates = _seq(_required(obj, "dates", item_path), f"{item_path}.dates")
        if not dates:
            raise ContractError(f"{item_path}.dates", "a preference with no dates has no meaning")

        shift_ids_raw = obj.get("shiftIds")
        shift_ids = (
            None
            if shift_ids_raw is None
            else frozenset(_seq(shift_ids_raw, f"{item_path}.shiftIds"))
        )

        source_token = obj.get("sourceToken")
        if source_token is not None and not isinstance(source_token, str):
            raise ContractError(f"{item_path}.sourceToken", "expected a string or null")

        preferences.append(
            Preference(
                doctor=doctor,
                type=preference_type,
                dates=frozenset(
                    _date(date, f"{item_path}.dates[{date_index}]")
                    for date_index, date in enumerate(dates)
                ),
                shift_ids=shift_ids,
                tentative=tentative,
                source_token=source_token,
            )
        )
    return preferences


_SLOT_FIELDS = {"doctorCode", "weekday", "shiftId", "validFrom", "validUntil"}


def _parse_recurring_slots(payload: object, path: str, known: set[str]) -> list[RecurringSlot]:
    slots: list[RecurringSlot] = []
    for index, entry in enumerate(_seq(payload, path)):
        item_path = f"{path}[{index}]"
        obj = _obj(entry, item_path)
        _reject_unknown(obj, _SLOT_FIELDS, item_path)

        doctor = _str(obj, "doctorCode", item_path)
        if doctor not in known:
            raise ContractError(
                f"{item_path}.doctorCode", f'"{doctor}" is not in this request\'s doctors'
            )

        weekday_raw = _required(obj, "weekday", item_path)
        if not isinstance(weekday_raw, str):
            raise ContractError(
                f"{item_path}.weekday",
                f"weekdays cross the wire as NAMES, not integers - got "
                f"{type(weekday_raw).__name__}. MONDAY is 0 here and 1 in TypeScript. See wire.py.",
            )
        try:
            weekday = weekday_from_name(weekday_raw)
        except ValueError as error:
            raise ContractError(f"{item_path}.weekday", str(error)) from None

        valid_from = obj.get("validFrom")
        valid_until = obj.get("validUntil")
        parsed_from = None if valid_from is None else _date(valid_from, f"{item_path}.validFrom")
        parsed_until = (
            None if valid_until is None else _date(valid_until, f"{item_path}.validUntil")
        )
        if parsed_from is not None and parsed_until is not None and parsed_until < parsed_from:
            raise ContractError(
                item_path, f"validUntil {parsed_until} precedes validFrom {parsed_from}"
            )

        slots.append(
            RecurringSlot(
                doctor=doctor,
                weekday=weekday,
                shift_id=_str(obj, "shiftId", item_path),
                valid_from=parsed_from,
                valid_until=parsed_until,
            )
        )
    return slots


_SLOT_SHARE_FIELDS = {"doctorCode", "weekday", "shiftId", "share"}


def _parse_slot_shares(
    payload: object, path: str, known: set[str], anchored: set[tuple[int, str]]
) -> list[SlotShare]:
    """S-09, contract 1.7.0."""
    shares: list[SlotShare] = []
    for index, entry in enumerate(_seq(payload, path)):
        item_path = f"{path}[{index}]"
        obj = _obj(entry, item_path)
        _reject_unknown(obj, _SLOT_SHARE_FIELDS, item_path)

        doctor = _str(obj, "doctorCode", item_path)
        if doctor not in known:
            raise ContractError(
                f"{item_path}.doctorCode", f'"{doctor}" is not in this request\'s doctors'
            )

        weekday_raw = _required(obj, "weekday", item_path)
        if not isinstance(weekday_raw, str):
            raise ContractError(
                f"{item_path}.weekday",
                f"weekdays cross the wire as NAMES, not integers - got "
                f"{type(weekday_raw).__name__}. MONDAY is 0 here and 1 in TypeScript. See wire.py.",
            )
        try:
            weekday = weekday_from_name(weekday_raw)
        except ValueError as error:
            raise ContractError(f"{item_path}.weekday", str(error)) from None

        share_raw = _required(obj, "share", item_path)
        if isinstance(share_raw, bool) or not isinstance(share_raw, (int, float)):
            raise ContractError(f"{item_path}.share", "expected a number")
        if not 0 < share_raw <= 1:
            raise ContractError(f"{item_path}.share", f"expected (0, 1], got {share_raw}")

        shift_id = _str(obj, "shiftId", item_path)
        if (weekday, shift_id) in anchored:
            raise ContractError(
                item_path,
                f'"{shift_id}" on that weekday already has a recurring slot. S-05 and S-09 '
                "partition the slots; sending both prices it twice.",
            )

        shares.append(
            SlotShare(doctor=doctor, weekday=weekday, shift_id=shift_id, share=float(share_raw))
        )
    return shares


_ASSIGNMENT_REF_FIELDS = {"date", "shiftId", "doctorCode"}


def _parse_assignment_refs(payload: object, path: str) -> list[AssignmentRef]:
    """Parse ``previousPublished`` or ``lockedAssignments``. Same shape, same parser.

    **Deliberately does not take the request's doctor set.** Unlike every sibling parser
    here, a doctor code is NOT required to be in this request's doctors: a published
    roster that named a doctor who has since left is a legitimate input, and rejecting it
    would make the last month before a departure unsolvable. The model skips those refs
    and reports how many it skipped.

    Two refs for the same slot IS rejected. The published roster had one doctor in each
    slot; two means the caller built the payload wrong, and silently keeping the last one
    would make the churn penalty quietly wrong rather than loudly absent.
    """
    refs: list[AssignmentRef] = []
    seen: set[tuple[dt.date, str]] = set()
    for index, entry in enumerate(_seq(payload, path)):
        item_path = f"{path}[{index}]"
        obj = _obj(entry, item_path)
        _reject_unknown(obj, _ASSIGNMENT_REF_FIELDS, item_path)

        date = _date(_required(obj, "date", item_path), f"{item_path}.date")
        shift_id = _str(obj, "shiftId", item_path)
        slot = (date, shift_id)
        if slot in seen:
            raise ContractError(item_path, f"duplicate slot {date} {shift_id}")
        seen.add(slot)

        refs.append(
            AssignmentRef(date=date, shift_id=shift_id, doctor=_str(obj, "doctorCode", item_path))
        )
    return refs


_LEDGER_FIELDS = {
    "doctorCode",
    "cumulativeBurden",
    "entitlement",
    "holidayBurden",
    "holidayEntitlement",
}


def _parse_burden_weights(payload: object, path: str) -> dict[str, float]:
    """S-01's weight table. A flat object of `key -> number`.

    A negative weight is refused rather than clamped: it would make a shift *reduce* a
    doctor's burden, and the objective would then hand that shift out as a reward.
    """
    obj = _obj(payload, path)
    weights: dict[str, float] = {}
    for key, value in obj.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ContractError(f"{path}.{key}", f"expected a number, got {type(value).__name__}")
        if value < 0:
            raise ContractError(
                f"{path}.{key}",
                f"burden weight {value} is negative. A shift cannot reduce the burden a "
                "doctor has carried, and the objective would treat it as a reward.",
            )
        weights[key] = float(value)
    return weights


def _parse_burden_ledger(
    payload: object, path: str, known: set[str]
) -> tuple[dict[str, tuple[float, float]], dict[str, tuple[float, float]]]:
    """S-01's carry-in: burden each doctor held before this month.

    A doctor not in this request's roll IS rejected here, unlike previousPublished. The
    difference is what the number does: a stale ledger row is silently excluded from the
    fairness denominator, so the month looks fair while the person it was about is missing.
    A stale published assignment merely fails to match a slot.
    """
    ledger: dict[str, tuple[float, float]] = {}
    holiday_ledger: dict[str, tuple[float, float]] = {}
    for index, entry in enumerate(_seq(payload, path)):
        item_path = f"{path}[{index}]"
        obj = _obj(entry, item_path)
        _reject_unknown(obj, _LEDGER_FIELDS, item_path)

        doctor = _str(obj, "doctorCode", item_path)
        if doctor not in known:
            raise ContractError(
                f"{item_path}.doctorCode", f'"{doctor}" is not in this request\'s doctors'
            )
        if doctor in ledger:
            raise ContractError(item_path, f'duplicate ledger entry for "{doctor}"')

        carried = _required(obj, "cumulativeBurden", item_path)
        if isinstance(carried, bool) or not isinstance(carried, (int, float)):
            raise ContractError(
                f"{item_path}.cumulativeBurden",
                f"expected a number, got {type(carried).__name__}",
            )
        if carried < 0:
            raise ContractError(
                f"{item_path}.cumulativeBurden", f"{carried} is negative; burden cannot be undone"
            )
        entitlement = _required(obj, "entitlement", item_path)
        if isinstance(entitlement, bool) or not isinstance(entitlement, (int, float)):
            raise ContractError(
                f"{item_path}.entitlement",
                f"expected a number, got {type(entitlement).__name__}",
            )
        if entitlement < 0:
            raise ContractError(
                f"{item_path}.entitlement",
                f"{entitlement} is negative. It is the burden of what this doctor COULD have "
                "worked, which cannot be less than nothing.",
            )
        ledger[doctor] = (float(carried), float(entitlement))

        # S-08's holiday carry-in, over a TWELVE-month span rather than S-01's three.
        #
        # ⚠️ Both halves or neither. One alone is the dimensional error that produced a wrong
        # roster on 2 September 2026 - a cumulative burden divided by a denominator covering a
        # different span reads as an enormous imbalance and the objective acts on it.
        holiday_burden = obj.get("holidayBurden")
        holiday_entitlement = obj.get("holidayEntitlement")
        if (holiday_burden is None) != (holiday_entitlement is None):
            raise ContractError(
                item_path,
                "holidayBurden and holidayEntitlement must be sent together or not at all. "
                "A holiday burden without its own denominator is dimensionally wrong, and "
                "S-08 would read it as a large imbalance and act on it.",
            )
        if holiday_burden is not None and holiday_entitlement is not None:
            for key, value in (
                ("holidayBurden", holiday_burden),
                ("holidayEntitlement", holiday_entitlement),
            ):
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise ContractError(
                        f"{item_path}.{key}",
                        f"expected a number, got {type(value).__name__}",
                    )
                if value < 0:
                    raise ContractError(f"{item_path}.{key}", f"{value} is negative")
            holiday_ledger[doctor] = (float(holiday_burden), float(holiday_entitlement))
    return ledger, holiday_ledger


_CONSTRAINT_FIELDS = {"id", "mode", "weight"}
_MODES = {"BLOCK", "WARN", "OFF"}


def _parse_flags(payload: object, path: str) -> FeatureFlags:
    """Constraint modes are DATA. A confirmed answer flips a switch, never a rewrite.

    Only the flagged constraints are read here. The rest carry their weights in the
    penalty registry, which is built at model time - this function is deliberately not a
    general weight override mechanism, because a per-request weight would let a caller
    reorder the tier hierarchy and that hierarchy is the safety property.
    """
    flags = FeatureFlags()
    seen: set[str] = set()
    for index, entry in enumerate(_seq(payload, path)):
        item_path = f"{path}[{index}]"
        obj = _obj(entry, item_path)
        _reject_unknown(obj, _CONSTRAINT_FIELDS, item_path)

        constraint_id = _str(obj, "id", item_path)
        if constraint_id in seen:
            raise ContractError(item_path, f'duplicate constraint "{constraint_id}"')
        seen.add(constraint_id)

        mode = _str(obj, "mode", item_path)
        if mode not in _MODES:
            raise ContractError(
                f"{item_path}.mode", f'unknown mode "{mode}". Expected: BLOCK, WARN, OFF.'
            )

        if constraint_id == "H-07":
            flags.h07_d01_never_pattern_b = mode != "OFF"
        elif constraint_id == "S-05":
            flags.s05_prefer_anchor_in_slot = mode != "OFF"
        elif constraint_id == "S-06":
            flags.s06_minimise_churn = mode != "OFF"
        elif constraint_id == "S-01":
            flags.s01_equalise_cumulative_burden = mode != "OFF"
        elif constraint_id == "S-09":
            flags.s09_hold_slot_share = mode != "OFF"
    return flags


# ── The entry point ──────────────────────────────────────────────────────────────────

_REQUEST_FIELDS = {
    "contractVersion",
    "solveRunId",
    "tenantId",
    "rosterId",
    "horizon",
    "timeBudgetSeconds",
    "doctors",
    "days",
    "availability",
    "preferences",
    "recurringSlots",
    "slotShares",
    "burdenLedger",
    "burdenWeights",
    "constraints",
    "lockedAssignments",
    "previousPublished",
    "monthlyMinimumShifts",
}
_HORIZON_FIELDS = {"start", "end"}


def parse_request(payload: object) -> Instance:
    """Parse a solve request into an Instance, or raise ContractError.

    Never partially applied: either the whole request is trustworthy or nothing is built.

    ⚠️ EVERY FIELD THIS PARSER ACCEPTS NOW REACHES THE MODEL, as of 6 September 2026 - and
    keeping it that way is the point of this note.

    This docstring used to list what was "validated but not yet consumed", on the reasoning
    that a checked shape is proven for the day the model wants it. The reasoning is sound and
    the list was the most expensive thing in the project: burdenLedger and burdenWeights sat
    on it until S-01 was built (2026-09-02), previousPublished until S-06 the same day,
    lockedAssignments until H-13, and H-03's membership dates were parsed and DISCARDED for
    weeks without appearing on it at all.

    A field that is accepted and unused is indistinguishable, from the sender's side, from
    one that is honoured. If something is added here that the model does not read, say so
    HERE and open a question - and check `contract:check`, which as of 2026-09-06 also fails
    when the parser accepts a nested field the fixture and the spec never show.
    """
    obj = _obj(payload, "")
    _reject_unknown(obj, _REQUEST_FIELDS, "")

    version = _str(obj, "contractVersion", "")
    major = version.split(".")[0]
    if major != str(SUPPORTED_MAJOR):
        raise ContractError(
            "contractVersion",
            f'"{version}" is not supported. This solver reads {SUPPORTED_MAJOR}.x. A major '
            "bump means a breaking change, so refusing is correct - a 2.x request parsed "
            "by 1.x rules would produce a plausible, wrong roster.",
        )

    horizon = _obj(_required(obj, "horizon", ""), "horizon")
    _reject_unknown(horizon, _HORIZON_FIELDS, "horizon")
    start = _date(_required(horizon, "start", "horizon"), "horizon.start")
    end = _date(_required(horizon, "end", "horizon"), "horizon.end")
    if end < start:
        raise ContractError("horizon", f"end {end} precedes start {start}")

    doctors, membership, maxima, exclusions, weekend_caps = _parse_doctors(
        _required(obj, "doctors", ""), "doctors"
    )
    known = set(doctors)
    burden_ledger, holiday_ledger = _parse_burden_ledger(
        obj.get("burdenLedger", []), "burdenLedger", known
    )

    day_entries = _seq(_required(obj, "days", ""), "days")
    if not day_entries:
        raise ContractError("days", "no days. There is nothing to solve.")
    days = [_parse_day(entry, f"days[{index}]") for index, entry in enumerate(day_entries)]

    seen_dates: set[dt.date] = set()
    for day in days:
        if day.date in seen_dates:
            raise ContractError("days", f"duplicate date {day.date}")
        seen_dates.add(day.date)
        # A day outside the horizon is a caller bug, and a silently solved one would
        # publish a roster covering dates the admin did not ask about.
        if not start <= day.date <= end:
            raise ContractError("days", f"{day.date} is outside the horizon {start}..{end}")

    # H-13. Structurally hard, so the two ways a lock could make the instance unsatisfiable
    # are refused HERE, where the error can name the offending field — rather than in the
    # model, where the same problem would surface as an ERROR status with nothing to point
    # at. (Two locks on one slot is already refused inside _parse_assignment_refs.)
    locked = _parse_assignment_refs(obj.get("lockedAssignments", []), "lockedAssignments")
    known_dates = {day.date for day in days}
    for index, ref in enumerate(locked):
        item_path = f"lockedAssignments[{index}]"
        if ref.doctor not in known:
            raise ContractError(
                f"{item_path}.doctorCode",
                f'"{ref.doctor}" is not in this request\'s doctors. A lock names a specific '
                "person and cannot be skipped the way previousPublished can.",
            )
        if ref.date not in known_dates:
            raise ContractError(f"{item_path}.date", f"{ref.date} is not a day in this request")
        day = next(d for d in days if d.date == ref.date)
        if not any(shift.shift_id == ref.shift_id for shift in day.shifts):
            raise ContractError(
                f"{item_path}.shiftId",
                f'{ref.date} has no shift "{ref.shift_id}". A day\'s shifts are a property '
                "of the date, so this may be the wrong pattern rather than a typo.",
            )
        available_from, available_until = membership.get(ref.doctor, (None, None))
        if (available_from is not None and ref.date < available_from) or (
            available_until is not None and ref.date > available_until
        ):
            raise ContractError(
                item_path,
                f"{ref.doctor} is not a member of the practice on {ref.date}. H-03 removes "
                "the assignment entirely, so there is nothing to lock — and silently "
                "dropping the lock is the worst option available.",
            )

    # Bound before the Instance because _parse_slot_shares needs the anchored slots to
    # enforce the S-05/S-09 partition. The TypeScript builder refuses the overlap too; this
    # side refuses it independently because the parser is the authority on a valid request.
    recurring_slots = _parse_recurring_slots(obj.get("recurringSlots", []), "recurringSlots", known)

    return Instance(
        doctors=doctors,
        days=days,
        membership=membership,
        monthly_maximum_shifts=maxima,
        cell_exclusions=exclusions,
        max_shifts_per_weekend=weekend_caps,
        time_budget_seconds=_optional_budget(obj, "timeBudgetSeconds", ""),
        monthly_minimum_shifts=_optional_positive_int(obj, "monthlyMinimumShifts", ""),
        recurring_slots=recurring_slots,
        slot_shares=_parse_slot_shares(
            obj.get("slotShares", []),
            "slotShares",
            known,
            {(slot.weekday, slot.shift_id) for slot in recurring_slots},
        ),
        preferences=_parse_preferences(obj.get("preferences", []), "preferences", known),
        availability=_parse_availability(obj.get("availability", []), "availability", known),
        previous_published=_parse_assignment_refs(
            obj.get("previousPublished", []), "previousPublished"
        ),
        locked_assignments=locked,
        burden_weights=_parse_burden_weights(obj.get("burdenWeights", {}), "burdenWeights"),
        burden_ledger=burden_ledger,
        holiday_ledger=holiday_ledger,
        flags=_parse_flags(obj.get("constraints", []), "constraints"),
    )
