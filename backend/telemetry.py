"""The telemetry write path.

The call page posts about five times a second. Those posts are already the live feed for
the clinician console; this module also projects a handful of numbers out of each one and
buffers them for the time-series table. One batched insert every few seconds, not one
insert per request.

If DATABASE_URL is empty the rows go to sqlite, so the dashboard has something honest to
draw in a local demo and the tests can assert the whole path without a server.
"""

import threading
import time
from datetime import datetime, timezone

from . import db

BUFFER: dict[str, list[tuple]] = {}
_LOCK = threading.RLock()
_LAST_FLUSH = time.time()
MAX_ROWS = 40
MAX_SECONDS = 5.0


def _stamp():
    """A real timestamp on Postgres, the ISO string on sqlite."""
    if db.is_pg():
        return datetime.now(timezone.utc)
    return db.now()


def add(token: str, patient_id: str, metric: str, value: float, quality: float = 1.0) -> None:
    """Buffer one sample. Cheap enough to call on every live post."""
    global _LAST_FLUSH
    row = (_stamp(), patient_id, token, metric, float(value), float(quality))
    with _LOCK:
        if token not in BUFFER:
            # A new session starts its own five second clock. Without this, the first
            # post after a quiet period flushes immediately and the batching is a lie.
            BUFFER[token] = []
            _LAST_FLUSH = time.time()
        buf = BUFFER[token]
        buf.append(row)
        due = len(buf) >= MAX_ROWS or (time.time() - _LAST_FLUSH) >= MAX_SECONDS
        if not due:
            return
        rows = buf[:]
        buf.clear()
        _LAST_FLUSH = time.time()
    db.metric_insert(rows)


def observe(token: str, patient_id: str, quality, gaze, target, pursuit_gain=None) -> None:
    """Project the live payload into the metrics worth keeping.

    `quality` is the contract's Quality object. Gaze error is the distance between where
    the patient looked and where the target was, in normalized screen units; it is a
    channel check, not a clinical measure.
    """
    flags = 1.0 if (quality.face and quality.dist and quality.light) else 0.0
    add(token, patient_id, "fps", quality.fps, flags)
    add(token, patient_id, "face", 1.0 if quality.face else 0.0, flags)
    add(token, patient_id, "dist", 1.0 if quality.dist else 0.0, flags)
    add(token, patient_id, "light", 1.0 if quality.light else 0.0, flags)
    dx = float(gaze.x) - float(target.x)
    dy = float(gaze.y) - float(target.y)
    add(token, patient_id, "gaze_err", (dx * dx + dy * dy) ** 0.5, flags)
    if pursuit_gain is not None:
        add(token, patient_id, "pursuit_gain", float(pursuit_gain), flags)


def observe_frame(token: str, patient_id: str, frames: int, stim: int) -> None:
    """One chunk arrived. This is the ingest-rate series the dashboard draws."""
    add(token, patient_id, "frames", float(frames))
    add(token, patient_id, "stim", float(stim))


def flush(token: str | None = None) -> int:
    """Write what is buffered. Called on a timer, on finish, and by the tests."""
    global _LAST_FLUSH
    with _LOCK:
        keys = [token] if token else list(BUFFER)
        rows: list[tuple] = []
        for key in keys:
            rows += BUFFER.pop(key, [])
        _LAST_FLUSH = time.time()
    return db.metric_insert(rows)


def pending() -> int:
    """How many rows are waiting, for the status line."""
    with _LOCK:
        return sum(len(v) for v in BUFFER.values())
