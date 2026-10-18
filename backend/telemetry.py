"""The telemetry write path.

The call page posts about five times a second. Those posts are already the live feed for
the clinician console; this module also projects a handful of numbers out of each one and
buffers them for the time-series table. One batched insert every few seconds, not one
insert per request.

Samples stay in SQLite alongside the patient records; no external database is used.
"""

import threading
import time

from . import db

BUFFER: dict[str, list[tuple]] = {}
_LOCK = threading.RLock()
_LAST_FLUSH = time.time()
MAX_ROWS = 40
MAX_SECONDS = 5.0


def _stamp():
    """A local SQLite timestamp."""
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


def _pivot(rows: list, key: str = "bucket") -> list[dict]:
    """Turn (bucket, metric, value) rows into one object per bucket."""
    out: dict[str, dict] = {}
    for r in rows:
        row = dict(r) if not isinstance(r, dict) else r
        stamp = str(row.get(key))
        item = out.setdefault(stamp, {"t": stamp})
        metric = str(row.get("metric"))
        item[metric] = round(float(row.get("avg_value") or 0.0), 4)
        item[f"{metric}_n"] = int(row.get("n") or 0)
    return [out[k] for k in sorted(out)]


def _sqlite_pulse(minutes: int, hours: int) -> tuple[list, list, str]:
    """The same shape from sqlite, so a local demo is not an empty chart."""
    since_min = time.strftime("%Y-%m-%dT%H:%M", time.localtime(time.time() - minutes * 60))
    since_hour = time.strftime("%Y-%m-%dT%H", time.localtime(time.time() - hours * 3600))
    mins = db.rows(
        "select substr(time,1,16)||':00' as bucket, metric, avg(value) as avg_value,"
        " count(*) as n from metric_samples where time >= ? group by bucket, metric"
        " order by bucket",
        (since_min,),
    )
    hrs = db.rows(
        "select substr(time,1,13)||':00:00' as bucket, metric, avg(value) as avg_value,"
        " count(*) as n from metric_samples where time >= ? group by bucket, metric"
        " order by bucket",
        (since_hour,),
    )
    return _pivot(mins), _pivot(hrs), "sqlite"


def pulse(minutes: int = 60, hours: int = 48) -> dict:
    """Everything the live dashboard needs, in one round trip."""
    mins, hrs, source = _sqlite_pulse(minutes, hours)

    totals = {
        "patients": db.count("select count(*) as c from patients"),
        "checkins": db.count("select count(*) as c from checkins"),
        "observations": db.count("select count(*) as c from observations"),
        "alerts": db.count("select count(*) as c from alerts"),
        "open_alerts": db.count("select count(*) as c from alerts where acked=0"),
        "clinicians": db.count("select count(*) as c from clinicians"),
        "assignments": db.count("select count(*) as c from assignments where active=1"),
        "samples": db.count("select count(*) as c from metric_samples"),
    }

    out = {
        "source": source,
        "window": {"minutes": minutes, "hours": hours},
        "minutes": mins,
        "hourly": hrs,
        "totals": totals,
        "error": "",
    }
    return out
