"""One small SQL layer, two dialects.

sqlite is the default so a laptop with no network is a complete system. Set
DATABASE_URL and every call goes to Postgres instead, with the TimescaleDB extension
used for the telemetry stream. The helper names never changed: `put`, `patch`, `run`,
`rows`, `one`, `conn`. Call sites do not know which engine is behind them.

Rows are dict-like in both drivers, so `row["name"]` keeps working.
"""

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path

from .config import cfg
from .schema import DDL_PG, DDL_SQLITE, SQLITE_ADDED

# Tables that are written with `put`. The value is the conflict target. Everything here
# is owned by this codebase, so the names are constants rather than user input.
PRIMARY_KEY = {
    "patients": "id",
    "events": "id",
    "checkins": "id",
    "observations": "id",
    "parameters": "id",
    "forecasts": "id",
    "alerts": "id",
    "consents": "token",
    "messages": "id",
    "uploads": "id",
    "twin_inputs": "id",
    "call_sessions": "token",
    "call_frames": "id",
    "clinics": "id",
    "clinicians": "id",
    "clinician_sessions": "token_hash",
    "assignments": "id",
    "tiger_bootstrap": "name",
    "metric_samples": None,
    "agent_runs": "id",
}

WIPE = (
    "patients", "events", "checkins", "observations", "parameters", "forecasts",
    "alerts", "consents", "messages", "uploads", "twin_inputs", "call_sessions",
    "call_frames", "assignments", "metric_samples", "agent_runs",
)

_CONN = None
_POOL = None
_SCHEMA_READY = False
_PG_ERROR = ""

# One connection is shared by every FastAPI worker thread (check_same_thread=False), and
# the clinician app fires its twin, shape, forecast and mesh requests in parallel. Without
# a lock two threads used the same connection at once and one of them read a half-moved
# page: Sentry caught it as "database disk image is malformed" on /api/patients/{pid}/twin
# (UNNAMED-BACKEND-2) while the file itself passed integrity_check. Every statement now
# holds this lock. Reentrant, because conn() itself runs statements on first open.
LOCK = threading.RLock()


def is_pg() -> bool:
    """True when DATABASE_URL is set, so Postgres is the system of record."""
    return bool(cfg.database_url)


def dialect() -> str:
    """'postgres' or 'sqlite', for the status endpoints and the logs."""
    return "postgres" if is_pg() else "sqlite"


def _sqlite() -> sqlite3.Connection:
    """The one shared connection. Callers hold LOCK; conn() is the public door."""
    global _CONN
    if _CONN is None:
        Path(cfg.db_path).parent.mkdir(parents=True, exist_ok=True)
        _CONN = sqlite3.connect(str(cfg.db_path), check_same_thread=False)
        _CONN.row_factory = sqlite3.Row
    return _CONN


def _pool():
    global _POOL
    if _POOL is None:
        try:
            from psycopg.rows import dict_row
            from psycopg_pool import ConnectionPool
        except ImportError as exc:  # pragma: no cover - depends on the install
            raise RuntimeError(
                "DATABASE_URL is set but psycopg is not installed. "
                "Run: pip install 'psycopg[binary,pool]'"
            ) from exc
        _POOL = ConnectionPool(
            cfg.database_url,
            min_size=1,
            max_size=4,
            kwargs={"row_factory": dict_row},
            open=True,
            timeout=15,
        )
    return _POOL


def q(sql: str) -> str:
    """Translate the sqlite placeholder style to the Postgres one."""
    return sql.replace("?", "%s") if is_pg() else sql


class _Facade:
    """The shape existed before the Postgres path, so keep it.

    Only three call sites opened the raw connection: the lifespan, the seed script and
    the call-table setup. They need `execute`, `executescript` and `commit`, nothing else.
    """

    def execute(self, sql: str, args: tuple = ()):
        if is_pg():
            with _pool().connection() as conn, conn.cursor() as cur:
                cur.execute(q(sql), args)
                return cur
        with LOCK:
            cur = _sqlite().execute(sql, args)
            _sqlite().commit()
            return cur

    def executescript(self, script: str) -> None:
        if is_pg():
            with _pool().connection() as conn, conn.cursor() as cur:
                for statement in _statements(script):
                    cur.execute(statement)
            return
        with LOCK:
            _sqlite().executescript(script)
            _sqlite().commit()

    def commit(self) -> None:
        if not is_pg():
            with LOCK:
                _sqlite().commit()


_CONN_FACADE = _Facade()


def _statements(script: str) -> list[str]:
    """Split a DDL script into statements without a parser."""
    return [part.strip() for part in script.split(";") if part.strip()]


def _migrate_sqlite(conn: sqlite3.Connection) -> None:
    """Add any column this build needs that an older database does not have."""
    for table, col, decl in SQLITE_ADDED:
        have = {r["name"] for r in conn.execute(f"pragma table_info({table})").fetchall()}
        if col not in have:
            conn.execute(f"alter table {table} add column {col} {decl}")
    conn.commit()


def _bootstrap() -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    if is_pg():
        with _pool().connection() as conn, conn.cursor() as cur:
            for statement in _statements(DDL_PG):
                cur.execute(statement)
            # The only ALTER needed on an existing Postgres database.
            cur.execute("alter table patients add column if not exists clinic_id text")
        _SCHEMA_READY = True
        return
    conn = _sqlite()
    conn.executescript(DDL_SQLITE)
    conn.commit()
    _migrate_sqlite(conn)
    _SCHEMA_READY = True


def conn() -> sqlite3.Connection | _Facade:
    """Open the database once and make sure the schema is there."""
    _bootstrap()
    return _CONN_FACADE if is_pg() else _sqlite()


def setup() -> None:
    """Public bootstrap, used by scripts and tests that need the schema without a query."""
    _bootstrap()


def close() -> None:
    """Close what was opened. Tests use this between databases."""
    global _CONN, _POOL, _SCHEMA_READY
    if _CONN is not None:
        _CONN.close()
        _CONN = None
    if _POOL is not None:
        _POOL.close()
        _POOL = None
    _SCHEMA_READY = False


def weeks_ago(weeks: float, hour: int = 10) -> str:
    """A timestamp that many weeks back, at a plausible hour of the day.

    Seeded history has to be spread out. A patient on week seven whose seven check-ins all
    carry today's date has no timeline and a month calendar with one dot on it. Live calls
    still use `now`; this is only for building a past that is supposed to have happened.
    """
    import datetime as _dt

    when = _dt.datetime.now() - _dt.timedelta(weeks=float(weeks))
    return when.replace(hour=hour, minute=12, second=0, microsecond=0).isoformat(timespec="seconds")


def now() -> str:
    """Current time as an ISO string.

    Microseconds matter: before this, a rescore and a rebuild in the same second tied on
    `time` and the tie was broken by rowid, which Postgres does not have. The contract
    already accepts an ISO timestamp and the UI parses it without help.
    """
    return time.strftime("%Y-%m-%dT%H:%M:%S") + f".{int(time.time() * 1e6) % 1_000_000:06d}"


def new_id(prefix: str) -> str:
    """Short unique id with a readable prefix."""
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def enc(val) -> str:
    """JSON encode a value for a text column."""
    return json.dumps(val, default=float)


def dec(raw, default=None):
    """JSON decode a text column, tolerating null and junk."""
    if raw in (None, ""):
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


def run(sql: str, args: tuple = ()):
    """Execute and commit."""
    _bootstrap()
    if is_pg():
        with _pool().connection() as conn, conn.cursor() as cur:
            cur.execute(q(sql), args)
            return cur
    with LOCK:
        cur = _sqlite().execute(sql, args)
        _sqlite().commit()
        return cur


def autocommit(sql: str, args: tuple = ()) -> list:
    """Run one statement outside a transaction.

    A few TimescaleDB calls refuse to run inside a transaction block, notably
    `refresh_continuous_aggregate`. Everything else should keep using `run`.
    """
    _bootstrap()
    if is_pg():
        import psycopg

        with psycopg.connect(cfg.database_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(q(sql), args)
                try:
                    return list(cur.fetchall())
                except psycopg.ProgrammingError:
                    return []
    return list(run(sql, args).fetchall())


def rows(sql: str, args: tuple = ()) -> list:
    """All rows of a query."""
    _bootstrap()
    if is_pg():
        with _pool().connection() as conn, conn.cursor() as cur:
            cur.execute(q(sql), args)
            return list(cur.fetchall())
    with LOCK:
        return list(_sqlite().execute(sql, args).fetchall())


def one(sql: str, args: tuple = ()):
    """First row of a query or None."""
    _bootstrap()
    if is_pg():
        with _pool().connection() as conn, conn.cursor() as cur:
            cur.execute(q(sql), args)
            return cur.fetchone()
    with LOCK:
        return _sqlite().execute(sql, args).fetchone()


def put(table: str, row: dict) -> str:
    """Insert or replace a row given as a dict, returning its id."""
    if table not in PRIMARY_KEY:
        raise KeyError(f"put() does not know the primary key of {table}")
    keys = list(row)
    cols = ",".join(keys)
    marks = ",".join("?" * len(keys))
    if is_pg():
        pk = PRIMARY_KEY[table]
        if pk is None:
            raise KeyError(f"{table} is append only, use insert_many()")
        updates = ",".join(f"{k}=excluded.{k}" for k in keys if k != pk)
        sql = f"insert into {table} ({cols}) values ({marks}) on conflict ({pk})"
        sql += f" do update set {updates}" if updates else " do nothing"
    else:
        sql = f"insert or replace into {table} ({cols}) values ({marks})"
    run(sql, tuple(row[k] for k in keys))
    return str(row.get("id") or row.get("token") or row.get("token_hash") or "")


def insert_many(table: str, keys: list[str], values: list[tuple]) -> int:
    """Bulk insert append-only rows. Returns how many were sent."""
    if not values:
        return 0
    _bootstrap()
    marks = ",".join("?" * len(keys))
    sql = f"insert into {table} ({','.join(keys)}) values ({marks})"
    if is_pg():
        with _pool().connection() as conn, conn.cursor() as cur:
            cur.executemany(q(sql), values)
        return len(values)
    with LOCK:
        _sqlite().executemany(sql, values)
        _sqlite().commit()
    return len(values)


def patch(table: str, ident: str, fields: dict, key: str = "id") -> None:
    """Update some columns of one row."""
    if not fields:
        return
    sets = ",".join(f"{k}=?" for k in fields)
    run(f"update {table} set {sets} where {key}=?", tuple(fields.values()) + (ident,))


def patient(pid: str):
    """One patient row or None."""
    return one("select * from patients where id=?", (pid,))


def patients() -> list:
    """All patients, newest first."""
    return rows("select * from patients order by created desc")


def checkins(pid: str) -> list:
    """Check-ins for a patient, oldest first."""
    return rows("select * from checkins where patient_id=? order by week", (pid,))


def checkin(cid: str):
    """One check-in or None."""
    return one("select * from checkins where id=?", (cid,))


def alerts(pid: str | None = None) -> list:
    """Alerts, optionally for one patient, newest first."""
    if pid:
        return rows("select * from alerts where patient_id=? order by time desc", (pid,))
    return rows("select * from alerts order by time desc")


def messages(pid: str) -> list:
    """Messages for a patient, oldest first."""
    return rows("select * from messages where patient_id=? order by time", (pid,))


def observations(pid: str) -> list[dict]:
    """Observations grouped per week as {'week': w, 'values': {...}}."""
    out: dict[int, dict] = {}
    for r in rows("select * from observations where patient_id=? order by week", (pid,)):
        out.setdefault(int(r["week"]), {})[r["key"]] = float(r["value"])
    return [{"week": w, "values": v} for w, v in sorted(out.items())]


def add_observation(pid: str, week: int, key: str, value: float, sem: float) -> None:
    """Store one observation, replacing any earlier value for that week and key."""
    run("delete from observations where patient_id=? and week=? and key=?", (pid, week, key))
    put("observations", {"id": new_id("obs"), "patient_id": pid, "week": int(week),
                         "key": key, "value": float(value), "sem": float(sem)})


def event(pid: str, kind: str, payload: dict | None = None) -> str:
    """Append an event."""
    eid = new_id("ev")
    put("events", {"id": eid, "patient_id": pid, "kind": kind, "time": now(),
                   "payload": enc(payload or {})})
    return eid


def message(pid: str, direction: str, body: str, channel: str = "mock", kind: str = "",
            status: str = "sent", provider_id: str = "", space_id: str = "",
            detail: str = "") -> str:
    """Append a message in either direction, recording what really happened to it.

    `channel` is one of imessage, sms or mock and is never guessed. `status` is the honest
    one: a provider accepting a message is not the same as a phone receiving it, so a fresh
    send is `sent` and only becomes `delivered` when the provider says so. `failed` carries
    the reason in `detail`.
    """
    mid = new_id("msg")
    put("messages", {"id": mid, "patient_id": pid, "dir": direction, "body": body,
                     "time": now(), "channel": channel, "kind": kind,
                     "status": status, "provider_id": provider_id,
                     "space_id": space_id, "detail": detail})
    return mid


def message_status(mid: str, status: str, detail: str = "") -> None:
    """Move one message to a new delivery state."""
    patch("messages", mid, {"status": status, **({"detail": detail} if detail else {})})


def latest_forecast(pid: str):
    """Most recent stored forecast row or None.

    `time` now carries microseconds, so the id is only a stability tie-break. Before
    this, two rows written in the same second could tie and a stale forecast could win.
    """
    return one("select * from forecasts where patient_id=? order by week desc, time desc, id desc limit 1",
               (pid,))


def latest_params(pid: str):
    """Most recent stored parameter row or None."""
    return one("select * from parameters where patient_id=? order by week desc, time desc, id desc limit 1",
               (pid,))


def consent(token: str):
    """One consent row or None."""
    return one("select * from consents where token=?", (token,))


def consent_for(pid: str):
    """Consent row for a patient or None."""
    return one("select * from consents where patient_id=?", (pid,))


def uploads(pid: str) -> list:
    """Upload rows for a patient."""
    return rows("select * from uploads where patient_id=? order by time", (pid,))


def twin_inputs(pid: str):
    """Stored twin input bundle or None."""
    return one("select * from twin_inputs where patient_id=? order by time desc, id desc limit 1",
               (pid,))


def wipe() -> None:
    """Delete every row in every table that a demo reset rebuilds.

    Clinicians, clinics and sessions survive on purpose: resetting the demo data must
    not sign everybody out. Assignments are rebuilt from the fresh patient ids.
    """
    if is_pg():
        run(f"truncate table {', '.join(WIPE)}")
        return
    for table in WIPE:
        run(f"delete from {table}")


def metric_insert(rows: list[tuple]) -> int:
    """Append (time, patient_id, token, metric, value, quality) samples."""
    return insert_many(
        "metric_samples",
        ["time", "patient_id", "session_token", "metric", "value", "quality"],
        rows,
    )


def count(sql: str, args: tuple = ()) -> int:
    """A single integer count query, for the dashboards."""
    row = one(sql, args)
    if row is None:
        return 0
    try:
        return int(list(row.values())[0] if isinstance(row, dict) else row[0])
    except (TypeError, ValueError, IndexError):
        return 0
