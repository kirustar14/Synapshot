"""Finish a call: assemble what the phone posted, measure it, update the twin.

The features, the quality gates, the filter update, the alert rules and both summaries
are the same code the pipeline has always used. This runs in a background task, and each
stage pushes one event onto the patient's stream, so the clinician's call modal shows the
real stages going by instead of a spinner that means nothing.
"""

from .. import db, live, tiger
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
    live.publish(pid, "stage", {"name": "assemble", "say": "reading what the phone sent"})
    try:
        got = measure(token, pid, week)
    except Exception as exc:
        sessions.set_state(token, "failed", error=str(exc)[:400], finished=db.now())
        db.event(pid, "call_failed", {"week": week, "error": str(exc)[:400]})
        live.publish(pid, "call_failed", {"week": week, "error": str(exc)[:200]})
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


def mock_call(token: str, degrade: float = 0.0) -> dict:
    """Run a generated web call through the real routes' own code paths.

    Everything a phone would post is generated, stored as real chunks, and finished
    through `finish`, so the validation, the camera latency estimate, the calibration fit,
    the feature functions, the filter update and the alert rules all run for real. The
    only thing missing is the phone.

    `degrade` moves the week in SEM-scaled steps before anything is generated: positive
    for a worse week, negative for a better one, zero for a typical one, which is the
    default. It exists so the update after a call can be shown to be real rather than
    asserted, and it moves the measurements the call is built from rather than the
    result, so every number downstream is still produced by the real pipeline.
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

    values = demo.shift_values(truth[week], degrade)
    got = websynth.session(values, seed=int(pat["seed"] or 0) * 100 + week, poor=poor)
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
    live.publish(pid, "stage", {"name": "measure", "say": "working out the measurements"})
    res = pipeline.run(sess, prev=prev, age=int(row["age"] or 30), sex=str(row["sex"]),
                       baseline=base)

    cid = store(pid, week, token, sess, res)
    live.publish(pid, "stage", {"name": "assimilate", "say": "updating the twin"})
    out = demo.assimilate(pid, week, pipeline.observables(res["values"]), res["channel"])

    name = str(row["name"])
    note = summary.patient_text(name, week, res)
    from ..comms import notify

    notify.send(pid, "post_call", body=note)

    # One event that says the whole thing landed. The workspace refetches the twin, the
    # forecast and the alerts off this, which is what animates the brain and pops the
    # flags without anybody reloading the page.
    update = call_update(pid, cid, week, res, out)
    db.put("events", {"id": db.new_id("ev"), "patient_id": pid, "kind": "call_update",
                      "payload": db.enc(update), "time": db.now()})
    # Appended to the patient's history, never replacing it. The baseline and every
    # earlier timepoint are left exactly where they are.
    from ..twin import build as buildmod

    buildmod.add_timepoint(pid, {
        "id": db.new_id("tp"),
        "call_id": cid,
        "at": update["date"],
        "week": int(week),
        "changed_regions": update["changed_regions"],
        "changed_count": update["changed_count"],
        "flags_added": update["flags_added"],
        "summary": update["summary"],
        "k": update["k"],
        "p": update["p"],
        "drift_z": update["drift_z"],
    })
    live.publish(pid, "call_done", update)

    return {"call_id": cid, "alerts": [a["type"] for a in out["alerts"]],
            "patient_note": note, "channel": res["channel"], "drift_z": out["diag"]["drift_z"]}


def call_update(pid: str, cid: str, week: int, res: dict, out: dict) -> dict:
    """What changed in the brain because of this call, in one payload.

    Served again by GET /api/patients/{pid}/latest-update, so a page that was not open
    when the call landed sees the same thing as one that was.
    """
    from ..agent import safety

    moved = out.get("changed_regions") or []
    post = out.get("post") or {}
    return {
        "call_id": cid,
        "week": int(week),
        "date": db.now(),
        "changed_regions": moved[:12],
        "changed_count": len(moved),
        "k": round(float(post["k"]), 4) if post.get("k") is not None else None,
        "p": round(float(post["p"]), 4) if post.get("p") is not None else None,
        "drift_z": round(float(out["diag"]["drift_z"]), 3),
        # `alerts` is what the call modal has always read. `flags_added` is the name the
        # banner uses. Same list, both kept, because renaming it would have broken the
        # modal silently: the field would simply have been missing at runtime.
        "alerts": [a["type"] for a in out.get("alerts") or []],
        "flags_added": [a["type"] for a in out.get("alerts") or []],
        "quality_ok": bool(res["quality"]["ok"]),
        "summary": safety.clean(update_line(moved, out)),
    }


def update_line(moved: list[dict], out: dict) -> str:
    """One plain sentence naming the biggest change.

    Says plainly when the change is small rather than dressing it up, because a banner
    that always sounds like something happened is a banner nobody reads.
    """
    drift = float(out["diag"].get("drift_z") or 0.0)
    if not moved:
        return ("Nothing in the brain model moved measurably this week. "
                f"Drift is {drift:+.1f}.")
    top = moved[0]
    size = abs(top["after"] - top["before"])
    way = "higher" if top["after"] > top["before"] else "lower"
    where = f"{top['name']}"
    if top.get("network"):
        where += f" in the {top['network']} network"
    if size < 0.02:
        return (f"Small change: {len(moved)} regions moved a little, most of all {where}. "
                f"Drift is {drift:+.1f}.")
    return (f"{len(moved)} regions moved, most of all {where}, "
            f"{size:.2f} {way}. Drift is {drift:+.1f}.")


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
    tiger.mirror(cid)      # best effort, never raises: a dashboard database cannot fail a call
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
