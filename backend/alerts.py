"""Alert rules over the posterior, the drift z and the call quality."""

from . import db
from .comms import clinic_call
from .comms import notify as texter

DRIFT_Z = 2.0        # drift z above this counts as a drifting week
DRIFT_WEEKS = 2      # consecutive drifting weeks needed to raise the alert
FACE_SHARE = 0.7     # below this share of frames with a face the call is low quality
CALIB_DEG = 3.0      # above this calibration error the eye tasks are not trustworthy

CALLS = {"red_flag", "drift"}        # alert types that ring the clinic
TEXTS = {"red_flag", "low_quality", "missed_call"}   # alert types that text the patient


def create(pid: str, kind: str, trigger: str, notify: bool = True) -> dict:
    """Store an alert and, for the serious kinds, ring the clinic and text the patient."""
    row = db.patient(pid)
    name = str(row["name"]) if row else "the patient"
    aid = db.new_id("al")
    called = False

    if notify and kind in CALLS:
        week = int(row["week"] or 0) if row else 0
        text = f"Synapshot alert for {name}, week {week}. {trigger} Please review the dashboard."
        called = bool(clinic_call.call(pid, text).get("ok"))

    if notify and kind in TEXTS:
        kinds = {"red_flag": "emergency", "low_quality": "low_quality"}
        texter.send(pid, kinds.get(kind, "missed_call"))

    db.put("alerts", {
        "id": aid, "patient_id": pid, "type": kind, "trigger": trigger,
        "time": db.now(), "called": int(called), "acked": 0,
    })
    db.event(pid, "alert", {"type": kind, "trigger": trigger, "called": called})
    return {"id": aid, "patient_id": pid, "type": kind, "trigger": trigger, "time": db.now(), "called": called, "acked": False}


def drift_rule(state: dict) -> tuple[bool, str]:
    """True when drift z stayed above the threshold for two consecutive weeks.

    drift_z(w) = mean standardized residual of weeks w-1 and w, signed toward worse
    rule: drift_z(w) > 2 and drift_z(w-1) > 2
    """
    hist = [h for h in state.get("drift_hist", []) if h.get("z") is not None]
    if len(hist) < DRIFT_WEEKS:
        return False, ""
    last = hist[-DRIFT_WEEKS:]
    if all(float(h["z"]) > DRIFT_Z for h in last):
        weeks = ", ".join(str(int(h["week"])) for h in last)
        return True, f"Reality has been outside the forecast band toward worse for weeks {weeks}, drift z {last[-1]['z']:.1f}."
    return False, ""


def quality_rule(channel: dict) -> tuple[bool, str]:
    """True when the video channel was too poor to trust the eye measures."""
    share = float(channel.get("face_share", 1.0))
    err = float(channel.get("calib_err_deg", 0.0))
    if share < FACE_SHARE:
        return True, f"A face was visible in only {share:.0%} of frames, below the {FACE_SHARE:.0%} gate."
    if err > CALIB_DEG:
        return True, f"Gaze calibration error was {err:.1f} degrees, above the {CALIB_DEG:.0f} degree gate."
    if not channel.get("flash_ok", True):
        return True, "The flash timing test failed, so every tier B timing measure was dropped."
    return False, ""


def recent(pid: str, kind: str, within: int = 1) -> bool:
    """True when an alert of this kind already exists for the last `within` weeks."""
    row = db.patient(pid)
    week = int(row["week"] or 0) if row else 0
    for al in db.alerts(pid):
        if al["type"] == kind and week - weeks_of(al) <= within:
            return True
    return False


def weeks_of(alert_row) -> int:
    """Week number mentioned in an alert trigger, or 0 when there is none."""
    import re

    hit = re.search(r"week[s]? ([0-9]+)", str(alert_row["trigger"]))
    return int(hit.group(1)) if hit else 0


def check(pid: str, week: int, channel: dict, state: dict, notify: bool = True) -> list[dict]:
    """Run every rule after a call and return the alerts that fired."""
    out = []
    hit, why = quality_rule(channel or {})
    if hit and not recent(pid, "low_quality", within=1):
        out.append(create(pid, "low_quality", f"Week {week}. {why}", notify))
    hit, why = drift_rule(state or {})
    if hit and not recent(pid, "drift", within=1):
        out.append(create(pid, "drift", f"Week {week}. {why}", notify))
    return out


def missed(pid: str, week: int, notify: bool = True) -> dict:
    """Raise a missed call alert for a week with no check-in."""
    return create(pid, "missed_call", f"Week {week}. No call completed this week.", notify)


def red_flag(pid: str, answers: dict, notify: bool = True) -> dict:
    """Raise a red flag alert from the safety screen answers."""
    yes = [k.replace("_", " ") for k, v in answers.items() if v]
    return create(pid, "red_flag", "Red flag screen positive for " + ", ".join(yes) + ". Tasks stopped.", notify)


def ack(aid: str) -> None:
    """Mark an alert acknowledged."""
    db.patch("alerts", aid, {"acked": 1})


def call_now(aid: str) -> dict:
    """Ring the clinic for an existing alert and mark it called."""
    row = db.one("select * from alerts where id=?", (aid,))
    if row is None:
        return {"ok": False, "error": "no such alert"}
    pat = db.patient(row["patient_id"])
    name = str(pat["name"]) if pat else "the patient"
    got = clinic_call.call(row["patient_id"], f"Synapshot alert for {name}. {row['trigger']}")
    db.patch("alerts", aid, {"called": 1 if got.get("ok") else 0})
    return got


def flags(pid: str) -> list[str]:
    """Distinct alert types for a patient, for the patient list row."""
    return sorted({str(r["type"]) for r in db.alerts(pid)})
