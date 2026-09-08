"""The penalty registry.

Built from the first line of the model, deliberately. Every explanation feature, the
cost breakdown, the counterfactual "what if" mode and the infeasibility narrative are
projections of this one list. CP-SAT gives you nothing equivalent, so you build it - and
retrofitting it is painful, which is why it exists before any constraint does.

The shape is fixed by ``docs/architecture/solver-contract.md``:

    (constraint_name, entity_refs, slack_var, weight)

Penalty tiers are order-of-magnitude separated so that tiers cannot trade against each
other. One coverage violation must always cost more than any number of preference
violations, or the solver will cheerfully leave a shift uncovered to make thirteen people
happy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any

from ortools.sat.python import cp_model

# A CP-SAT variable or literal whose solved value is a violation magnitude.
type SlackVar = cp_model.IntVar | cp_model.BoolVarT


class Tier(IntEnum):
    """Order-of-magnitude penalty tiers. See docs/domain/constraints.md."""

    COVERAGE = 1_000_000
    LEGAL = 10_000
    CONTRACT = 100
    PREFERENCE = 1


@dataclass(frozen=True)
class PenaltyEntry:
    """One elasticised constraint's slack, recorded as the model is built."""

    constraint_id: str
    """The catalogued ID: H-01, S-03. Appears in tests and in the UI."""

    description: str
    """Plain language, addressed to a non-technical doctor - not to a developer."""

    entity_refs: dict[str, Any]
    """What this violation is *about*: doctor code, date, shift id."""

    slack_var: SlackVar
    """The CP-SAT variable or literal whose value is the violation magnitude."""

    weight: int
    """tier * relative weight."""

    tier: Tier


@dataclass
class PenaltyRegistry:
    """Accumulates penalty entries during model construction."""

    entries: list[PenaltyEntry] = field(default_factory=list)

    def add(
        self,
        constraint_id: str,
        description: str,
        entity_refs: dict[str, Any],
        slack_var: SlackVar,
        tier: Tier,
        relative_weight: int = 1,
    ) -> None:
        self.entries.append(
            PenaltyEntry(
                constraint_id=constraint_id,
                description=description,
                entity_refs=entity_refs,
                slack_var=slack_var,
                weight=int(tier) * relative_weight,
                tier=tier,
            )
        )

    def objective_terms(self) -> list[tuple[SlackVar, int]]:
        """``(variable, weight)`` pairs to minimise. The whole objective, nothing else."""
        return [(entry.slack_var, entry.weight) for entry in self.entries]

    def violations(self, solver: cp_model.CpSolver) -> list[dict[str, Any]]:
        """Non-zero slacks after a solve, shaped like the contract's ``violations`` array.

        This is the method that makes the registry worth having: every violation is
        attributable to a catalogued constraint, a specific doctor and a specific date,
        with a message a human can read - and none of that had to be written twice.
        """
        found: list[dict[str, Any]] = []
        for entry in self.entries:
            value = solver.value(entry.slack_var)
            if value:
                found.append(
                    {
                        "constraintId": entry.constraint_id,
                        "entityRefs": entry.entity_refs,
                        "slackValue": int(value),
                        "weight": entry.weight,
                        "cost": int(value) * entry.weight,
                        "message": entry.description,
                    }
                )
        return sorted(found, key=lambda violation: -violation["cost"])

    def cost_by_tier(self, solver: cp_model.CpSolver) -> dict[str, int]:
        """The objective broken down by tier - the first thing to read when a solve looks wrong."""
        totals = {tier.name.lower(): 0 for tier in Tier}
        for entry in self.entries:
            value = solver.value(entry.slack_var)
            if value:
                totals[entry.tier.name.lower()] += int(value) * entry.weight
        return totals
