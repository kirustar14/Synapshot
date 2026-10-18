"""Tiger Data setup and read path.

Two jobs:

1. `bootstrap()` makes a plain Postgres into the time-series shape this project wants:
   a hypertable, two continuous aggregates, refresh policies, and a columnstore policy.
   Every step is guarded. A free Tiger Cloud service on an older TimescaleDB gets as much
   as it supports, and `notes` says exactly which step ran, which fell back and why.
2. `pulse()`, `stats()` and `bench()` are the read path the dashboard and `make tiger-check`
   use. Nothing here invents a number: a field that could not be read comes back as
   `available: false` with the reason.
"""

import time

from . import db

TIME_BUCKETS = ("1 minute", "1 hour")


def _try(sql: str, args: tuple = ()):
    """Run a query and return (rows, error). Never raises."""
    try:
        return db.rows(sql, args), ""
    except Exception as exc:  # noqa: BLE001 - a missing catalog view is a normal answer
        return [], f"{type(exc).__name__}: {exc}"


def _note(name: str, detail: str) -> None:
    """Record a bootstrap step in our own table, so repeats are idempotent."""
    try:
        db.put("tiger_bootstrap", {"name": name, "applied": db.now(), "detail": detail[:900]})
    except Exception:
        pass


def _done(name: str) -> bool:
    try:
        return db.one("select name from tiger_bootstrap where name=?", (name,)) is not None
    except Exception:
        return False


def version() -> tuple[int, ...]:
    """The installed TimescaleDB version, or an empty tuple when it is absent."""
    rows, _ = _try("select extversion from pg_extension where extname='timescaledb'")
    if not rows:
        return ()
    raw = str(rows[0]["extversion"] if isinstance(rows[0], dict) else rows[0][0])
    parts = []
    for piece in raw.split("."):
        digits = "".join(ch for ch in piece if ch.isdigit())
        if not digits:
            break
        parts.append(int(digits))
    return tuple(parts)


def available() -> bool:
    """True when this database has the extension."""
    return db.is_pg() and bool(version())


def bootstrap() -> dict:
    """Make the telemetry table a hypertable and add the aggregates and policies.

    Safe to call on every start. Each step is recorded once; nothing here drops data.
    """
    out = {"dialect": db.dialect(), "extension": "", "notes": [], "ok": False}
    if db.pg_error():
        out["notes"].append("DATABASE_URL is set but unreachable, so sqlite is in use: " + db.pg_error())
    if not db.is_pg():
        out["notes"].append("DATABASE_URL is not set, sqlite is the system of record")
        return out

    # Tiger Cloud ships the extension, but a plain Postgres with TimescaleDB installed
    # still needs it enabled in this database. Guarded, because a managed service may not
    # allow CREATE EXTENSION from this role.
    try:
        db.run("create extension if not exists timescaledb")
    except Exception as exc:  # noqa: BLE001
        out["notes"].append(f"could not enable timescaledb: {exc}")

    got = version()
    out["extension"] = ".".join(str(p) for p in got) if got else ""
    if not got:
        out["notes"].append("the timescaledb extension is not installed on this database")
        return out

    # 1. Hypertable. `by_range` is the current interface; the two argument form is the
    # older one and still works on services that have not moved.
    if not _done("hypertable:metric_samples"):
        try:
            db.run("select create_hypertable('metric_samples', by_range('time', interval '1 day'),"
                   " if_not_exists => true)")
            _note("hypertable:metric_samples", "by_range, 1 day chunks")
        except Exception as exc:
            try:
                db.run("select create_hypertable('metric_samples', 'time', if_not_exists => true)")
                _note("hypertable:metric_samples", f"legacy interface, because: {exc}")
            except Exception as exc2:
                out["notes"].append(f"hypertable failed: {exc2}")
    out["hypertable"] = _done("hypertable:metric_samples")

    # 2. Continuous aggregates. 1 minute for the live chart, 1 hour for the trend line.
    aggregates = {
        "metrics_1m": (
            "time_bucket('1 minute', time) as bucket",
            # WITH NO DATA matters: TimescaleDB defaults to WITH DATA, and that form
            # cannot run inside the transaction psycopg opens for every statement. The
            # explicit refresh below fills the view without that restriction.
            "create materialized view metrics_1m with (timescaledb.continuous) as "
            "select time_bucket('1 minute', time) as bucket, patient_id, metric, "
            "avg(value) as avg_value, min(value) as min_value, max(value) as max_value, "
            "count(*) as n from metric_samples group by bucket, patient_id, metric "
            "with no data",
            "add_continuous_aggregate_policy('metrics_1m', start_offset => interval '3 hours', "
            "end_offset => interval '1 minute', schedule_interval => interval '1 minute')",
        ),
        "metrics_1h": (
            "time_bucket('1 hour', time) as bucket",
            "create materialized view metrics_1h with (timescaledb.continuous) as "
            "select time_bucket('1 hour', time) as bucket, patient_id, metric, "
            "avg(value) as avg_value, min(value) as min_value, max(value) as max_value, "
            "count(*) as n from metric_samples group by bucket, patient_id, metric "
            "with no data",
            "add_continuous_aggregate_policy('metrics_1h', start_offset => interval '7 days', "
            "end_offset => interval '1 hour', schedule_interval => interval '15 minutes')",
        ),
    }
    for name, (_bucket, create, policy) in aggregates.items():
        if not _done(f"cagg:{name}"):
            try:
                db.run(create)
                _note(f"cagg:{name}", "created")
            except Exception as exc:
                have, _ = _try(
                    "select 1 from timescaledb_information.continuous_aggregates where view_name=?",
                    (name,),
                )
                if have:
                    _note(f"cagg:{name}", "already present")
                else:
                    out["notes"].append(f"{name} failed: {exc}")
                    continue
        # WITH NO DATA creates an empty view. Fill it once so the first pulse read has a
        # bucket even before the refresh policy's next scheduled run. A failure here is
        # not fatal: the policy will catch up, and the read path falls back to raw.
        try:
            # Autocommit: TimescaleDB refuses this call inside a transaction block.
            db.autocommit(f"call refresh_continuous_aggregate('{name}', NULL, NULL)")
        except Exception as exc:  # noqa: BLE001
            out["notes"].append(f"{name} initial refresh deferred: {exc}")
        if not _done(f"policy:{name}"):
            try:
                db.run("select " + policy)
                _note(f"policy:{name}", policy[:120])
            except Exception as exc:
                out["notes"].append(f"{name} policy failed: {exc}")

    # 3. Columnstore. 2.18 renamed compression to the columnstore; older services need the
    # legacy calls. Both are attempted in the order that matches the version.
    if not _done("columnstore:metric_samples"):
        detail = ""
        if got >= (2, 18):
            try:
                db.run("alter table metric_samples set (timescaledb.enable_columnstore=true,"
                       " timescaledb.segmentby='patient_id', timescaledb.orderby='time desc')")
                db.run("call add_columnstore_policy('metric_samples', after => interval '1 day')")
                detail = "columnstore policy, after 1 day"
            except Exception as exc:
                detail = f"columnstore failed: {exc}"
        if not detail or detail.startswith("columnstore failed"):
            try:
                db.run("alter table metric_samples set (timescaledb.compress,"
                       " timescaledb.compress_segmentby='patient_id',"
                       " timescaledb.compress_orderby='time desc')")
                db.run("select add_compression_policy('metric_samples', interval '1 day')")
                detail = "legacy compression policy, after 1 day"
            except Exception as exc:
                if not detail:
                    detail = f"compression failed: {exc}"
                else:
                    detail += f"; legacy also failed: {exc}"
        _note("columnstore:metric_samples", detail)
        if "failed" in detail:
            out["notes"].append(detail)

    out["ok"] = out["hypertable"]
    return out


def stats() -> dict:
    """What the database says about itself, one guarded query at a time."""
    out: dict = {
        "dialect": db.dialect(),
        "fallback": db.pg_error() or None,
        "available": False,
        "extension": "",
        "hypertable": False,
        "aggregates": [],
        "size": None,
        "compression": None,
        "rows": 0,
        "latest_bucket": None,
        "lag_s": None,
        "policies": [],
        "notes": [],
    }
    if not db.is_pg():
        out["notes"].append("sqlite is the system of record; set DATABASE_URL for Tiger Data")
        out["rows"] = db.count("select count(*) as c from metric_samples")
        return out

    got = version()
    out["extension"] = ".".join(str(p) for p in got) if got else ""
    out["available"] = bool(got)
    if not got:
        out["notes"].append("timescaledb is not installed on this database")
        out["rows"] = db.count("select count(*) as c from metric_samples")
        return out

    rows, err = _try(
        "select hypertable_name from timescaledb_information.hypertables "
        "where hypertable_name='metric_samples'"
    )
    out["hypertable"] = bool(rows)
    if err:
        out["notes"].append(f"hypertables: {err}")

    rows, err = _try("select view_name from timescaledb_information.continuous_aggregates order by view_name")
    out["aggregates"] = [str(r["view_name"] if isinstance(r, dict) else r[0]) for r in rows]
    if err:
        out["notes"].append(f"aggregates: {err}")

    rows, err = _try("select pg_size_pretty(hypertable_size('metric_samples')) as size")
    if rows:
        out["size"] = str(rows[0]["size"] if isinstance(rows[0], dict) else rows[0][0])
    elif err:
        out["notes"].append(f"size: {err}")

    # 2.18 renamed the view, so try the new name first and the old one second.
    rows, err = _try("select * from hypertable_columnstore_stats('metric_samples')")
    if not rows:
        rows, err2 = _try("select * from hypertable_compression_stats('metric_samples')")
        err = err or err2
    if rows:
        row = dict(rows[0]) if not isinstance(rows[0], dict) else rows[0]
        out["compression"] = {k: (str(v) if k.endswith("size") else v) for k, v in row.items()}
    elif err:
        out["notes"].append(f"compression stats: {err}")

    out["rows"] = db.count("select count(*) as c from metric_samples")

    rows, err = _try("select max(bucket) as last from metrics_1m")
    if rows and rows[0] is not None:
        last = rows[0]["last"] if isinstance(rows[0], dict) else rows[0][0]
        if last is not None:
            out["latest_bucket"] = str(last)
            try:
                out["lag_s"] = round(time.time() - last.timestamp(), 1)
            except AttributeError:
                out["lag_s"] = None
    elif err:
        out["notes"].append(f"aggregate freshness: {err}")

    rows, err = _try("select name, applied, detail from tiger_bootstrap order by name")
    out["policies"] = [dict(r) for r in rows]
    if err:
        out["notes"].append(f"bootstrap records: {err}")
    return out


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


def _pg_pulse(minutes: int, hours: int) -> tuple[list, list, str, str]:
    """CAGG first, raw second. Returns series, hourly, source, error."""
    have, _ = _try("select 1 from timescaledb_information.continuous_aggregates where view_name='metrics_1m'")
    if have:
        try:
            mins = db.rows(
                "select bucket, metric, sum(avg_value*n)/nullif(sum(n),0) as avg_value, sum(n) as n"
                " from metrics_1m where bucket >= now() - (? || ' minutes')::interval"
                " group by bucket, metric order by bucket",
                (str(minutes),),
            )
            hrs = db.rows(
                "select bucket, metric, sum(avg_value*n)/nullif(sum(n),0) as avg_value, sum(n) as n"
                " from metrics_1h where bucket >= now() - (? || ' hours')::interval"
                " group by bucket, metric order by bucket",
                (str(hours),),
            )
            return _pivot(mins), _pivot(hrs), "continuous aggregate", ""
        except Exception as exc:  # noqa: BLE001 - fall through to the raw query
            raw_err = f"aggregate read failed: {exc}"
    else:
        raw_err = "no continuous aggregate on this service"

    mins = db.rows(
        "select time_bucket('1 minute', time) as bucket, metric, avg(value) as avg_value,"
        " count(*) as n from metric_samples where time >= now() - (? || ' minutes')::interval"
        " group by bucket, metric order by bucket",
        (str(minutes),),
    )
    hrs = db.rows(
        "select time_bucket('1 hour', time) as bucket, metric, avg(value) as avg_value,"
        " count(*) as n from metric_samples where time >= now() - (? || ' hours')::interval"
        " group by bucket, metric order by bucket",
        (str(hours),),
    )
    return _pivot(mins), _pivot(hrs), "raw", raw_err


def pulse(minutes: int = 60, hours: int = 48) -> dict:
    """Everything the live dashboard needs, in one round trip."""
    error = ""
    if db.is_pg():
        mins, hrs, source, error = _pg_pulse(minutes, hours)
    else:
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
        "tiger": stats(),
        "error": error,
    }
    # A benchmark on every page load would be a self inflicted load test. It is opt in,
    # `/api/pulse?bench=1`, and cached by the caller for a minute.
    return out


def bench(minutes: int = 60, runs: int = 5) -> dict:
    """Raw table against the continuous aggregate, measured, not estimated."""
    if not db.is_pg():
        return {"available": False, "reason": "DATABASE_URL is not set"}
    have, _ = _try("select 1 from timescaledb_information.continuous_aggregates where view_name='metrics_1m'")
    if not have:
        return {"available": False, "reason": "no metrics_1m aggregate on this service"}

    raw_sql = (
        "select time_bucket('1 minute', time) as bucket, metric, avg(value) as avg_value,"
        " count(*) as n from metric_samples where time >= now() - (? || ' minutes')::interval"
        " group by bucket, metric order by bucket"
    )
    cagg_sql = (
        "select bucket, metric, sum(avg_value*n)/nullif(sum(n),0) as avg_value, sum(n) as n"
        " from metrics_1m where bucket >= now() - (? || ' minutes')::interval"
        " group by bucket, metric order by bucket"
    )

    def timed(sql: str) -> tuple[float, int]:
        samples = []
        rows = 0
        for _ in range(max(1, runs)):
            start = time.perf_counter()
            rows = len(db.rows(sql, (str(minutes),)))
            samples.append((time.perf_counter() - start) * 1000.0)
        samples.sort()
        return round(samples[len(samples) // 2], 2), rows

    raw_ms, raw_rows = timed(raw_sql)
    cagg_ms, cagg_rows = timed(cagg_sql)
    return {
        "available": True,
        "window_minutes": minutes,
        "runs": max(1, runs),
        "raw_ms": raw_ms,
        "cagg_ms": cagg_ms,
        "raw_rows": raw_rows,
        "cagg_rows": cagg_rows,
        "speedup": round(raw_ms / cagg_ms, 1) if cagg_ms else None,
        "note": "median wall clock over the same window, measured on this service just now",
    }
