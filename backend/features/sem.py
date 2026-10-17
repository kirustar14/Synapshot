"""Standard error of measurement and minimal detectable change per metric.

Every number in data/sem.json is a placeholder until the team runs test-retest on real
sessions. One edit to that file replaces all of them, nothing else needs to change.
"""

import json
from pathlib import Path

from ..config import cfg

_PATH = cfg.data_dir / "sem.json"
_CACHE: dict | None = None
FALLBACK = 1.0


def table() -> dict:
    """Parsed sem.json, or an empty table when the file is missing."""
    global _CACHE
    if _CACHE is None:
        try:
            _CACHE = json.loads(Path(_PATH).read_text())
        except Exception:
            _CACHE = {"sem": {}, "source": "missing"}
    return _CACHE


def sem(key: str) -> float:
    """SEM for a metric, falling back to 1.0 for anything not in the table."""
    return float(table().get("sem", {}).get(key, FALLBACK))


def mdc(key: str) -> float:
    """Minimal detectable change. MDC = 1.96 * sqrt(2) * SEM."""
    return 1.96 * (2.0**0.5) * sem(key)


def changed(key: str, value: float, prev: float | None) -> bool:
    """True when the change from the previous visit exceeds the MDC."""
    if prev is None:
        return False
    return abs(float(value) - float(prev)) > mdc(key)


def source() -> str:
    """Where the SEM numbers came from, shown in the API so nobody mistakes them."""
    return str(table().get("source", "placeholder"))
