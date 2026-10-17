"""The two summaries: a plain one for the patient, a structured one for the clinician.

The patient summary carries no scores and no interpretation. Telling someone their
pursuit gain fell is not useful to them and is alarming, so it says what happened and
what comes next, nothing more.
"""

from .. import db
from . import llm, safety


# Appended verbatim to every patient summary, never paraphrased. The model was asked to
# rephrase the whole message once and quietly dropped this sentence, which is the only
# part that matters if something is going wrong. See DECISIONS.md.
SAFETY_CLOSE = (
    "If anything feels worse before our next call, contact your clinician directly, and if "
    "it is urgent get medical help straight away."
)


def patient_text(name: str, week: int, got: dict | None = None) -> str:
    """Plain language close of the call, suitable for iMessage. No scores, no diagnosis."""
    first = name.split()[0]
    video_ok = bool((got or {}).get("quality", {}).get("ok", True))
    if video_ok:
        base = (f"Thanks {first}, that is week {week} done. Everything you did is recorded and "
                "your clinician will see it. Same time next week.")
    else:
        base = (f"Thanks {first}, that is week {week} done. The video was not clear enough "
                "today for part of it, so we will redo that part next week. Nothing for you "
                "to do.")
    facts = {"week": week, "first_name": first, "video_ok": video_ok}
    body = safety.clean(llm.summarize("patient", facts, base))
    return f"{body} {SAFETY_CLOSE}"


def clinician_text(name: str, week: int, got: dict | None, flags: list[str] | None = None) -> str:
    """Structured update, read aloud on the clinic call. Numbers are fine here."""
    flags = flags or []
    if flags:
        items = ", ".join(f.replace("_", " ") for f in flags)
        return (
            f"Red flag screen positive for {name}, week {week}. Positive items: {items}. "
            "The check-in was stopped before any task and the patient was told to seek "
            "medical care now. No measurements were taken."
        )
    if got is None:
        return f"Week {week} check-in for {name} did not complete. No measurements were taken."

    chan = got.get("channel", {})
    lines = [
        f"Week {week} check-in for {name} completed.",
        f"Channel: {chan.get('fps', 0):.0f} frames per second, "
        f"calibration error {chan.get('calib_err_deg', 0):.1f} degrees, "
        f"face visible {float(chan.get('face_share', 0)) * 100:.0f} percent of frames, "
        f"flash timing {'passed' if chan.get('flash_ok') else 'failed'}.",
    ]
    changed = [f for f in got.get("features", []) if f.get("changed")]
    if changed:
        parts = []
        for f in changed[:5]:
            arrow = "up" if (f.get("prev") is not None and f["value"] > f["prev"]) else "down"
            parts.append(f"{f['name'].replace('_', ' ')} {arrow} to {f['value']:.2f} {f['unit']}")
        lines.append("Beyond the minimal detectable change: " + "; ".join(parts) + ".")
    else:
        lines.append("No measure moved beyond its minimal detectable change this week.")
    if not got.get("quality", {}).get("ok", True):
        lines.append("Quality gate failed, so the eye measures were not reported: "
                     + str(got["quality"].get("reason", "")) + ".")
    return " ".join(lines)


def drift_text(name: str, week: int, drift_z: float, trigger: str) -> str:
    """The line the clinic call reads for a drift alert."""
    return (
        f"Drift alert for {name} at week {week}. {trigger} "
        f"Current drift z is {drift_z:.1f}. The twin's forecast and the measurements have "
        "separated toward worse for two consecutive weeks. Please review the dashboard."
    )


def store_patient_note(pid: str, text: str) -> str:
    """Record the patient summary as an outgoing message."""
    return db.message(pid, "out", safety.clean(text))


def for_checkin(pid: str, week: int) -> dict:
    """Both summaries for a stored check-in, used by the API and the clinic call."""
    row = db.patient(pid)
    name = str(row["name"]) if row else "the patient"
    chk = db.one("select * from checkins where patient_id=? and week=? order by date desc limit 1", (pid, week))
    if chk is None:
        return {"patient": "", "clinician": clinician_text(name, week, None)}
    got = {
        "channel": db.dec(chk["channel"], {}) or {},
        "features": db.dec(chk["features"], []) or [],
        "quality": {"ok": True},
    }
    return {
        "patient": patient_text(name, week, got),
        "clinician": clinician_text(name, week, got),
    }
