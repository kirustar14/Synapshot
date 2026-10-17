"""Sqlite with plain SQL and helper functions. No ORM, no models, just rows."""

import json
import sqlite3
import time
import uuid
from pathlib import Path

from .config import cfg

SCHEMA = """
create table if not exists patients (
  id text primary key, name text, age integer, sex text, week integer,
  injury text, alleles text, biomarkers text, params text, contraction text,
  fc_fit real, coverage real, drift_z real,
  twin_built integer default 0, template_only integer default 0,
  low_fidelity integer default 0, synthetic integer default 1,
  last_call text, created text, seed integer, d0 real, truth text, state text, note text
);
create table if not exists events (
  id text primary key, patient_id text, kind text, time text, payload text
);
create table if not exists checkins (
  id text primary key, patient_id text, week integer, date text, duration_s real,
  steps text, channel text, features text, gaze text, traces text, transcript text,
  unusable integer default 0
);
create table if not exists observations (
  id text primary key, patient_id text, week integer, key text, value real, sem real
);
create table if not exists parameters (
  id text primary key, patient_id text, week integer, payload text, time text
);
create table if not exists forecasts (
  id text primary key, patient_id text, week integer, payload text, time text
);
create table if not exists alerts (
  id text primary key, patient_id text, type text, trigger text, time text,
  called integer default 0, acked integer default 0
);
create table if not exists consents (
  token text primary key, patient_id text, calls integer, ai integer, recording integer,
  genetic integer, time text, withdrawn integer default 0
);
create table if not exists messages (
  id text primary key, patient_id text, dir text, body text, time text
);
create table if not exists uploads (
  id text primary key, patient_id text, kind text, file text, status text, sets text,
  note text, synthetic integer default 1, time text
);
create table if not exists twin_inputs (
  id text primary key, patient_id text, payload text, time text
);
create index if not exists ix_checkins_pat on checkins(patient_id, week);
create index if not exists ix_obs_pat on observations(patient_id, week);
create index if not exists ix_alerts_pat on alerts(patient_id);
create index if not exists ix_msg_pat on messages(patient_id);
"""

_CONN: sqlite3.Connection | None = None


def conn() -> sqlite3.Connection:
    """Open the database once, create the schema if needed."""
    global _CONN
    if _CONN is None:
        Path(cfg.db_path).parent.mkdir(parents=True, exist_ok=True)
        _CONN = sqlite3.connect(str(cfg.db_path), check_same_thread=False)
        _CONN.row_factory = sqlite3.Row
        _CONN.executescript(SCHEMA)
        _CONN.commit()
    return _CONN


def now() -> str:
    """Current time as an ISO second string."""
    return time.strftime("%Y-%m-%dT%H:%M:%S")


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


def run(sql: str, args: tuple = ()) -> sqlite3.Cursor:
    """Execute and commit."""
    cur = conn().execute(sql, args)
    conn().commit()
    return cur


def rows(sql: str, args: tuple = ()) -> list[sqlite3.Row]:
    """All rows of a query."""
    return list(conn().execute(sql, args).fetchall())


def one(sql: str, args: tuple = ()):
    """First row of a query or None."""
    return conn().execute(sql, args).fetchone()


def put(table: str, row: dict) -> str:
    """Insert or replace a row given as a dict, returning its id."""
    keys = list(row)
    sql = f"insert or replace into {table} ({','.join(keys)}) values ({','.join('?' * len(keys))})"
    run(sql, tuple(row[k] for k in keys))
    return str(row.get("id") or row.get("token") or "")


def patch(table: str, ident: str, fields: dict, key: str = "id") -> None:
    """Update some columns of one row."""
    if not fields:
        return
    sets = ",".join(f"{k}=?" for k in fields)
    run(f"update {table} set {sets} where {key}=?", tuple(fields.values()) + (ident,))


def patient(pid: str):
    """One patient row or None."""
    return one("select * from patients where id=?", (pid,))


def patients() -> list[sqlite3.Row]:
    """All patients, newest first."""
    return rows("select * from patients order by created desc")


def checkins(pid: str) -> list[sqlite3.Row]:
    """Check-ins for a patient, oldest first."""
    return rows("select * from checkins where patient_id=? order by week", (pid,))


def checkin(cid: str):
    """One check-in or None."""
    return one("select * from checkins where id=?", (cid,))


def alerts(pid: str | None = None) -> list[sqlite3.Row]:
    """Alerts, optionally for one patient, newest first."""
    if pid:
        return rows("select * from alerts where patient_id=? order by time desc", (pid,))
    return rows("select * from alerts order by time desc")


def messages(pid: str) -> list[sqlite3.Row]:
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
    put("observations", {"id": new_id("obs"), "patient_id": pid, "week": int(week), "key": key, "value": float(value), "sem": float(sem)})


def event(pid: str, kind: str, payload: dict | None = None) -> str:
    """Append an event."""
    eid = new_id("ev")
    put("events", {"id": eid, "patient_id": pid, "kind": kind, "time": now(), "payload": enc(payload or {})})
    return eid


def message(pid: str, direction: str, body: str) -> str:
    """Append a message in either direction."""
    mid = new_id("msg")
    put("messages", {"id": mid, "patient_id": pid, "dir": direction, "body": body, "time": now()})
    return mid


def latest_forecast(pid: str):
    """Most recent stored forecast row or None.

    rowid breaks the tie: `time` is second granularity, and a rescore followed by a
    rebuild inside the same second would otherwise serve whichever row sqlite felt like.
    """
    return one("select * from forecasts where patient_id=? order by week desc, time desc, rowid desc limit 1", (pid,))


def latest_params(pid: str):
    """Most recent stored parameter row or None."""
    return one("select * from parameters where patient_id=? order by week desc, time desc, rowid desc limit 1", (pid,))


def consent(token: str):
    """One consent row or None."""
    return one("select * from consents where token=?", (token,))


def consent_for(pid: str):
    """Consent row for a patient or None."""
    return one("select * from consents where patient_id=?", (pid,))


def uploads(pid: str) -> list[sqlite3.Row]:
    """Upload rows for a patient."""
    return rows("select * from uploads where patient_id=? order by time", (pid,))


def twin_inputs(pid: str):
    """Stored twin input bundle or None."""
    return one("select * from twin_inputs where patient_id=? order by time desc, rowid desc limit 1", (pid,))


def wipe() -> None:
    """Delete every row in every table. Used by the demo reset only."""
    for table in ("patients", "events", "checkins", "observations", "parameters", "forecasts", "alerts", "consents", "messages", "uploads", "twin_inputs"):
        run(f"delete from {table}")
