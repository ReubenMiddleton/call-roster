"""Sequence-constraint primitives, lifted from OR-Tools' ``shift_scheduling_sat.py``.

These three functions are the hard-won part of CP-SAT rostering and are reproduced here
essentially verbatim (Apache-2.0, Google OR-Tools examples). Do not rewrite them.

Why they matter more than they look
-----------------------------------
They give you "night blocks of 2-3 are fine, 1 costs you, 4+ is illegal" as a single
reusable primitive. Almost every rostering constraint is that shape with different
parameters:

    "no night followed by a morning"        -> a forbidden span of length 2
    "at most 2 consecutive nights"          -> hard max on a soft sequence
    "no isolated working day"               -> soft min of 2 on the working sequence
    "complete weekends"                     -> soft sequence over Sat/Sun pairs

Curtois & Qu's formulation collapses the whole constraint zoo into one idea: a regular
expression over one doctor's roster line, with min and max match counts. That is what
these implement. One UI affordance, one solver encoding, one test suite - instead of
fifteen of each.

Every soft variant returns its slack variables and weights so the caller can record
them in the penalty registry. Nothing here penalises anything by itself.
"""

from __future__ import annotations

from collections.abc import Sequence

from ortools.sat.python import cp_model


def negated_bounded_span(
    works: Sequence[cp_model.BoolVarT],
    start: int,
    length: int,
) -> list[cp_model.BoolVarT]:
    """Literals that are all false iff a span of exactly ``length`` shifts starts at ``start``.

    Filters an isolated sub-sequence of variables assumed to be all true. Extracts the
    span of Boolean variables ``[start, start + length)``, negates them, and if
    ``start > 0`` and ``start + length < len(works)`` adds the surrounding negated
    variables to bound the span.

    The returned list is a clause: adding ``AddBoolOr`` over it forbids exactly that
    span, leaving longer spans permitted. That asymmetry is the whole trick.
    """
    sequence: list[cp_model.BoolVarT] = []
    # left border, or nothing if the span starts at the beginning of the horizon
    if start > 0:
        sequence.append(works[start - 1])
    sequence.extend(~works[i] for i in range(start, start + length))
    # right border, or nothing if the span ends at the end of the horizon
    if start + length < len(works):
        sequence.append(works[start + length])
    return sequence


def add_soft_sequence_constraint(
    model: cp_model.CpModel,
    works: Sequence[cp_model.BoolVarT],
    hard_min: int,
    soft_min: int,
    min_cost: int,
    soft_max: int,
    hard_max: int,
    max_cost: int,
    prefix: str,
) -> tuple[list[cp_model.BoolVarT], list[int]]:
    """Constrain the length of every true sub-sequence in ``works``.

    Sequences shorter than ``hard_min`` or longer than ``hard_max`` are forbidden
    outright. Sequences between ``hard_min`` and ``soft_min`` cost ``min_cost`` per unit
    below ``soft_min``; sequences between ``soft_max`` and ``hard_max`` cost ``max_cost``
    per unit above ``soft_max``.

    Returns the penalty literals and their coefficients, for the caller to record in the
    penalty registry and add to the objective.
    """
    cost_literals: list[cp_model.BoolVarT] = []
    cost_coefficients: list[int] = []

    # Forbid sequences that are too short.
    for length in range(1, hard_min):
        for start in range(len(works) - length + 1):
            model.add_bool_or(negated_bounded_span(works, start, length))

    # Penalise sequences that are below the soft limit.
    if min_cost > 0:
        for length in range(hard_min, soft_min):
            for start in range(len(works) - length + 1):
                span = negated_bounded_span(works, start, length)
                name = f": under_span(start={start}, length={length})"
                lit = model.new_bool_var(prefix + name)
                span.append(lit)
                model.add_bool_or(span)
                cost_literals.append(lit)
                # The cost is a linear function of the distance below soft_min, so
                # the sum of the cost literals is a valid lower bound on the true cost.
                cost_coefficients.append(min_cost * (soft_min - length))

    # Penalise sequences that are above the soft limit.
    if max_cost > 0:
        for length in range(soft_max + 1, hard_max + 1):
            for start in range(len(works) - length + 1):
                span = negated_bounded_span(works, start, length)
                name = f": over_span(start={start}, length={length})"
                lit = model.new_bool_var(prefix + name)
                span.append(lit)
                model.add_bool_or(span)
                cost_literals.append(lit)
                cost_coefficients.append(max_cost * (length - soft_max))

    # Forbid sequences that are too long.
    for start in range(len(works) - hard_max):
        model.add_bool_or([~works[i] for i in range(start, start + hard_max + 1)])

    return cost_literals, cost_coefficients


def add_soft_sum_constraint(
    model: cp_model.CpModel,
    works: Sequence[cp_model.BoolVarT],
    hard_min: int,
    soft_min: int,
    min_cost: int,
    soft_max: int,
    hard_max: int,
    max_cost: int,
    prefix: str,
) -> tuple[list[cp_model.IntVar], list[int]]:
    """Constrain the sum of ``works`` to lie in ``[hard_min, hard_max]``, with soft bounds.

    Anything below ``soft_min`` or above ``soft_max`` is penalised linearly. Used for
    "how many nights this month", "how many weekends", and every FTE-style target.

    Returns the penalty variables and their coefficients.
    """
    cost_variables: list[cp_model.IntVar] = []
    cost_coefficients: list[int] = []
    sum_var = model.new_int_var(hard_min, hard_max, "")
    model.add(sum_var == sum(works))

    # Penalise the sum being below the soft minimum.
    if soft_min > hard_min and min_cost > 0:
        delta = model.new_int_var(-len(works), len(works), "")
        model.add(delta == soft_min - sum_var)
        excess = model.new_int_var(0, 7, prefix + ": under_sum")
        model.add_max_equality(excess, [delta, 0])
        cost_variables.append(excess)
        cost_coefficients.append(min_cost)

    # Penalise the sum being above the soft maximum.
    if soft_max < hard_max and max_cost > 0:
        delta = model.new_int_var(-len(works), len(works), "")
        model.add(delta == sum_var - soft_max)
        excess = model.new_int_var(0, 7, prefix + ": over_sum")
        model.add_max_equality(excess, [delta, 0])
        cost_variables.append(excess)
        cost_coefficients.append(max_cost)

    return cost_variables, cost_coefficients


# ── Burden classification. S-01. ──────────────────────────────────────────────────────

SATURDAY_PY = 5
SUNDAY_PY = 6
"""⚠️ Python's date.weekday() is MONDAY=0, so Saturday is 5 and Sunday is 6.

TypeScript's Date.getUTCDay() is SUNDAY=0, so there Saturday is 6 and Sunday is 0. Both
are correct and neither can change; naming these constants is how the difference stops
being a two-character typo that silently prices Sundays as Saturdays. See wire.py.
"""


def burden_key(is_public_holiday: bool, weekday: int, is_night: bool) -> str:
    """The contract's burdenWeights key for one slot.

    ⚠️ SATURDAY AND SUNDAY OUTRANK A PUBLIC HOLIDAY, which is not the obvious ordering and
    is not an oversight. The principal was asked directly and answered that a holiday on a
    Saturday "counts once as a Saturday, not a Saturday and a holiday." Ordering the checks
    the other way round would reprice every weekend holiday and quietly inflate the ledger
    for whoever worked them. This mirrors classifyDay in lib/analytics/shifts.ts.
    """
    if weekday == SATURDAY_PY:
        return "saturday"
    if weekday == SUNDAY_PY:
        return "sunday"
    if is_public_holiday:
        return "public_holiday"
    return "weekday_night" if is_night else "weekday_day"
