"""Finish a web call: assemble what the phone posted, measure it, update the twin.

This is the same tail the FaceTime rig ran, reached from a different front end. The
features, the quality gates, the filter update, the alert rules and both summaries are
the existing code, so a web call and a rig call end up as the same kind of check-in.
"""

from .. import db
from ..agent import summary
from ..features import pipeline, sem as semmod, webframes
from . import audio as audiomod
from . import sessions


def finish(token: str, aborted: bool = False) -> dict:
    """Run the whole tail for one session and return what it produced."""
    row = sessions.get(token)
    if row is None:
        return {"ok": False, "error": "unknown token"}
    pid = str(row["patient_id"])
    week = int(row["week"] or 0)
    pat = db.patient(pid)
    name = str(pat["name"]) if pat else "the patient"

    if aborted:
        sessions.set_state(token, "stopped", finished=db.now())
        db.event(pid, "call_aborted", {"week": week, "token_tail": token[-6:]})
        audiomod.discard(token)
        return {"ok": True, "aborted": True, "call_id": None}

    sessions.set_state(token, "processing")
    try:
        got = measure(token, pid, week)
    except Exception as exc:
        sessions.set_state(token, "failed", error=str(exc)[:400], finished=db.now())
        db.event(pid, "call_failed", {"week": week, "error": str(exc)[:400]})
        from .. import alerts as alertmod

        alertmod.missed(pid, week)
        audiomod.discard(token)
        return {"ok": False, "error": str(exc)[:400]}

    sessions.set_state(token, "done", finished=db.now(), call_id=got["call_id"],
                       summary=got["patient_note"], channel=db.enc(got["channel"]))
    audiomod.discard(token)
    sessions.clear_chunks(token)
    return {"ok": True, "call_id": got["call_id"], "alerts": got["alerts"],
            "summary": got["patient_note"], "name": name}


def mock_call(token: str) -> dict:
    """Run a generated web call through the real routes' own code paths.

    Everything a phone would post is generated, stored as real chunks, and finished
    through `finish`, so the validation, the camera latency estimate, the calibration fit,
    the feature functions, the filter update and the alert rules all run for real. The
    only thing missing is the phone.
    """
    from .. import demo
    from ..features import websynth

    row = sessions.get(token)
    if row is None:
        return {"ok": False, "error": "unknown token"}
    pid = str(row["patient_id"])
    week = int(row["week"] or 0)
    pat = db.patient(pid)

    truth = demo.truth_of(pid)
    if week not in truth:
        truth[week] = demo.extend_truth(pid, truth, week)
        demo.set_truth(pid, truth)
    poor = demo.profile_of(pid) == "low_quality"

    sessions.open_session(token)
    sessions.patch(token, {"consent": db.enc(
        {"calls": True, "ai": True, "recording": True, "genetic": False})})

    got = websynth.session(truth[week], seed=int(pat["seed"] or 0) * 100 + week, poor=poor)
    for chunk in got["chunks"]:
        sessions.store_chunk(token, chunk["task"], chunk["kind"], chunk["payload"])
    sessions.patch(token, {
        "symptoms": db.enc({"symptoms": got["answers"]["symptoms"]}),
        "meta": db.enc({**got["meta"], "ah_duration": got["ah_duration"],
                        "ptk_rate": got["ptk_rate"], "mock": True,
                        "answers": got["answers"], "words": got["words"]}),
    })
    return finish(token)


def measure(token: str, pid: str, week: int) -> dict:
    """Assemble, measure, store the check-in, update the twin, notify."""
    from .. import demo

    row = db.patient(pid)
    chunks = sessions.chunks(token)
    sess_row = sessions.get(token)
    stored = db.dec(sess_row["symptoms"], {}) or {}
    meta = db.dec(sess_row["meta"], {}) or {}

    # The spoken answers. A real call collects them task by task through the routes; the
    # mock path hands the whole set over at once. The per task answers the page posted
    # win over the generated ones, because on a real call they are the measurement.
    answers = dict(meta.get("answers") or {})
    answers.update(stored.get("answers") or {})
    if stored.get("symptoms"):
        answers["symptoms"] = stored["symptoms"]

    waves = audiomod.waves(token)
    extra = {}
    for key in ("ah_duration", "ptk_rate"):
        if meta.get(key) is not None:
            extra[key] = meta[key]

    sess = webframes.assemble(
        chunks,
        answers=answers,
        audio_tasks=waves,
        words=words_from(waves) or list(meta.get("words") or []),
        extra=extra,
    )

    hist = db.observations(pid)
    prev = next((h["values"] for h in reversed(hist) if int(h["week"]) < week), None)
    base = next((h["values"] for h in hist if int(h["week"]) == 0), None)
    res = pipeline.run(sess, prev=prev, age=int(row["age"] or 30), sex=str(row["sex"]),
                       baseline=base)

    cid = store(pid, week, token, sess, res)
    out = demo.assimilate(pid, week, pipeline.observables(res["values"]), res["channel"])

    name = str(row["name"])
    note = summary.patient_text(name, week, res)
    from ..comms import notify

    notify.send(pid, "post_call", body=note)
    if out["alerts"]:
        from ..comms import clinic_call

        clinic_call.call(pid, summary.clinician_text(name, week, res))

    return {"call_id": cid, "alerts": [a["type"] for a in out["alerts"]],
            "patient_note": note, "channel": res["channel"], "drift_z": out["diag"]["drift_z"]}


def words_from(waves: dict) -> list[dict]:
    """Transcribe the spoken tasks into timed words, or an empty list without a model."""
    from ..features import speech

    out = []
    for task in ("passage", "numbers", "picture", "fluency", "recall"):
        wave = waves.get(task)
        if wave is None:
            continue
        got = speech.transcribe(wave, audiomod.SR)
        for word in got["words"]:
            out.append({**word, "task": task})
    return out


def store(pid: str, week: int, token: str, sess: dict, res: dict) -> str:
    """Store the check-in and its observations."""
    cid = db.new_id("chk")
    steps = res["steps"]
    db.put("checkins", {
        "id": cid, "patient_id": pid, "week": int(week), "date": db.now(),
        "duration_s": float(sess.get("seconds") or 0.0), "steps": db.enc(steps),
        "channel": db.enc(res["channel"]), "features": db.enc(res["features"]),
        "gaze": db.enc(res["gaze"]), "traces": db.enc(res["traces"]),
        "transcript": db.enc(transcript_of(token)),
        "unusable": int(not res["quality"]["ok"]),
    })
    for key, val in pipeline.observables(res["values"]).items():
        db.add_observation(pid, week, key, float(val), semmod.sem(key))
    db.patch("patients", pid, {"last_call": db.now(), "week": int(week)})
    return cid


def transcript_of(token: str) -> list[dict]:
    """What was said during the call, from the lines the page reported it had spoken."""
    rows = db.rows("select * from call_frames where token=? and kind='line' order by time, rowid",
                   (token,))
    out = []
    for row in rows:
        got = db.dec(row["payload"], {}) or {}
        if got.get("text"):
            out.append({"who": str(got.get("who") or "agent"), "text": str(got["text"]),
                        "t": float(got.get("t") or 0.0)})
    return out
