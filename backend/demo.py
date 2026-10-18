"""Demo controls: reset the cohort, advance a week, inject drift, trigger a call."""

import numpy as np

from . import alerts, db
from .data import synthetic as syn
from .features import pipeline, sem as semmod, synth
from .twin import build, enkf, forecast as fcast

# Six demo patients, each one a state the dashboard needs to be able to show.
PROFILES = [
    {"key": "fresh", "seed": 101, "week": 0, "label": "week 0, twin just built"},
    {"key": "stable", "seed": 102, "week": 4, "label": "week 4, tracking the forecast"},
    {"key": "drifting", "seed": 103, "week": 6, "label": "week 6, drifting worse"},
    {"key": "red_flag", "seed": 104, "week": 3, "label": "week 3, red flag on the safety screen"},
    {"key": "low_quality", "seed": 105, "week": 2, "label": "week 2, poor video channel"},
    {"key": "template", "seed": 106, "week": 5, "label": "week 5, no MRI, template twin"},
]


def new_patient(name: str, age: int, sex: str, seed: int | None = None, template_only: bool = False) -> str:
    """Create a patient row from a synthetic bundle and build its twin."""
    if seed is None:
        seed = int(abs(hash(name)) % 9000 + 1000)
    pat = syn.make_patient(int(seed))
    pid = db.new_id("pat")
    db.put("patients", {
        "id": pid, "name": name, "age": int(age), "sex": sex, "week": 0,
        "injury": db.enc(pat["injury"]), "alleles": db.enc(pat["alleles"]),
        "biomarkers": db.enc(pat["biomarkers"]), "synthetic": 1,
        "template_only": int(template_only), "created": db.now(), "seed": int(seed),
        "coverage": 0.0, "drift_z": 0.0, "fc_fit": None, "last_call": None,
    })
    token = db.new_id("con")
    db.put("consents", {"token": token, "patient_id": pid, "calls": 1, "ai": 1,
                        "recording": 1, "genetic": 1, "time": db.now(), "withdrawn": 0})
    build.build_twin(pid, template_only=template_only)
    return pid


def truth_of(pid: str) -> dict:
    """Weekly truth table for a patient, keyed by int week."""
    raw = db.dec(db.patient(pid)["truth"], {}) or {}
    return {int(k): v for k, v in raw.items()}


def set_truth(pid: str, truth: dict) -> None:
    """Store a modified weekly truth table."""
    db.patch("patients", pid, {"truth": db.enc({str(k): v for k, v in truth.items()})})


def transcript_of(name: str, week: int, values: dict) -> list[dict]:
    """A short plausible transcript for a mock call. Phase 4 replaces this with the agent."""
    first = name.split()[0]
    sym = int(round(float(values.get("symptom_total", 0)) / 8))
    return [
        {"who": "agent", "text": f"Hi {first}, this is your week {week} check-in. Before we start, is anything new or worse since last time?", "t": 2.0},
        {"who": "patient", "text": "About the same. Headaches maybe a bit less this week.", "t": 9.0},
        {"who": "agent", "text": "Good to hear. On a scale of 0 to 10, how is your headache right now?", "t": 15.0},
        {"who": "patient", "text": f"Around {min(10, max(0, sym))}.", "t": 20.0},
        {"who": "agent", "text": "Thank you. Now follow the dot with your eyes, keep your head still.", "t": 26.0},
        {"who": "patient", "text": "Okay.", "t": 31.0},
        {"who": "agent", "text": "That is everything. I will text you a short summary and we will speak next week.", "t": 800.0},
    ]


def add_checkin(pid: str, week: int, got: dict, sess: dict, unusable: bool = False,
                when: str | None = None) -> str:
    """Store a check-in record from what the pipeline measured.

    `when` dates it, and the seeder passes one so a built history lands on the calendar
    where it is supposed to have happened. It cannot be worked out from the patient row
    here: during seeding the row's week is still the previous one, so every check-in would
    date itself to today and the timeline would be a single dot.
    """
    row = db.patient(pid)
    cid = db.new_id("chk")
    stamp = when or db.now()
    db.put("checkins", {
        "id": cid, "patient_id": pid, "week": int(week), "date": stamp,
        "duration_s": float(sess.get("seconds", 840.0)), "steps": db.enc(got["steps"]),
        "channel": db.enc(got["channel"]), "features": db.enc(got["features"]),
        "gaze": db.enc(got["gaze"]), "traces": db.enc(got["traces"]),
        "transcript": db.enc(transcript_of(str(row["name"]), week, got["values"])),
        "unusable": int(unusable),
    })
    for key, val in pipeline.observables(got["values"]).items():
        db.add_observation(pid, week, key, float(val), semmod.sem(key))
    db.patch("patients", pid, {"last_call": stamp, "week": int(week)})
    return cid


def assimilate(pid: str, week: int, values: dict, channel: dict) -> dict:
    """Run the EnKF update for one week, store the state, alerts and new forecast."""
    state = build.state_of(pid)
    out = enkf.step(state, int(week), values, flash_ok=bool(channel.get("flash_ok", True)), seed=int(db.patient(pid)["seed"] or 0))
    post = enkf.params(state)
    row = db.patient(pid)
    params = db.dec(row["params"], {}) or {}
    params.update({"k": post["k"], "p": post["p"]})
    db.patch("patients", pid, {
        "state": db.enc(build.save_state(state)),
        "params": db.enc(params),
        "contraction": db.enc(state["contraction"]),
        "coverage": enkf.mean_coverage(state),
        "drift_z": state["drift_z"],
        "week": int(week),
    })
    db.put("parameters", {"id": db.new_id("par"), "patient_id": pid, "week": int(week),
                          "payload": db.enc({"params": params, "post": post, "diag": out}), "time": db.now()})
    build.rebuild_forecast(pid)
    fired = alerts.check(pid, int(week), channel, state)
    return {"diag": out, "post": post, "alerts": fired}


def run_week(pid: str, week: int, poor: bool = False, upto: int | None = None) -> dict:
    """One mock call at a given week, measured through the real feature pipeline.

    The session is built to carry this week's true values, then the pipeline has to
    measure them back out of frames, a stimulus log and spoken answers. What the filter
    assimilates is what the pipeline measured, not the truth it was built from.

    `upto` is the last week being built, which is what makes a seeded history land on
    real dates: week w of a patient who ends on week `upto` happened `upto - w` weeks ago.
    """
    row = db.patient(pid)
    truth = truth_of(pid)
    values = dict(truth.get(week, {}))
    sess = synth.session(values, seed=int(row["seed"] or 0) * 100 + week, poor=poor)
    hist = db.observations(pid)
    prev = next((h["values"] for h in reversed(hist) if int(h["week"]) < week), None)
    base = next((h["values"] for h in hist if int(h["week"]) == 0), None)
    got = pipeline.run(sess, prev=prev, age=int(row["age"] or 30), sex=str(row["sex"]), baseline=base)
    when = db.weeks_ago(max(0, int(upto) - int(week))) if upto is not None else None
    add_checkin(pid, week, got, sess, when=when)
    return assimilate(pid, week, pipeline.observables(got["values"]), got["channel"])


def advance_week(pid: str) -> dict:
    """Move a patient one week on: next truth, mock call, EnKF update, store."""
    row = db.patient(pid)
    week = int(row["week"] or 0) + 1
    truth = truth_of(pid)
    if week not in truth:
        truth[week] = extend_truth(pid, truth, week)
        set_truth(pid, truth)
    poor = bool(profile_of(pid) == "low_quality")
    got = run_week(pid, week, poor)
    return {"week": week, **got}


def extend_truth(pid: str, truth: dict, week: int) -> dict:
    """Generate one more week of truth past week 12 from the true parameters."""
    row = db.patient(pid)
    pat = syn.make_patient(int(row["seed"]))
    par = pat["params_true"]
    arr = fcast.truth(pat["d0_true"], par["k"], par["p"], upto=week, seed=int(row["seed"]) + week)
    return {o["key"]: float(arr[week, i]) for i, o in enumerate(fcast.OBS)}


def inject_drift(pid: str, size: float = 1.0) -> dict:
    """Push the next week's truth outside the band by size SEM-scaled worsening.

    y_s(next) = y_s(next) + size * 3 * SEM_s * sign(load_s)
    Three SEM is roughly the edge of the 80% band, so size 1 leaves it just outside.
    """
    row = db.patient(pid)
    week = int(row["week"] or 0) + 1
    truth = truth_of(pid)
    if week not in truth:
        truth[week] = extend_truth(pid, truth, week)
    bumped = dict(truth[week])
    for o in fcast.OBS:
        key = o["key"]
        if key in bumped:
            step = 3.0 * semmod.sem(key) * float(size) * (1.0 if o["load"] > 0 else -1.0)
            bumped[key] = float(bumped[key] + step)
    truth[week] = bumped
    set_truth(pid, truth)
    db.event(pid, "drift_injected", {"week": week, "size": size})
    return {"week": week, "values": bumped}


def profile_of(pid: str) -> str:
    """Which demo profile a patient was created from, or an empty string."""
    for ev in db.rows("select * from events where patient_id=? and kind='demo_profile'", (pid,)):
        return str((db.dec(ev["payload"], {}) or {}).get("key", ""))
    return ""


def reset(quiet: bool = False) -> dict:
    """Wipe everything and rebuild the six demo patients at their profile weeks."""
    db.wipe()
    made = []
    for prof in PROFILES:
        pat = syn.make_patient(prof["seed"])
        pid = new_patient(pat["name"], pat["age"], pat["sex"], seed=prof["seed"],
                          template_only=(prof["key"] == "template"))
        db.event(pid, "demo_profile", {"key": prof["key"], "label": prof["label"]})

        if prof["key"] == "drifting":
            truth = truth_of(pid)
            # Three worsening weeks, because the drift rule needs drift z above 2 for two
            # consecutive weeks and each drift z averages the current and previous week.
            for wk in range(max(1, prof["week"] - 2), prof["week"] + 1):
                row = dict(truth.get(wk, {}))
                for o in fcast.OBS:
                    if o["key"] in row:
                        row[o["key"]] = float(row[o["key"]] + 3.2 * semmod.sem(o["key"]) * (1.0 if o["load"] > 0 else -1.0))
                truth[wk] = row
            set_truth(pid, truth)

        poor = prof["key"] == "low_quality"
        for wk in range(0, prof["week"] + 1):
            run_week(pid, wk, poor, upto=prof["week"])

        if prof["key"] == "red_flag":
            alerts.red_flag(pid, {"worsening_headache": True, "repeated_vomiting": False,
                                  "new_weakness_or_numbness": True}, notify=True)
        made.append({"id": pid, "key": prof["key"], "name": pat["name"], "week": prof["week"]})
        if not quiet:
            print(f"  {prof['key']:12s} {pat['name']:16s} week {prof['week']}  {pid}")
    db.event("", "demo_reset", {"patients": made})
    return {"patients": made}
