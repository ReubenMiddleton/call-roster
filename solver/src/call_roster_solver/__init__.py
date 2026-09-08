"""Throwaway CP-SAT prototype for the call roster. See solver/README.md."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from .contract import ContractError, parse_request
from .instance import Instance, ShiftKind, september_2026
from .model import BuiltModel, SolveResult, build, solve
from .preflight import PreflightResult, preflight
from .registry import PenaltyRegistry, Tier

__all__ = [
    "BuiltModel",
    "Instance",
    "PenaltyRegistry",
    "PreflightResult",
    "SolveResult",
    "Tier",
    "build",
    "main",
    "preflight",
    "september_2026",
    "solve",
]


def _solve_request_file(path: Path, budget: float | None, as_json: bool) -> int:
    """Parse a request file and solve it. The other half of the wire, exercised for real.

    ``september_2026()`` is a hand-written fixture, so the default run below proves the
    MODEL works and says nothing about the boundary. This path is the one the product
    actually takes: JSON produced by TypeScript, parsed by ``contract.py``, solved.

    Returns a process exit code. A ContractError is a failure, not a traceback - the
    caller is a build step and the field path is the whole message.
    """
    try:
        raw_bytes = path.read_bytes()
    except OSError as error:
        print(f"could not read {path}: {error}", file=sys.stderr)
        return 2
    # L3, solve-run diagnostics (docs/ops/diagnostics.md): "the request payload as sent, plus
    # its hash". Hashed as received, before parsing -- the hash is proof of exactly what arrived
    # on the wire, not of TypeScript's or Python's opinion of what it means.
    request_hash = hashlib.sha256(raw_bytes).hexdigest()
    try:
        payload = json.loads(raw_bytes.decode("utf-8"))
    except json.JSONDecodeError as error:
        print(f"could not read {path}: {error}", file=sys.stderr)
        return 2

    try:
        instance = parse_request(payload)
    except ContractError as error:
        print(f"contract error - {error}", file=sys.stderr)
        return 1

    check = preflight(instance)
    built = build(instance)
    # The REQUEST's budget wins unless the caller passed --time-budget explicitly. The
    # sender knows what it is waiting on; a flag default does not.
    effective = budget if budget is not None else (instance.time_budget_seconds or 30.0)
    result = solve(built, time_budget_seconds=effective)

    if as_json:
        print(
            json.dumps(
                {
                    "status": result.status,
                    "objective": result.objective,
                    "wallClockSeconds": result.wall_clock_seconds,
                    "doctors": len(instance.doctors),
                    "days": len(instance.days),
                    "slots": len(instance.shift_slots()),
                    "preflightOk": bool(check),
                    "preflightFailures": list(check.failures),
                    "assignments": result.assignments,
                    "violations": result.violations,
                    "costByTier": result.cost_by_tier,
                    # L3 fields not already covered above -- see docs/ops/diagnostics.md and
                    # docs/architecture/api.md's "L3: solve-run diagnostics" section.
                    "requestHash": request_hash,
                    "preflight": {
                        "feasible": check.feasible,
                        "totalDemand": check.total_demand,
                        "totalSupply": check.total_supply,
                        "failures": list(check.failures),
                    },
                    "modelSnapshot": built.canonical_text(),
                    "numWorkers": result.num_workers,
                    "cpSatVersion": result.cp_sat_version,
                },
                indent=2,
            )
        )
        return 0

    print(f"request             {path}")
    print(f"pre-flight          {'ok' if check else 'FAILED'}")
    for failure in check.failures:
        print(f"  {failure}")
    print(f"status              {result.status}")
    print(f"objective           {result.objective}")
    print(f"slots               {len(instance.shift_slots())}")
    print(f"assignments         {len(result.assignments)}")
    print(f"violations          {len(result.violations)}")
    for violation in result.violations[:10]:
        print(f"  [{violation['constraintId']}] {violation['message']}")
    return 0


def main() -> None:
    """Solve one month and print what the model had to break.

    With no arguments, solves the hand-written September 2026 instance - the original
    prototype behaviour. With ``--request``, solves a real solve-request file, which is
    the only way to exercise the TypeScript-to-Python boundary end to end.
    """
    parser = argparse.ArgumentParser(prog="call-roster-solver")
    parser.add_argument(
        "--request",
        type=Path,
        default=None,
        help="a solve-request JSON file, as produced by scripts/build-solve-request.ts",
    )
    parser.add_argument(
        "--time-budget",
        type=float,
        default=None,
        help="seconds; overrides the request's own timeBudgetSeconds",
    )
    parser.add_argument(
        "--json", action="store_true", help="machine-readable output, for a build step"
    )
    args = parser.parse_args()

    if args.request is not None:
        raise SystemExit(_solve_request_file(args.request, args.time_budget, args.json))

    instance = september_2026()

    check = preflight(instance)
    if not check:
        print("pre-flight failed - not invoking the solver:")
        for failure in check.failures:
            print(f"  {failure}")
        return
    print(f"pre-flight ok        demand={check.total_demand} supply={check.total_supply}")

    built = build(instance)
    result = solve(built)

    print(f"status              {result.status}")
    print(f"wall clock          {result.wall_clock_seconds:.3f}s")
    print(f"objective           {result.objective}")
    print(f"slots               {len(instance.shift_slots())}")
    print(f"assign vars         {len(built.assign)}")
    print(f"penalty entries     {len(built.registry.entries)}")
    print(f"cost by tier        {result.cost_by_tier}")
    print(f"violations          {len(result.violations)}")

    for violation in result.violations[:10]:
        print(f"  [{violation['constraintId']}] {violation['message']}")

    # The printable grid, doctors as rows and days as columns - the shape the product
    # ships. Proving it fits on one screen is worth more than it looks.
    print()
    by_slot = {(a["date"], a["shiftId"]): a["doctorCode"] for a in result.assignments}
    header = "     " + "".join(f"{d.date.day:>4}" for d in instance.days)
    print(header)
    # Rows are derived from the kinds actually present, not hard-coded. The hard-coded
    # version listed morning/afternoon/night and so silently dropped Pattern B's evening
    # shift and Pattern C's long day - a debug view that hides a quarter of a Friday.
    present = [
        kind for kind in ShiftKind if any(s.kind is kind for d in instance.days for s in d.shifts)
    ]
    for kind in present:
        row = f"{kind.value[:4]:<5}"
        for day in instance.days:
            match = next((s for s in day.shifts if s.kind is kind), None)
            code = by_slot.get((day.date.isoformat(), match.shift_id), "") if match else ""
            row += f"{code:>4}"
        print(row)
