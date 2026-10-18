"""Call sessions: one token, one link, one call, expires in a day.

A token is 32 random bytes urlsafe. It is the only credential the patient ever has, so it
is single use, time limited and rate limited, and it is never logged next to anything
else about them. Everything the page posts arrives with the token in the path, and every
route looks the session up here first.
"""

import secrets
import time

from .. import db
from ..config import cfg

TTL_S = 24 * 3600          # a link is good for a day
RATE_WINDOW_S = 10.0       # rolling window for the per token and per IP limit
RATE_MAX = 120             # posts allowed in that window, frames arrive about every 200 ms
STATES = ("waiting", "in_call", "stopped", "processing", "done", "failed")

SCHEMA = """
create table if not exists call_sessions (
  token text primary key, patient_id text, week integer, state text,
  created text, opened text, finished text, expires real,
  consent text, redflags text, symptoms text, short integer default 0,
  call_id text, summary text, meta text, channel text, error text
);
create table if not exists call_frames (
  id text primary key, token text, task text, kind text, payload text, time text
);
create index if not exists ix_frames_token on call_frames(token, task);
"""

_HITS: dict[str, list[float]] = {}


def setup() -> None:
    """Create the two call tables. Safe to call repeatedly."""
    with db.LOCK:
        db.conn().executescript(SCHEMA)
        db.conn().commit()


def create(pid: str, week: int | None = None) -> dict:
    """A new session for one patient, and the link the patient opens."""
    setup()
    row = db.patient(pid)
    if row is None:
        raise KeyError(f"no patient {pid}")
    week = int(row["week"] or 0) + 1 if week is None else int(week)
    token = secrets.token_urlsafe(32)
    now = time.time()
    db.put("call_sessions", {
        "token": token, "patient_id": pid, "week": int(week), "state": "waiting",
        "created": db.now(), "opened": None, "finished": None, "expires": now + TTL_S,
        "consent": None, "redflags": None, "symptoms": None, "short": 0,
        "call_id": None, "summary": None, "meta": None, "channel": None, "error": None,
    })
    db.event(pid, "call_session", {"week": int(week), "state": "waiting"})
    return {
        "token": token,
        "url": f"{cfg.base_url()}/call/{token}",
        "expires": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(now + TTL_S)),
    }


def get(token: str):
    """One session row, or None when the token is unknown."""
    setup()
    return db.one("select * from call_sessions where token=?", (token,))


def live(token: str):
    """One session row that is usable, or None when it is unknown or expired."""
    row = get(token)
    if row is None:
        return None
    if float(row["expires"] or 0) < time.time():
        return None
    return row


def expired(token: str) -> bool:
    """True when the token exists but its day is up."""
    row = get(token)
    return row is not None and float(row["expires"] or 0) < time.time()


def patch(token: str, fields: dict) -> None:
    """Update some columns of one session."""
    db.patch("call_sessions", token, fields, key="token")


def set_state(token: str, state: str, **extra) -> None:
    """Move a session to a new state."""
    if state not in STATES:
        raise ValueError(state)
    patch(token, {"state": state, **extra})


def open_session(token: str) -> None:
    """Mark the moment the patient actually opened the page."""
    row = get(token)
    if row is not None and not row["opened"]:
        patch(token, {"opened": db.now(), "state": "in_call"})


def rate_ok(key: str, limit: int = RATE_MAX, window: float = RATE_WINDOW_S) -> bool:
    """A rolling window rate limit, per token or per client address.

    In process and deliberately simple. It exists so one misbehaving page cannot flood
    the ingest, not to stand up to a determined attacker.
    """
    now = time.monotonic()
    hits = [t for t in _HITS.get(key, []) if now - t < window]
    hits.append(now)
    _HITS[key] = hits
    return len(hits) <= limit


def consent_ok(row) -> bool:
    """Whether the three required consents are in. Genetic is separate and optional."""
    got = db.dec(row["consent"], {}) or {}
    return bool(got.get("calls")) and bool(got.get("ai")) and bool(got.get("recording"))


def store_chunk(token: str, task: str, kind: str, payload) -> str:
    """Append one chunk of frames or stimulus events for a task."""
    setup()
    cid = db.new_id("cf")
    db.put("call_frames", {
        "id": cid, "token": token, "task": task, "kind": kind,
        "payload": db.enc(payload), "time": db.now(),
    })
    return cid


def chunks(token: str, kind: str | None = None) -> list[dict]:
    """Every stored chunk for a session, oldest first."""
    setup()
    if kind:
        rows = db.rows("select * from call_frames where token=? and kind=? order by time, rowid",
                       (token, kind))
    else:
        rows = db.rows("select * from call_frames where token=? order by time, rowid", (token,))
    return [{"task": r["task"], "kind": r["kind"], "payload": db.dec(r["payload"], [])} for r in rows]


def clear_chunks(token: str) -> None:
    """Drop the raw chunks once the features are out of them."""
    db.run("delete from call_frames where token=?", (token,))


def for_patient(pid: str) -> list[dict]:
    """Session rows for one patient, newest first, for the clinician call log."""
    setup()
    rows = db.rows("select * from call_sessions where patient_id=? order by created desc", (pid,))
    return [{
        "token": r["token"], "week": int(r["week"] or 0), "state": r["state"],
        "created": r["created"], "opened": r["opened"], "finished": r["finished"],
        "call_id": r["call_id"], "channel": db.dec(r["channel"], None),
    } for r in rows]


def purge_expired() -> int:
    """Delete sessions whose day is up along with any chunks they left behind."""
    setup()
    old = db.rows("select token from call_sessions where expires < ?", (time.time(),))
    for row in old:
        db.run("delete from call_frames where token=?", (row["token"],))
    db.run("delete from call_sessions where expires < ?", (time.time(),))
    return len(old)
