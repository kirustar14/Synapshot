"""Demo controls: reset the cohort, advance a week, inject drift, trigger a call."""

import numpy as np

from . import alerts, db
from .data import synthetic as syn
from .features import sem as semmod
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


def channel_of(week: int, poor: bool = False) -> dict:
    """Call channel quality. The low quality demo patient gets a bad one every week."""
    rng = np.random.default_rng(1000 + week)
    if poor:
        return {"fps": 14.0 + float(rng.normal(0, 1)), "calib_err_deg": 3.8 + float(abs(rng.normal(0, 0.4))),
                "face_share": 0.55 + float(rng.normal(0, 0.03)), "flash_ok": False}
    return {"fps": 29.0 + float(rng.normal(0, 0.6)), "calib_err_deg": 1.1 + float(abs(rng.normal(0, 0.3))),
            "face_share": 0.93 + float(abs(rng.normal(0, 0.02))), "flash_ok": True}


def features_of(values: dict, prev: dict | None) -> list[dict]:
    """Feature list in the contract shape from this week's observable values."""
    out = []
    for o in fcast.OBS:
        key = o["key"]
        if key not in values:
            continue
        was = None if prev is None else prev.get(key)
        out.append({
            "name": key, "tier": o["tier"], "value": float(values[key]),
            "prev": None if was is None else float(was),
            "mdc": semmod.mdc(key), "unit": o["unit"],
            "changed": semmod.changed(key, float(values[key]), was),
        })
    return out


def gaze_of(week: int, gain: float) -> list[dict]:
    """Synthetic gaze traces for the two pursuit tasks, at the patient's own gain.

    target x(t) = 0.35 sin(2 pi f t) + 0.5 , gaze = gain * target + noise
    """
    rng = np.random.default_rng(500 + week)
    t = np.arange(0.0, 20.0, 1.0 / 30.0)
    out = []
    for task, freq in (("pursuit_h", 0.4), ("pursuit_v", 0.3)):
        tx = 0.35 * np.sin(2 * np.pi * freq * t) + 0.5
        ty = np.full_like(t, 0.5)
        if task == "pursuit_v":
            tx, ty = ty, tx
        gx = 0.5 + gain * (tx - 0.5) + rng.normal(0, 0.012, t.size)
        gy = 0.5 + gain * (ty - 0.5) + rng.normal(0, 0.012, t.size)
        out.append({
            "task": task,
            "t": [round(float(v), 4) for v in t],
            "x": [round(float(v), 4) for v in gx], "y": [round(float(v), 4) for v in gy],
            "tx": [round(float(v), 4) for v in tx], "ty": [round(float(v), 4) for v in ty],
        })
    return out


def transcript_of(name: str, week: int, values: dict) -> list[dict]:
    """A short plausible transcript for a mock call."""
    first = name.split()[0]
    sym = int(round(values.get("symptom_total", 0) / 8))
    return [
        {"who": "agent", "text": f"Hi {first}, this is your week {week} check-in. Before we start, is anything new or worse since last time?", "t": 2.0},
        {"who": "patient", "text": "About the same. Headaches maybe a bit less this week.", "t": 9.0},
        {"who": "agent", "text": "Good to hear. On a scale of 0 to 10, how is your headache right now?", "t": 15.0},
        {"who": "patient", "text": f"Around {min(10, max(0, sym))}.", "t": 20.0},
        {"who": "agent", "text": "Thank you. Now follow the dot with your eyes, keep your head still.", "t": 26.0},
        {"who": "patient", "text": "Okay.", "t": 31.0},
        {"who": "agent", "text": "That is everything. I will text you a short summary and we will speak next week.", "t": 800.0},
    ]


def add_checkin(pid: str, week: int, values: dict, channel: dict, unusable: bool = False) -> str:
    """Build and store a check-in record for one week from the observable values."""
    row = db.patient(pid)
    prev_rows = db.observations(pid)
    prev = None
    for item in prev_rows:
        if int(item["week"]) < week:
            prev = item["values"]
    cid = db.new_id("chk")
    steps = ["consent", "safety", "symptoms", "memory_encode", "eye_a", "eye_b",
             "numbers", "speech", "picture", "fluency", "recall", "wrap"]
    gain = float(values.get("pursuit_gain", 0.8))
    db.put("checkins", {
        "id": cid, "patient_id": pid, "week": int(week), "date": db.now(),
        "duration_s": 14 * 60.0, "steps": db.enc(steps), "channel": db.enc(channel),
        "features": db.enc(features_of(values, prev)), "gaze": db.enc(gaze_of(week, gain)),
        "traces": db.enc(traces_of(week)), "transcript": db.enc(transcript_of(str(row["name"]), week, values)),
        "unusable": int(unusable),
    })
    for o in fcast.OBS:
        if o["key"] in values:
            db.add_observation(pid, week, o["key"], float(values[o["key"]]), semmod.sem(o["key"]))
    db.patch("patients", pid, {"last_call": db.now(), "week": int(week)})
    return cid


def traces_of(week: int) -> dict:
    """Exploratory blink, smile and brow traces for the picture description task."""
    rng = np.random.default_rng(900 + week)
    t = np.arange(0.0, 30.0, 0.1)
    blink = (np.sin(2 * np.pi * 0.25 * t) > 0.985).astype(float)
    smile = np.clip(0.18 + 0.12 * np.sin(2 * np.pi * 0.05 * t) + rng.normal(0, 0.02, t.size), 0, 1)
    brow = np.clip(0.10 + 0.08 * np.sin(2 * np.pi * 0.03 * t + 1.0) + rng.normal(0, 0.02, t.size), 0, 1)
    return {"blink": pack_trace(t, blink), "smile": pack_trace(t, smile), "brow": pack_trace(t, brow)}


def pack_trace(t: np.ndarray, v: np.ndarray) -> dict:
    """One trace rounded down to a size the frontend can hold."""
    return {"t": [round(float(x), 2) for x in t], "v": [round(float(x), 4) for x in v]}


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


def run_week(pid: str, week: int, poor: bool = False) -> dict:
    """One mock call at a given week: checkin, assimilation, alerts."""
    truth = truth_of(pid)
    values = dict(truth.get(week, {}))
    channel = channel_of(week, poor)
    add_checkin(pid, week, values, channel)
    return assimilate(pid, week, values, channel)


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


def trigger_call(pid: str) -> dict:
    """Run a call now. The real rig when it is available, otherwise the mock session."""
    from .rig_hub import run_call

    return run_call(pid)


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
            run_week(pid, wk, poor)

        if prof["key"] == "red_flag":
            alerts.red_flag(pid, {"worsening_headache": True, "repeated_vomiting": False,
                                  "new_weakness_or_numbness": True}, notify=True)
        made.append({"id": pid, "key": prof["key"], "name": pat["name"], "week": prof["week"]})
        if not quiet:
            print(f"  {prof['key']:12s} {pat['name']:16s} week {prof['week']}  {pid}")
    db.event("", "demo_reset", {"patients": made})
    return {"patients": made}
