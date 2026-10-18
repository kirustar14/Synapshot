"""Alert rules over the posterior, the drift z and the call quality."""

from . import db, live
from .comms import notify as texter

DRIFT_Z = 2.0        # drift z above this counts as a drifting week
DRIFT_WEEKS = 2      # consecutive drifting weeks needed to raise the alert
FACE_SHARE = 0.7     # below this share of frames with a face the call is low quality
CALIB_DEG = 3.0      # above this calibration error the eye tasks are not trustworthy

TEXTS = {"red_flag", "low_quality", "missed_call"}   # alert types that text the patient


def create(pid: str, kind: str, trigger: str, notify: bool = True) -> dict:
    """Store an alert, text the patient for the serious kinds, and push it to the screen.

    Nothing phones anybody any more. The outbound clinic call is gone: an alert lands in
    the clinician's workspace, in the left rail, over the event stream. A rule that can
    fire several times in a row should not be able to ring a phone several times in a row.
    """
    row = db.patient(pid)
    aid = db.new_id("al")

    if notify and kind in TEXTS:
        kinds = {"red_flag": "emergency", "low_quality": "low_quality"}
        texter.send(pid, kinds.get(kind, "missed_call"))

    db.put("alerts", {
        "id": aid, "patient_id": pid, "type": kind, "trigger": trigger,
        "time": db.now(), "called": 0, "acked": 0,
    })
    db.event(pid, "alert", {"type": kind, "trigger": trigger})
    live.publish(pid, "alert", {"id": aid, "type": kind, "trigger": trigger})
    del row
    return {"id": aid, "patient_id": pid, "type": kind, "trigger": trigger,
            "time": db.now(), "called": False, "acked": False}


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


def explain(aid: str) -> dict:
    """The rule behind one alert and the numbers that tripped it.

    The left rail shows a one line reason and this is what opens when you click it, so
    a flag is never just a coloured dot with an assertion attached.
    """
    row = db.one("select * from alerts where id=?", (aid,))
    if row is None:
        return {"ok": False, "error": "no such alert"}
    kind = str(row["type"])
    rules = {
        "drift": {
            "rule": "drift z above 2.0 for two consecutive weeks",
            "detail": "drift z is the mean standardized residual of the last two weeks, "
                      "signed so positive means reality is worse than the twin expected. "
                      "One bad week is noise, two in a row is a trend.",
            "threshold": DRIFT_Z,
        },
        "low_quality": {
            "rule": f"a face in under {FACE_SHARE:.0%} of frames, or calibration error "
                    f"above {CALIB_DEG:.0f} degrees, or the flash timing test failed",
            "detail": "the eye measures are deleted rather than reported through a "
                      "channel that cannot support them.",
            "threshold": FACE_SHARE,
        },
        "red_flag": {
            "rule": "any yes on the seven item safety screen",
            "detail": "the check-in stops before anything is measured and the patient is "
                      "told to get medical help now. A clinician must confirm this "
                      "question list before any use outside the team.",
            "threshold": 1,
        },
        "missed_call": {
            "rule": "no completed check-in for the week",
            "detail": "no measurements, so the filter has nothing to assimilate and the "
                      "band widens.",
            "threshold": 0,
        },
    }
    got = rules.get(kind, {"rule": kind, "detail": "", "threshold": 0})
    state = {}
    pid = str(row["patient_id"])
    pat = db.patient(pid)
    if pat is not None:
        state = {"drift_z": round(float(pat["drift_z"] or 0.0), 3),
                 "coverage": round(float(pat["coverage"] or 0.0), 3),
                 "week": int(pat["week"] or 0)}
    return {"ok": True, "id": aid, "type": kind, "trigger": row["trigger"],
            "time": row["time"], **got, "state": state}


def flags(pid: str) -> list[str]:
    """Distinct alert types for a patient, for the patient list row."""
    return sorted({str(r["type"]) for r in db.alerts(pid)})
