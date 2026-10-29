#!/usr/bin/env python3
"""onepc-guard: a lightweight local process guard.

The project keeps the logic intentionally small and dependency-free so it can be
used as a starting point for workstation or single-device policy enforcement.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from typing import Iterable, Sequence


@dataclass
class GuardPolicy:
    """Policy describing which processes are allowed or ignored."""

    allow: set[str] = field(default_factory=set)
    ignore: set[str] = field(default_factory=set)

    def normalize(self, values: Iterable[str]) -> set[str]:
        seen: set[str] = set()
        for item in values:
            normalized = item.strip().lower()
            if normalized:
                seen.add(normalized)
        return seen

    def evaluate(self, current_processes: Iterable[str]) -> dict:
        current = {item.strip().lower() for item in current_processes if item and item.strip()}
        allowed = self.normalize(self.allow)
        ignored = self.normalize(self.ignore)

        blocked = sorted(
            process for process in current if process not in allowed and process not in ignored
        )
        return {
            "status": "ok" if not blocked else "blocked",
            "allowed": sorted(allowed),
            "ignored": sorted(ignored),
            "observed": sorted(current),
            "blocked": blocked,
        }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate a current process set against an allow-list policy."
    )
    parser.add_argument(
        "--allow",
        action="append",
        default=[],
        help="Approved process name, e.g. chrome.exe. Can be used multiple times.",
    )
    parser.add_argument(
        "--ignore",
        action="append",
        default=[],
        help="Process names to ignore for policy checks. Can be used multiple times.",
    )
    parser.add_argument(
        "--process",
        action="append",
        default=[],
        help="A process observed in the current system. Can be used multiple times.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit structured JSON output instead of the human-readable summary.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    policy = GuardPolicy(allow=set(args.allow), ignore=set(args.ignore))
    observed = args.process or ["chrome.exe", "code.exe"]
    result = policy.evaluate(observed)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"status: {result['status']}")
        print(f"allowed: {', '.join(result['allowed']) if result['allowed'] else 'none'}")
        print(f"blocked: {', '.join(result['blocked']) if result['blocked'] else 'none'}")

    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
