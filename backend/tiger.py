"""Tiger Data (TimescaleDB on Postgres) as the time-series layer behind Synapshot.

SQLite stays the system of record: patients, documents, forecasts, alerts. What a call
produces in bulk goes to Tiger Data as well, because it is a stream and not a record:

    gaze_samples   every gaze sample of every task, 30 a second, with its error to the target
    face_samples   blink, smile and brow traces
    measures       the weekly measurements the model assimilates

Each is a hypertable. gaze_samples is compressed, and two continuous aggregates answer the
screens without scanning the stream: `gaze_error_1s` (how well the eyes tracked, by second)
and `cohort_week_bands` (where this patient sits against everyone, by week and measure).

Rules this module holds to:
- Only pseudonymous data leaves the app. The patient reference is a hash, never the name,
  the id or a phone number, and no free text is sent.
- It is optional and never in the way. With no TIGER_DATABASE_URL, or when Tiger is
  unreachable, every read falls back to computing the same answer from SQLite and says so in
  `source`, and a write failure is logged and swallowed. A call must never fail because a
  dashboard database did.
- Mock mode (the default without a URL) opens no connection.
"""

import hashlib
import json
import math
import time
from datetime import datetime, timedelta
from pathlib import Path

from . import db
from .config import cfg

SCHEMA = Path(__file__).with_name("tiger_schema.sql")
CONNECT_TIMEOUT_S = 8
BUCKET_S = 1.0           # the width of a gaze error bucket, in seconds
TASKS = ["pursuit_h", "pursuit_v", "saccade", "antisaccade", "fixation"]


def live() -> bool:
    """True when Tiger Data should be used."""
    return bool(not cfg.mock_tiger and cfg.tiger_url)


def pseudonym(pid: str) -> str:
    """The patient reference Tiger sees. The same hash the CREAO agents get."""
    return "pt-" + hashlib.sha256(pid.encode()).hexdigest()[:8]


def connect():
    """A new autocommit connection. Continuous aggregates cannot be built inside a transaction."""
    import psycopg

    return psycopg.connect(cfg.tiger_url, autocommit=True, connect_timeout=CONNECT_TIMEOUT_S)


def _why(exc: Exception) -> str:
    """A short reason that cannot carry the connection string."""
    text = str(exc)
    if cfg.tiger_url:
        text = text.replace(cfg.tiger_url, "[url]")
    return text.splitlines()[0][:200] if text else exc.__class__.__name__


# ---------------------------------------------------------------- schema

def ensure_schema() -> None:
    """Create the extension, hypertables, compression and continuous aggregates. Idempotent."""
    text = "\n".join(line for line in SCHEMA.read_text().splitlines() if not line.strip().startswith("--"))
    statements = [s.strip() for s in text.split(";\n") if s.strip()]
    with connect() as con:
        for stmt in statements:
            try:
                con.execute(stmt)
            except Exception as exc:
                # A policy that already exists, or an option an older service does not know, must
                # not stop the rest of the schema from being built.
                if "already exists" in str(exc) or stmt.lstrip().upper().startswith("SELECT ADD_"):
                    continue
                raise


# ---------------------------------------------------------------- rows

def _stamp(date: str) -> datetime:
    """A check-in's stored date as a datetime. An unreadable one falls back to now."""
    try:
        return datetime.fromisoformat(str(date)[:19])
    except (ValueError, TypeError):
        return datetime.now()


def rows_for(checkin) -> dict:
    """The Tiger rows for one stored check-in, as plain tuples.

    Gaze error is the distance between where the eyes were and where the target was, in the
    units the pipeline stored them in. It is worked out here once, so a query never has to.
    """
    pid, cid, week = checkin["patient_id"], checkin["id"], int(checkin["week"] or 0)
    ref, t0 = pseudonym(pid), _stamp(checkin["date"])
    gaze, face = [], []
    for task in db.dec(checkin["gaze"], []) or []:
        ts, xs, ys = task.get("t") or [], task.get("x") or [], task.get("y") or []
        txs, tys = task.get("tx") or [], task.get("ty") or []
        for i, sec in enumerate(ts):
            x, y = _num(xs, i), _num(ys, i)
            tx, ty = _num(txs, i), _num(tys, i)
            err = math.hypot(x - tx, y - ty) if None not in (x, y, tx, ty) else None
            gaze.append((t0 + timedelta(seconds=float(sec)), ref, cid, week, task.get("task", ""), x, y, tx, ty, err))
    traces = db.dec(checkin["traces"], {}) or {}
    for name, series in traces.items():
        for sec, val in zip(series.get("t") or [], series.get("v") or []):
            face.append((t0 + timedelta(seconds=float(sec)), ref, cid, week, name, _num([val], 0)))
    measures = [(t0, ref, week, o["key"], float(o["value"]), float(o["sem"] or 0))
                for o in db.rows("select key, value, sem from observations where patient_id=? and week=?", (pid, week))]
    return {"gaze": gaze, "face": face, "measures": measures}


def _num(seq, i):
    """seq[i] as a float, or None when it is missing or not a number."""
    try:
        v = float(seq[i])
        return v if math.isfinite(v) else None
    except (IndexError, TypeError, ValueError):
        return None


# ---------------------------------------------------------------- writes

COLUMNS = {
    "gaze_samples": "ts, patient_ref, checkin_id, week, task, x, y, tx, ty, err",
    "face_samples": "ts, patient_ref, checkin_id, week, signal, v",
    "measures": "ts, patient_ref, week, key, value, sem",
}


def mirror(cid: str) -> dict:
    """Copy one check-in's stream into Tiger Data. Best effort: it never raises.

    A call has to finish even when the dashboard database is down, so a failure here is
    written to the event log and swallowed. Returns what happened, for the log and the tests.
    """
    if not live():
        return {"ok": False, "skipped": "tiger is not configured"}
    row = db.checkin(cid)
    if row is None:
        return {"ok": False, "skipped": "no such check-in"}
    try:
        rows = rows_for(row)
        with connect() as con:
            have = con.execute("select 1 from gaze_samples where checkin_id = %s limit 1", (cid,)).fetchone()
            if have:
                return {"ok": True, "skipped": "already mirrored"}
            with con.cursor() as cur:
                for table, key in (("gaze_samples", "gaze"), ("face_samples", "face"), ("measures", "measures")):
                    with cur.copy(f"COPY {table} ({COLUMNS[table]}) FROM STDIN") as copy:
                        for r in rows[key]:
                            copy.write_row(r)
            lo = min((r[0] for r in rows["gaze"]), default=None)
            hi = max((r[0] for r in rows["gaze"]), default=None)
            if lo and hi:
                # Make the new seconds visible to the aggregate straight away, so a dashboard
                # opened right after a call shows it rather than waiting for the policy.
                for view in ("gaze_error_1s", "cohort_week_bands"):
                    con.execute(f"CALL refresh_continuous_aggregate('{view}', %s, %s)",
                                (lo - timedelta(days=1), hi + timedelta(days=1)))
        out = {"ok": True, "gaze": len(rows["gaze"]), "face": len(rows["face"]), "measures": len(rows["measures"])}
        db.event(row["patient_id"], "tiger_mirror", {"checkin": cid, **{k: v for k, v in out.items() if k != "ok"}})
        return out
    except Exception as exc:
        db.event(row["patient_id"], "tiger_error", {"checkin": cid, "error": _why(exc)})
        return {"ok": False, "error": _why(exc)}


def backfill() -> dict:
    """Mirror every stored check-in that Tiger does not have yet."""
    done = skipped = failed = 0
    for row in db.rows("select id from checkins order by date"):
        got = mirror(row["id"])
        if got.get("skipped"):
            skipped += 1
        elif got.get("ok"):
            done += 1
        else:
            failed += 1
    return {"mirrored": done, "already_there": skipped, "failed": failed}


def compress() -> int:
    """Compress every chunk of the gaze stream. Returns how many were newly compressed."""
    with connect() as con:
        before = con.execute("select count(*) from timescaledb_information.chunks "
                             "where hypertable_name='gaze_samples' and is_compressed").fetchone()[0]
        con.execute("select compress_chunk(c, if_not_compressed => true) from show_chunks('gaze_samples') c")
        after = con.execute("select count(*) from timescaledb_information.chunks "
                            "where hypertable_name='gaze_samples' and is_compressed").fetchone()[0]
    return int(after - before)


# ---------------------------------------------------------------- reads (Tiger first, SQLite as the fallback)

def _ms(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000, 1)


def gaze_profile(pid: str, week: int, task: str) -> dict:
    """Gaze error by second for one task of one check-in.

    From the continuous aggregate when Tiger is live, which reads a few hundred rows however
    long the stream is. `raw_ms` runs the same question over the raw samples, so the saving
    is measured here and not asserted.
    """
    if live():
        try:
            with connect() as con:
                ref = pseudonym(pid)
                t0 = time.perf_counter()
                got = con.execute(
                    "select bucket, err_mean, err_max, n from gaze_error_1s "
                    "where patient_ref=%s and week=%s and task=%s order by bucket", (ref, week, task)).fetchall()
                ms = _ms(t0)
                t0 = time.perf_counter()
                raw = con.execute(
                    "select count(*), avg(err) from gaze_samples where patient_ref=%s and week=%s and task=%s",
                    (ref, week, task)).fetchone()
                raw_ms = _ms(t0)
                t0 = time.perf_counter()
                con.execute("select time_bucket('1 second', ts), avg(err), max(err), count(*) from gaze_samples "
                            "where patient_ref=%s and week=%s and task=%s group by 1 order by 1", (ref, week, task)).fetchall()
                raw_agg_ms = _ms(t0)
            if got:
                start = got[0][0]
                return {"source": "tiger", "task": task, "week": week, "ms": ms, "raw_ms": raw_agg_ms,
                        "raw_rows": int(raw[0]), "buckets": len(got),
                        "points": [{"t": round((b - start).total_seconds(), 2), "err_mean": _r(m), "err_max": _r(x), "n": int(n)}
                                   for b, m, x, n in got]}
        except Exception as exc:
            out = _profile_sqlite(pid, week, task)
            out["fallback_reason"] = _why(exc)
            return out
    return _profile_sqlite(pid, week, task)


def _profile_sqlite(pid: str, week: int, task: str) -> dict:
    """The same answer worked out from the stored JSON. Slower, and the only option without Tiger."""
    t0 = time.perf_counter()
    row = db.one("select * from checkins where patient_id=? and week=? order by date desc, rowid desc limit 1", (pid, week))
    buckets: dict[int, list[float]] = {}
    total = 0
    if row is not None:
        start = _stamp(row["date"])
        for r in rows_for(row)["gaze"]:
            if r[4] == task and r[9] is not None:
                total += 1
                buckets.setdefault(int((r[0] - start).total_seconds() // BUCKET_S), []).append(r[9])
    points = [{"t": float(k), "err_mean": _r(sum(v) / len(v)), "err_max": _r(max(v)), "n": len(v)}
              for k, v in sorted(buckets.items())]
    return {"source": "sqlite", "task": task, "week": week, "ms": _ms(t0), "raw_ms": None,
            "raw_rows": total, "buckets": len(points), "points": points}


def cohort_bands(key: str, pid: str | None = None) -> dict:
    """Mean and range of one measure across every patient, by week, plus this patient's own line."""
    if live():
        try:
            with connect() as con:
                t0 = time.perf_counter()
                got = con.execute(
                    "select week, sum(mean * n) / sum(n), min(lo), max(hi), sum(n) from cohort_week_bands "
                    "where key=%s group by week order by week", (key,)).fetchall()
                own = (con.execute("select week, value from measures where patient_ref=%s and key=%s order by week",
                                   (pseudonym(pid), key)).fetchall() if pid else [])
                ms = _ms(t0)
            if got:
                return {"source": "tiger", "key": key, "ms": ms,
                        "weeks": [{"week": int(w), "mean": _r(m), "lo": _r(lo), "hi": _r(hi), "n": int(n)} for w, m, lo, hi, n in got],
                        "patient": [{"week": int(w), "value": _r(v)} for w, v in own]}
        except Exception as exc:
            out = _bands_sqlite(key, pid)
            out["fallback_reason"] = _why(exc)
            return out
    return _bands_sqlite(key, pid)


def _bands_sqlite(key: str, pid: str | None) -> dict:
    t0 = time.perf_counter()
    rows = db.rows("select patient_id, week, value from observations where key=? order by week", (key,))
    by: dict[int, list[float]] = {}
    for r in rows:
        by.setdefault(int(r["week"]), []).append(float(r["value"]))
    weeks = [{"week": w, "mean": _r(sum(v) / len(v)), "lo": _r(min(v)), "hi": _r(max(v)), "n": len(v)} for w, v in sorted(by.items())]
    own = [{"week": int(r["week"]), "value": _r(float(r["value"]))} for r in rows if pid and r["patient_id"] == pid]
    return {"source": "sqlite", "key": key, "ms": _ms(t0), "weeks": weeks, "patient": own}


def _r(v) -> float | None:
    return None if v is None else round(float(v), 4)


def stats() -> dict:
    """What the status panel shows: is it live, how much is in it, and how well it compresses."""
    out: dict = {"live": live(), "mock": cfg.mock_tiger, "configured": bool(cfg.tiger_url)}
    if not live():
        out["reason"] = ("MOCK_TIGER is on" if cfg.mock_tiger else "set TIGER_DATABASE_URL to use Tiger Data")
        return out
    try:
        with connect() as con:
            out["version"] = con.execute("select extversion from pg_extension where extname='timescaledb'").fetchone()[0]
            counts = {}
            for table in ("gaze_samples", "face_samples", "measures"):
                counts[table] = int(con.execute(f"select count(*) from {table}").fetchone()[0])
            out["rows"] = counts
            chunks = con.execute("select count(*), count(*) filter (where is_compressed) from timescaledb_information.chunks "
                                 "where hypertable_name='gaze_samples'").fetchone()
            out["chunks"] = {"total": int(chunks[0]), "compressed": int(chunks[1])}
            comp = con.execute("select before_compression_total_bytes, after_compression_total_bytes "
                               "from hypertable_compression_stats('gaze_samples')").fetchone()
            if comp and comp[0] and comp[1]:
                out["compression"] = {"before_bytes": int(comp[0]), "after_bytes": int(comp[1]),
                                      "ratio": round(comp[0] / comp[1], 1)}
    except Exception as exc:
        out["live"] = False
        out["error"] = _why(exc)
    return out


def json_safe(obj) -> str:
    """For the command line: a result as readable JSON."""
    return json.dumps(obj, indent=2, default=str)


def main() -> int:
    """`make tiger`: build the schema, load everything, compress, and say what is there."""
    if not live():
        print("  Tiger Data is not configured. Put TIGER_DATABASE_URL in .env, and set MOCK_TIGER=0.")
        return 1
    print("  schema      ", end="", flush=True)
    ensure_schema()
    print("ok")
    got = backfill()
    print(f"  check-ins    {got['mirrored']} loaded, {got['already_there']} already there, {got['failed']} failed")
    print(f"  compressed   {compress()} chunk(s)")
    print(json_safe(stats()))
    return 0 if not got["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
