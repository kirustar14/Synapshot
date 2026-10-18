"""The patient's history as a calendar, and where they sit against the cohort.

Two things the workspace needs that nothing else assembled:

`events()` is every dated thing that happened to one patient, in one list, already sorted
and already labelled for a human. Check-ins, alerts, messages, the ingest, the twin
builds: they live in four different tables and the Timeline tab should not have to know
that.

`percentile()` is where this patient's recovery rate sits in the fitted population. It is
a ribbon with a marker on it, not a grade. The population is 50 synthetic patients fitted
by the same model, so the percentile says "compared with people this model has seen",
which is a much narrower claim than it looks like and the payload says so.
"""

import datetime as dt

import numpy as np

from . import db
from .twin import population

# What each event kind is called on screen, and which colour band the day dot takes.
# Anything not in here still appears, labelled by its own kind, rather than being dropped:
# a timeline that silently omits event types is worse than one with an odd label on it.
KINDS: dict[str, tuple[str, str]] = {
    "call_session": ("Check-in started", "call"),
    "checkin": ("Check-in completed", "call"),
    "call_aborted": ("Check-in stopped early", "warn"),
    "call_failed": ("Check-in failed to process", "warn"),
    "call_red_flag": ("Safety screen positive, tasks stopped", "flag"),
    "alert": ("Flag raised", "flag"),
    "checkin_unusable": ("Check-in marked unusable", "warn"),
    "rescored": ("Task rescored", "note"),
    "note": ("Clinician note", "note"),
    "midweek_symptom": ("Midweek symptom reply", "note"),
    "consent": ("Consent recorded", "note"),
    "consent_withdrawn": ("Consent withdrawn", "warn"),
    "ingest": ("Documents read", "note"),
    "twin_built": ("Twin rebuilt", "note"),
    "notify": ("Message sent", "message"),
    "drift_injected": ("Drift injected (demo control)", "note"),
    "demo_profile": ("Created from a demo profile", "note"),
}

BANDS = {
    "call": "A check-in happened on this day.",
    "flag": "A flag was raised on this day.",
    "warn": "Something did not complete on this day.",
    "note": "A record was added on this day.",
    "message": "A message went out on this day.",
}


def day_of(stamp: str) -> str:
    """The calendar day of a timestamp, as an ISO date."""
    return str(stamp or "")[:10]


def label(kind: str, payload: dict) -> tuple[str, str]:
    """The human label and the band for one event."""
    if kind in KINDS:
        text, band = KINDS[kind]
        if kind == "alert":
            text = f"Flag raised: {str(payload.get('type', '')).replace('_', ' ')}"
        if kind == "ingest":
            n = payload.get("fields")
            text = f"Documents read, {n} fields" if n else text
        return text, band
    return kind.replace("_", " ").capitalize(), "note"


def events(pid: str) -> list[dict]:
    """Everything dated that happened to this patient, oldest first.

    Check-ins come from their own table rather than the event log, because a check-in is
    the thing the week is about and it carries the measurements. The rest is the event
    log and the message log.
    """
    out: list[dict] = []

    for row in db.checkins(pid):
        channel = db.dec(row["channel"], {}) or {}
        out.append({
            "time": str(row["date"]),
            "day": day_of(row["date"]),
            "kind": "checkin",
            "label": "Check-in completed" if not row["unusable"] else "Check-in, unusable",
            "band": "warn" if row["unusable"] else "call",
            "week": int(row["week"] or 0),
            "id": str(row["id"]),
            "detail": {
                "duration_s": round(float(row["duration_s"] or 0.0), 1),
                "face_share": round(float(channel.get("face_share", 0.0)), 3),
                "fps": round(float(channel.get("fps", 0.0)), 1),
                "flash_ok": bool(channel.get("flash_ok", False)),
                "unusable": bool(row["unusable"]),
            },
        })

    for row in db.rows("select * from events where patient_id=? order by time", (pid,)):
        kind = str(row["kind"])
        payload = db.dec(row["payload"], {}) or {}
        text, band = label(kind, payload)
        out.append({
            "time": str(row["time"]),
            "day": day_of(row["time"]),
            "kind": kind,
            "label": text,
            "band": band,
            "id": str(row["id"]),
            "detail": _trim(payload),
        })

    for row in db.messages(pid):
        body = str(row["body"] or "")
        out.append({
            "time": str(row["time"]),
            "day": day_of(row["time"]),
            "kind": "message",
            "label": f"Message {'out' if row['dir'] == 'out' else 'in'} by {row['channel']}",
            "band": "message",
            "id": str(row["id"]),
            "detail": {"dir": str(row["dir"]), "channel": str(row["channel"]),
                       "body": body[:300]},
        })

    out.sort(key=lambda e: e["time"])
    return out


def _trim(payload: dict) -> dict:
    """An event payload small enough to send to a calendar.

    The ingest event carries the whole extraction, which is tens of kilobytes and is
    already served by the provenance route. A timeline does not need it.
    """
    out = {}
    for key, value in (payload or {}).items():
        if key in ("extraction", "sources"):
            continue
        if isinstance(value, (list, dict)) and len(str(value)) > 400:
            out[key] = f"{len(value)} items"
            continue
        out[key] = value
    return out


def days(pid: str) -> list[dict]:
    """One row per calendar day that has anything on it, for the month grid."""
    by_day: dict[str, dict] = {}
    for event in events(pid):
        day = event["day"]
        if not day:
            continue
        got = by_day.setdefault(day, {"day": day, "bands": [], "count": 0, "labels": []})
        got["count"] += 1
        if event["band"] not in got["bands"]:
            got["bands"].append(event["band"])
        if len(got["labels"]) < 4:
            got["labels"].append(event["label"])
    return [by_day[k] for k in sorted(by_day)]


def next_call(pid: str) -> dict:
    """When the next check-in is due, from the week the patient is on.

    Weekly, counted from the last completed check-in. If there has never been one, it is
    due now: a patient with no measurements is the one the schedule exists for.
    """
    row = db.patient(pid)
    if row is None:
        return {"due": None, "overdue": False, "say": "no such patient"}
    chk = db.checkins(pid)
    if not chk:
        return {"due": None, "last": None, "overdue": True,
                "say": "No check-in yet. The first one sets the baseline."}
    last = str(chk[-1]["date"])
    try:
        when = dt.datetime.fromisoformat(last.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return {"due": None, "last": last, "overdue": False, "say": "last check-in date unreadable"}
    due = when + dt.timedelta(days=7)
    late = (dt.datetime.now() - due).days
    return {
        "due": due.isoformat(timespec="seconds"),
        "last": last,
        "overdue": late > 0,
        "days_late": max(0, late),
        "say": (f"Due {due.date().isoformat()}"
                + (f", {late} day{'s' if late != 1 else ''} overdue" if late > 0 else "")),
    }


def percentile(pid: str) -> dict:
    """Where this patient's recovery rate sits in the fitted population.

    The rate is k, the exponential constant in the damage decay: higher is faster. The
    comparison is against the cohort the population layer fitted, and the honest reading
    of it is in `say` and `limits`, not in the number.
    """
    row = db.patient(pid)
    if row is None:
        return {"ok": False}
    params = db.dec(row["params"], {}) or {}
    k = params.get("k")
    cohort = population.load()
    if cohort is None or k is None:
        return {
            "ok": False,
            "say": "No population fit yet. Run make seed to build the cohort.",
        }

    ks = np.asarray(cohort.get("k_est") or [], dtype=float)
    ks = ks[np.isfinite(ks)]
    if ks.size < 10:
        return {"ok": False, "say": "The cohort is too small to place anybody in it."}

    k = float(k)
    pct = float((ks < k).mean() * 100.0)
    # Outside the cohort's own range there is no percentile to report. Printing "0th"
    # for a patient slower than every fitted member reads as a precise placing when the
    # honest statement is that the cohort does not contain anybody like them.
    outside = ""
    if k < float(ks.min()):
        outside = "below"
    elif k > float(ks.max()):
        outside = "above"

    return {
        "ok": True,
        "k": round(k, 4),
        "percentile": round(pct, 1),
        "outside": outside,
        "size": int(ks.size),
        "quartiles": [round(float(np.percentile(ks, q)), 4) for q in (25, 50, 75)],
        "range": [round(float(ks.min()), 4), round(float(ks.max()), 4)],
        "histogram": _histogram(ks),
        "say": _say(pct, outside),
        "limits": [
            f"The cohort is {ks.size} synthetic patients fitted by this same model, so "
            "this says where they sit among people the model has seen, not among people.",
            "k is one number for the whole brain. Two patients with the same k can be "
            "recovering differently in different regions.",
            "A percentile is not a target. Nothing here says a faster rate is the right "
            "outcome for this person.",
        ],
    }


def _histogram(ks: np.ndarray, bins: int = 20) -> list[dict]:
    """The cohort's rate distribution, for the ribbon behind the marker."""
    counts, edges = np.histogram(ks, bins=bins)
    return [{"from": round(float(edges[i]), 4), "to": round(float(edges[i + 1]), 4),
             "count": int(counts[i])} for i in range(len(counts))]


def _say(pct: float, outside: str = "") -> str:
    """One sentence about a percentile that does not read as a grade."""
    if outside == "below":
        return ("This patient's fitted recovery rate is slower than every patient in the "
                "cohort, so there is no percentile to give. The cohort does not contain "
                "anybody recovering at this rate.")
    if outside == "above":
        return ("This patient's fitted recovery rate is faster than every patient in the "
                "cohort, so there is no percentile to give.")
    if pct >= 75:
        where = "in the faster quarter of"
    elif pct >= 50:
        where = "in the faster half of"
    elif pct >= 25:
        where = "in the slower half of"
    else:
        where = "in the slower quarter of"
    return (f"This patient's fitted recovery rate sits {where} the cohort, at the "
            f"{pct:.0f}th percentile.")
