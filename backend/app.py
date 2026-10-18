"""The FastAPI app. Every route in the contract, with the contract's exact field names."""

import asyncio
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import alerts as alertmod
from . import db, demo, models, rig_hub
from .agent import safety, summary
from .agent import summary as agent_summary
from .calls import audio as callaudio
from .calls import run as callrun
from .calls import script as callscript
from .calls import sessions
from .comms import photon
from .config import ROOT, cfg
from .data import upload
from .features import sem as semmod
from .features import webframes
from .twin import attribution, build, counterfactual, forecast as fcast, population


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Open the database and hand the event loop to the rig bridge."""
    db.conn()
    rig_hub.set_loop(asyncio.get_running_loop())
    yield


app = FastAPI(title="UNNAMED", version="0.1.0", lifespan=lifespan)

# The frontend is served from this same origin, so in live mode nothing needs a cross
# origin grant and the only allowed origin is the public URL itself. Mock mode stays open
# so a separate `npm run dev` on another port can talk to it.
ORIGINS = [cfg.public_url] if (cfg.mode() == "live" and cfg.public_url) else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

STIM_DIR = ROOT / "stimulus"
if STIM_DIR.exists():
    app.mount("/stimulus", StaticFiles(directory=str(STIM_DIR), html=True), name="stimulus")

# A dummy test harness, not the product. The clinician frontend is built separately
# against the contract; this exists so the backend can be seen without curl.
UI_DIR = ROOT / "frontend"
if UI_DIR.exists():
    app.mount("/ui", StaticFiles(directory=str(UI_DIR), html=True), name="ui")


def reach_only(name: str) -> None:
    """Reach features are on by default. With REACH=0 they are not served at all."""
    if not cfg.reach:
        raise HTTPException(404, f"{name} is a reach feature and REACH is off")


def need(pid: str):
    """A patient row or a 404."""
    row = db.patient(pid)
    if row is None:
        raise HTTPException(404, f"no patient {pid}")
    return row


# ---------------------------------------------------------------- assembly helpers

def checkin_obj(row, with_gaze: bool = True) -> dict:
    """One Checkin in the contract shape."""
    out = {
        "id": row["id"],
        "patient_id": row["patient_id"],
        "week": int(row["week"]),
        "date": row["date"],
        "duration_s": float(row["duration_s"] or 0),
        "steps": db.dec(row["steps"], []) or [],
        "channel": db.dec(row["channel"], {}) or {"fps": 0, "calib_err_deg": 0, "face_share": 0, "flash_ok": False},
        "features": db.dec(row["features"], []) or [],
        "gaze": (db.dec(row["gaze"], []) or []) if with_gaze else [],
        "traces": db.dec(row["traces"], None),
        "transcript": db.dec(row["transcript"], []) or [],
        "unusable": bool(row["unusable"]),
    }
    return out


def alert_obj(row) -> dict:
    """One Alert in the contract shape."""
    return {
        "id": row["id"], "patient_id": row["patient_id"], "type": row["type"],
        "trigger": row["trigger"], "time": row["time"],
        "called": bool(row["called"]), "acked": bool(row["acked"]),
    }


def inputs_of(pid: str) -> dict:
    """The stored twin input bundle, building the twin first if there is none."""
    row = db.twin_inputs(pid)
    if row is None:
        build.build_twin(pid)
        row = db.twin_inputs(pid)
    return db.dec(row["payload"], {}) or {}


def patient_row(row) -> dict:
    """One PatientRow in the contract shape."""
    return {
        "id": row["id"],
        "name": row["name"],
        "week": int(row["week"] or 0),
        "drift_z": round(float(row["drift_z"] or 0.0), 3),
        "last_call": row["last_call"],
        "flags": alertmod.flags(row["id"]),
        "synthetic": bool(row["synthetic"]),
    }


def patient_obj(pid: str) -> dict:
    """One Patient in the contract shape."""
    row = need(pid)
    bundle = inputs_of(pid)
    chk = db.checkins(pid)
    params = db.dec(row["params"], {}) or {}
    return {
        "id": row["id"],
        "name": row["name"],
        "age": int(row["age"] or 0),
        "sex": row["sex"],
        "week": int(row["week"] or 0),
        "injury": db.dec(row["injury"], {}) or {},
        "inputs": bundle.get("inputs", []),
        "alleles": db.dec(row["alleles"], {}) or {},
        "biomarkers": db.dec(row["biomarkers"], {}) or {},
        "fc_fit": None if row["fc_fit"] is None else float(row["fc_fit"]),
        "coverage": round(float(row["coverage"] or 0.0), 3),
        "contraction": db.dec(row["contraction"], {"k": 0.0}) or {"k": 0.0},
        "params": {
            "G": float(params.get("G", 0.0)), "k": float(params.get("k", 0.0)),
            "p": float(params.get("p", 0.0)), "eps": float(params.get("eps", 0.0)),
        },
        "alerts": [alert_obj(a) for a in db.alerts(pid)],
        "last_call": checkin_obj(chk[-1]) if chk else None,
        "twin_built": bool(row["twin_built"]),
        "template_only": bool(row["template_only"]),
        "low_fidelity": bool(row["low_fidelity"]),
    }


def forecast_obj(pid: str) -> dict:
    """The stored forecast, rebuilt when there is none."""
    row = db.latest_forecast(pid)
    if row is None:
        return build.rebuild_forecast(pid)
    got = db.dec(row["payload"], None)
    return got or build.rebuild_forecast(pid)


# ---------------------------------------------------------------- health and patients

@app.get("/api/health", response_model=models.Health)
def health() -> dict:
    """Is the backend up, and in which mode."""
    return {"ok": True, "mode": cfg.mode()}


@app.get("/api/patients", response_model=list[models.PatientRow])
def list_patients() -> list[dict]:
    """Every patient, for the clinician list."""
    return [patient_row(r) for r in db.patients()]


@app.post("/api/patients", response_model=models.Patient)
def create_patient(body: models.NewPatient) -> dict:
    """Create a patient and build its twin."""
    pid = demo.new_patient(body.name, body.age, body.sex)
    return patient_obj(pid)


@app.get("/api/patients/{pid}", response_model=models.Patient)
def get_patient(pid: str) -> dict:
    """One patient, everything the detail view needs."""
    return patient_obj(pid)


@app.get("/api/patients/{pid}/forecast", response_model=models.Forecast)
def get_forecast(pid: str) -> dict:
    """Twelve week forecast with 80% bands and the coverage history."""
    need(pid)
    return forecast_obj(pid)


@app.get("/api/patients/{pid}/twin", response_model=models.Twin)
def get_twin(pid: str) -> dict:
    """Regions, edges and top tracts over the forecast weeks."""
    need(pid)
    bundle = inputs_of(pid)
    twin = bundle.get("twin")
    if not twin:
        twin = build.build_twin(pid)["twin"]
    return twin


@app.get("/api/mesh", response_model=models.Mesh)
def get_mesh() -> dict:
    """The cortical surface with a Schaefer-100 label on every vertex."""
    from .data import mesh as meshmod

    return meshmod.mesh()


@app.get("/api/patients/{pid}/shape", response_model=models.Shape)
def get_shape(pid: str) -> dict:
    """How this patient's brain differs in shape from the template. Illustrative."""
    need(pid)
    from .twin import shape as shapemod

    return shapemod.shape_of(pid)


@app.get("/api/receptors", response_model=models.Receptors)
def get_receptors() -> dict:
    """Group average receptor maps for the what-if overlay."""
    from .twin import intervention as interv

    return interv.receptors()


@app.post("/api/patients/{pid}/intervention", response_model=models.Intervention)
def post_intervention(pid: str, body: models.InterventionBody) -> dict:
    """A clinician only receptor weighted gain what-if. Never reaches a patient."""
    need(pid)
    from .twin import intervention as interv

    try:
        return interv.run(pid, body.target, body.gain)
    except KeyError:
        raise HTTPException(400, f"unknown receptor target {body.target}") from None


@app.get("/api/loadings", response_model=models.Loadings)
def get_loadings() -> dict:
    """Which regions drive which signal. A design assumption, behind REGIONAL_LOADINGS."""
    from .twin import loadings as loadmod

    if not loadmod.enabled():
        raise HTTPException(404, "regional loadings are off, set REGIONAL_LOADINGS=1")
    return loadmod.payload()


@app.post("/api/patients/{pid}/scenarios", response_model=models.ScenarioResult)
def post_scenarios(pid: str, body: models.ScenarioBody) -> dict:
    """Two what-if impacts side by side."""
    reach_only("scenario compare")
    need(pid)
    a = counterfactual.scenario(pid, body.a.helmet, body.a.angle_deg)
    b = counterfactual.scenario(pid, body.b.helmet, body.b.angle_deg)
    diff = [
        {"param": "helmet", "a": str(body.a.helmet), "b": str(body.b.helmet)},
        {"param": "angle_deg", "a": f"{body.a.angle_deg:.0f}", "b": f"{body.b.angle_deg:.0f}"},
        {"param": "mean damage at week 0", "a": f"{a['d0']:.3f}", "b": f"{b['d0']:.3f}"},
    ]
    for key in ("pursuit_gain", "symptom_total"):
        sa = next((s for s in a["forecast"]["signals"] if s["key"] == key), None)
        sb = next((s for s in b["forecast"]["signals"] if s["key"] == key), None)
        if sa and sb:
            diff.append({"param": f"{key} at week 0", "a": f"{sa['mean'][0]:.2f}", "b": f"{sb['mean'][0]:.2f}"})
    return {"a": a["forecast"], "b": b["forecast"], "diff": diff}


@app.post("/api/patients/{pid}/counterfactual", response_model=models.Forecast)
def post_counterfactual(pid: str, body: models.CounterfactualBody) -> dict:
    """Forecast with the recovery rate scaled and the residual shifted."""
    reach_only("the counterfactual slider")
    need(pid)
    return counterfactual.forecast(pid, body.k_mult, body.p_add)


@app.get("/api/patients/{pid}/attribution", response_model=list[models.Attribution])
def get_attribution(pid: str) -> list[dict]:
    """Top tracts per signal. Always labelled a hypothesis."""
    reach_only("tract attribution")
    need(pid)
    return attribution.attribution(pid)


@app.get("/api/patients/{pid}/checkins", response_model=list[models.Checkin])
def get_checkins(pid: str) -> list[dict]:
    """Every check-in for a patient, without the gaze arrays."""
    need(pid)
    return [checkin_obj(r, with_gaze=False) for r in db.checkins(pid)]


@app.get("/api/checkins/{cid}", response_model=models.Checkin)
def get_checkin(cid: str) -> dict:
    """One check-in, with the gaze arrays."""
    row = db.checkin(cid)
    if row is None:
        raise HTTPException(404, f"no checkin {cid}")
    return checkin_obj(row, with_gaze=True)


@app.post("/api/checkins/{cid}/rescore")
def rescore(cid: str, body: models.RescoreBody) -> dict:
    """Re-run the feature functions for one task of a stored check-in."""
    row = db.checkin(cid)
    if row is None:
        raise HTTPException(404, f"no checkin {cid}")
    from .features import fixation, pipeline, pursuit

    gaze = db.dec(row["gaze"], []) or []
    trace = next((g for g in gaze if g["task"] == body.task), None)
    if trace is None:
        raise HTTPException(400, f"no gaze trace for task {body.task} on this check-in")

    # The quality gate blocked the eye tasks on this call, so rescoring one would put a
    # number back that was deliberately not reported.
    bad, why = alertmod.quality_rule(db.dec(row["channel"], {}) or {})
    if bad:
        raise HTTPException(400, f"the quality gate blocked the eye tasks on this check-in: {why}")

    feats = db.dec(row["features"], []) or []
    got: dict = {}
    if body.task.startswith("pursuit"):
        axis = "x" if body.task.endswith("_h") else "y"
        tgt = "tx" if axis == "x" else "ty"
        res = pursuit.measure(trace["t"], trace[axis], trace["t"], trace[tgt])
        got = {"pursuit_gain" if axis == "x" else "pursuit_gain_v": res["gain"]}
        if axis == "x":
            got["pursuit_rms"] = res["rms"] * 100.0
    elif body.task == "fixation":
        res = fixation.measure(trace)
        got = {"bcea": res["bcea"], "intrusions": float(res["intrusions"])}
    else:
        raise HTTPException(400, f"task {body.task} cannot be rescored from stored gaze")

    for f in feats:
        if f["name"] in got:
            f["value"] = float(got[f["name"]])
            f["changed"] = semmod.changed(f["name"], f["value"], f.get("prev"))
    db.patch("checkins", cid, {"features": db.enc(feats)})
    for key, val in got.items():
        if key in [o["key"] for o in fcast.OBS]:
            db.add_observation(row["patient_id"], int(row["week"]), key, float(val), semmod.sem(key))
    db.event(row["patient_id"], "rescored", {"checkin": cid, "task": body.task, "values": got})
    build.rebuild_forecast(row["patient_id"])
    return {"ok": True, "checkin_id": cid, "task": body.task, "values": got,
            "features": [f for f in feats if f["name"] in got]}


@app.post("/api/checkins/{cid}/unusable")
def mark_unusable(cid: str) -> dict:
    """Mark a check-in unusable and drop its observations from the twin."""
    row = db.checkin(cid)
    if row is None:
        raise HTTPException(404, f"no checkin {cid}")
    db.patch("checkins", cid, {"unusable": 1})
    db.run("delete from observations where patient_id=? and week=?", (row["patient_id"], int(row["week"])))
    db.event(row["patient_id"], "checkin_unusable", {"checkin": cid, "week": int(row["week"])})
    build.rebuild_forecast(row["patient_id"])
    return {"ok": True, "checkin_id": cid, "unusable": True}


@app.post("/api/patients/{pid}/uploads", response_model=list[models.InputFile])
async def post_uploads(pid: str, kind: str | None = Form(default=None), file: UploadFile | None = File(default=None)) -> list[dict]:
    """A real multipart upload, or the synthetic shortcut when no file is sent."""
    need(pid)
    if file is not None and kind:
        data = await file.read()
        row = upload.save(pid, kind, file.filename or kind, data)
        db.put("uploads", {
            "id": db.new_id("up"), "patient_id": pid, "kind": row["kind"], "file": row["file"],
            "status": row["status"], "sets": row["sets"], "note": row["note"],
            "synthetic": 0, "time": db.now(),
        })
        db.patch("patients", pid, {"template_only": 0})
        return [r for r in current_inputs(pid)]

    # Synthetic shortcut: write the BIDS folder for this patient's seed and record it.
    from .data import synthetic as syn

    pat = syn.make_patient(int(db.patient(pid)["seed"] or 0))
    rows = upload.synthetic_set(syn.write_bids(pat))
    db.run("delete from uploads where patient_id=?", (pid,))
    for row in rows:
        db.put("uploads", {
            "id": db.new_id("up"), "patient_id": pid, "kind": row["kind"], "file": row["file"],
            "status": row["status"], "sets": row["sets"], "note": row["note"],
            "synthetic": 1, "time": db.now(),
        })
    db.patch("patients", pid, {"template_only": 0})
    return rows


def current_inputs(pid: str) -> list[dict]:
    """The InputFile list as stored, newest upload per modality."""
    out: dict[str, dict] = {}
    for r in db.uploads(pid):
        out[str(r["kind"])] = {
            "kind": r["kind"], "file": r["file"], "synthetic": bool(r["synthetic"]),
            "status": r["status"], "sets": r["sets"], "note": r["note"],
        }
    if not out:
        return inputs_of(pid).get("inputs", [])
    return [out[k] for k in upload.KINDS if k in out]


@app.get("/api/patients/{pid}/twin-inputs", response_model=models.TwinInputs)
def get_twin_inputs(pid: str) -> dict:
    """What the twin was built from, the FC fit and whether it is low fidelity."""
    row = need(pid)
    bundle = inputs_of(pid)
    return {
        "inputs": current_inputs(pid),
        "fc_fit": None if row["fc_fit"] is None else float(row["fc_fit"]),
        "low_fidelity": bool(row["low_fidelity"]) or bool(bundle.get("low_fidelity")),
    }


@app.post("/api/patients/{pid}/build-twin", response_model=models.Patient)
def post_build_twin(pid: str) -> dict:
    """Rebuild the twin from whatever inputs are there now."""
    need(pid)
    has_imaging = any(r["kind"] in ("dwi", "fmri") and r["status"] in ("ok", "warn") for r in db.uploads(pid))
    build.build_twin(pid, template_only=not has_imaging if db.uploads(pid) else None)
    return patient_obj(pid)


@app.get("/api/patients/{pid}/messages", response_model=list[models.Message])
def get_messages(pid: str) -> list[dict]:
    """The message thread for a patient, each row saying which transport carried it."""
    need(pid)
    out = []
    for m in db.messages(pid):
        try:
            chan = str(m["channel"] or "mock")
            kind = m["kind"]
        except (IndexError, KeyError):
            chan, kind = "mock", None
        out.append({"dir": m["dir"], "body": m["body"], "time": m["time"],
                    "channel": chan if chan in ("imessage", "sms", "mock") else "mock",
                    "kind": kind})
    return out


@app.post("/api/patients/{pid}/note")
def post_note(pid: str, body: models.NoteBody) -> dict:
    """Store a clinician note on a patient."""
    need(pid)
    db.patch("patients", pid, {"note": body.text})
    db.event(pid, "note", {"text": body.text})
    return {"ok": True, "patient_id": pid, "text": body.text}


# ---------------------------------------------------------------- alerts and cohort

@app.get("/api/alerts", response_model=list[models.Alert])
def get_alerts(patient_id: str | None = None) -> list[dict]:
    """Alerts, newest first, optionally for one patient."""
    return [alert_obj(a) for a in db.alerts(patient_id)]


@app.post("/api/alerts/{aid}/ack")
def ack_alert(aid: str) -> dict:
    """Acknowledge an alert."""
    if db.one("select id from alerts where id=?", (aid,)) is None:
        raise HTTPException(404, f"no alert {aid}")
    alertmod.ack(aid)
    return {"ok": True, "id": aid, "acked": True}


@app.post("/api/alerts/{aid}/call")
def call_alert(aid: str) -> dict:
    """Ring the clinic for an alert now."""
    got = alertmod.call_now(aid)
    if not got.get("ok") and got.get("error") == "no such alert":
        raise HTTPException(404, f"no alert {aid}")
    return {"ok": bool(got.get("ok")), "id": aid, "how": got.get("how"), "called": True}


@app.get("/api/cohort", response_model=models.Cohort)
def get_cohort() -> dict:
    """The population layer results. Seeds on demand when cohort.json is missing."""
    got = population.load()
    if got is None:
        from . import seed

        got = seed.build(quiet=True)["cohort"]
    return got


@app.get("/api/rig/preflight", response_model=list[models.Check])
def get_preflight() -> list[dict]:
    """The rig checks, same list the command line prints."""
    import sys

    sys.path.insert(0, str(ROOT))
    from rig import preflight

    return preflight.run()


# ---------------------------------------------------------------- demo controls

@app.post("/api/demo/reset")
def demo_reset() -> dict:
    """Reseed the six demo patients and the cohort."""
    got = demo.reset(quiet=True)
    return {"ok": True, **got}


@app.post("/api/demo/advance-week")
def demo_advance(body: models.DemoBody) -> dict:
    """Move a patient one week on: next truth, mock call, EnKF update."""
    pid = body.patient_id or ""
    need(pid)
    got = demo.advance_week(pid)
    return {
        "ok": True, "patient_id": pid, "week": got["week"],
        "drift_z": round(float(got["diag"]["drift_z"]), 3),
        "coverage": got["diag"]["cov"],
        "alerts": [a["type"] for a in got["alerts"]],
    }


@app.post("/api/demo/inject-drift")
def demo_drift(body: models.DemoBody) -> dict:
    """Push next week's truth outside the band."""
    reach_only("drift injection")
    pid = body.patient_id or ""
    need(pid)
    got = demo.inject_drift(pid, body.size)
    return {"ok": True, "patient_id": pid, "week": got["week"], "size": body.size}


@app.post("/api/demo/trigger-call")
def demo_call(body: models.DemoBody, tasks: BackgroundTasks) -> dict:
    """Start a call now.

    In web mode with a real transport, create a session and text the link, then wait for
    the patient to open it. In web mock mode, run a generated web session through the real
    ingest and the real pipeline, so the whole web path is exercised with no phone at all.
    In facetime mode, the old rig path runs unchanged.
    """
    pid = body.patient_id or ""
    need(pid)

    if not cfg.web_call():
        got = rig_hub.start_call(pid)
        del tasks
        return {"ok": bool(got.get("ok")), "patient_id": pid, "mode": "facetime",
                "started": got.get("started", False), "mock": cfg.mock_rig,
                "error": got.get("error")}

    start = sessions.create(pid)
    if photon.available() or cfg.mode() == "live":
        from .comms import notify as texter

        sent = texter.send(pid, "call_link", link=start["url"])
        return {"ok": True, "patient_id": pid, "mode": "web", "started": True,
                "token": start["token"], "url": start["url"],
                "channel": sent.get("channel", "mock"), "waiting": True}

    tasks.add_task(callrun.mock_call, start["token"])
    return {"ok": True, "patient_id": pid, "mode": "web", "started": True,
            "token": start["token"], "url": start["url"], "channel": "mock",
            "waiting": False, "note": "a generated web session is running through the real pipeline"}


# ---------------------------------------------------------------- consent and stretch

CONSENT_TEXT = [
    "This is a research check-in, not medical care. The assistant on the call is software, "
    "not a clinician.",
    "The assistant will never tell you what is wrong with you, and will never tell you when "
    "you can return to sport, work or driving. Those are your clinician's decisions.",
    "Each call takes about 14 minutes. It is recorded: video, audio and the measurements "
    "taken from them. Your clinician sees all of it.",
    "What is measured: eye movements, speech, memory and facial movement, plus the symptom "
    "scores you say out loud.",
    "If you upload a genetic file, only four specific markers are read and the file is "
    "deleted straight afterwards. Nothing else in it is looked at or kept.",
    "You can stop a call at any time by saying stop, and you can withdraw completely by "
    "replying STOP to any text. Withdrawing deletes nothing you have already given unless "
    "you ask, and you can ask.",
    "If anything you say suggests an emergency, the call stops and you will be told to get "
    "medical help immediately.",
]


@app.get("/api/consent/{token}", response_model=models.ConsentText)
def get_consent(token: str) -> dict:
    """What the consent page shows."""
    row = db.consent(token)
    if row is None:
        raise HTTPException(404, "unknown consent link")
    pat = db.patient(row["patient_id"])
    return {"patient_name": str(pat["name"]) if pat else "", "text": CONSENT_TEXT}


@app.post("/api/consent/{token}")
def post_consent(token: str, body: models.ConsentBody) -> dict:
    """Record the four consent answers."""
    row = db.consent(token)
    if row is None:
        raise HTTPException(404, "unknown consent link")
    db.patch("consents", token, {
        "calls": int(body.calls), "ai": int(body.ai), "recording": int(body.recording),
        "genetic": int(body.genetic), "time": db.now(),
        "withdrawn": 0 if body.calls else 1,
    }, key="token")
    db.event(row["patient_id"], "consent", body.model_dump())
    return {"ok": True, "token": token, **body.model_dump()}


@app.post("/api/stretch/{token}")
def post_stretch(token: str, body: models.StretchBody) -> dict:
    """Gait and hearing results from the texted web page. Both exploratory."""
    reach_only("the gait and hearing stretch")
    row = db.consent(token)
    if row is None:
        raise HTTPException(404, "unknown link")
    pid = str(row["patient_id"])
    got: dict = {}
    feats: list[dict] = []
    if body.gait:
        got["gait"] = body.gait.model_dump()
        feats += [
            feature_row("gait_cadence", body.gait.cadence, "steps/min"),
            feature_row("gait_variability", body.gait.variability, "%"),
            feature_row("gait_steps", float(body.gait.steps), "count"),
        ]
    if body.hearing:
        got["hearing"] = body.hearing.model_dump()
        vals = list(body.hearing.thresholds.values())
        if vals:
            feats.append(feature_row("hearing_mean_db", float(sum(vals) / len(vals)), "dB"))
    db.event(pid, "stretch", got)

    rows = db.checkins(pid)
    if rows and feats:
        latest = rows[-1]
        have = db.dec(latest["features"], []) or []
        names = {f["name"] for f in feats}
        have = [f for f in have if f["name"] not in names] + feats
        db.patch("checkins", latest["id"], {"features": db.enc(have)})
    return {"ok": True, "patient_id": pid, "stored": list(got), "features": feats}


def feature_row(name: str, value: float, unit: str) -> dict:
    """One exploratory Feature row in the contract shape."""
    return {
        "name": name, "tier": "B", "value": float(value), "prev": None,
        "mdc": semmod.mdc(name), "unit": unit, "changed": False,
    }


# ---------------------------------------------------------------- websockets

@app.websocket("/ws/rig")
async def ws_rig(ws: WebSocket) -> None:
    """Live rig stream: RigEvent JSON out, nothing expected in."""
    await ws.accept()
    rig_hub.RIG.append(ws)
    await ws.send_json({"type": "hello", "mode": cfg.mode(), "state": rig_hub.STATE})
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if ws in rig_hub.RIG:
            rig_hub.RIG.remove(ws)


@app.websocket("/ws/stimulus")
async def ws_stimulus(ws: WebSocket) -> None:
    """The stimulus page: commands out, shown and flashed timestamps back."""
    await ws.accept()
    rig_hub.STIM.append(ws)
    await ws.send_json({"type": "clock", "mono_ns": time.monotonic_ns(), "perf_ns": 0})
    try:
        while True:
            msg = await ws.receive_json()
            if isinstance(msg, dict):
                if msg.get("type") == "hello":
                    await ws.send_json({"type": "clock", "mono_ns": time.monotonic_ns(),
                                        "perf_ns": int(msg.get("perf_ns", 0))})
                rig_hub.stim_in(msg)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if ws in rig_hub.STIM:
            rig_hub.STIM.remove(ws)


# ---------------------------------------------------------------- pages

# The built frontend. One origin for the API, the voices and the page, so there is no
# CORS to get wrong and one HTTPS URL to put on a phone.
WEB_DIR = ROOT / "web" / "dist"
VOICE_DIR = cfg.data_dir / "voice"
VOICE_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/voice", StaticFiles(directory=str(VOICE_DIR)), name="voice")
if (WEB_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(WEB_DIR / "assets")), name="assets")


def index_or_json():
    """The built index.html, or a pointer list when the frontend has not been built."""
    page = WEB_DIR / "index.html"
    if page.exists():
        return FileResponse(str(page))
    return JSONResponse({
        "ok": True,
        "mode": cfg.mode(),
        "web": "not built yet, run make web",
        "api": "/api/health",
        "docs": "/docs",
        "ui": "/ui/",
        "stimulus": "/stimulus/",
        "websockets": ["/ws/rig", "/ws/stimulus"],
    })


@app.get("/", response_model=None)
def root():
    """The clinician app, or a pointer list before the frontend is built."""
    return index_or_json()


@app.get("/consent/{token}", response_model=None)
def consent_page(token: str):
    """The consent page the text links to."""
    if (WEB_DIR / "index.html").exists():
        return index_or_json()
    got = db.consent(token)
    if got is None:
        raise HTTPException(404, "unknown consent link")
    return JSONResponse(get_consent(token))


@app.get("/call/{token}", response_model=None)
def call_page(token: str):
    """The page the patient opens from the text. The app reads the token from the path."""
    if (WEB_DIR / "index.html").exists():
        return index_or_json()
    row = sessions.get(token)
    if row is None:
        raise HTTPException(404, "unknown link")
    return JSONResponse({"ok": True, "state": row["state"],
                         "web": "not built yet, run make web"})


@app.get("/api/photon/status")
def photon_status() -> dict:
    """Which iMessage transport is live, and what the installed SDK looks like."""
    from .comms import notify as texter

    return {"available": photon.available(), "mock": cfg.mock_photon, "sdk": photon.docs(),
            **texter.status()}


# ---------------------------------------------------------------- the web call

def call_row(token: str, want_consent: bool = True):
    """A usable session for this token, or the right error.

    404 for unknown, 410 for expired, 409 once the call has stopped or finished, and 403
    until the three required consents are in.
    """
    row = sessions.live(token)
    if row is None:
        if sessions.expired(token):
            raise HTTPException(410, "this link has expired, ask your clinic for a new one")
        raise HTTPException(404, "unknown link")
    if row["state"] in ("stopped", "done", "failed"):
        raise HTTPException(409, f"this check-in is already {row['state']}")
    if want_consent and not sessions.consent_ok(row):
        raise HTTPException(403, "consent has not been given yet")
    return row


def limit(token: str, request: Request, per: int = sessions.RATE_MAX) -> None:
    """Rate limit a session route by token and by client address."""
    who = request.client.host if request.client else "unknown"
    if not sessions.rate_ok(f"t:{token}", per) or not sessions.rate_ok(f"ip:{who}", per * 2):
        raise HTTPException(429, "too many requests, slow down")


@app.post("/api/calls", response_model=models.CallStart)
def post_calls(body: models.CallBody) -> dict:
    """Create a call session and, when asked, text the patient the link."""
    pid = body.patient_id or ""
    need(pid)
    got = sessions.create(pid, body.week)
    if body.send:
        from .comms import notify as texter

        sent = texter.send(pid, "call_link", link=got["url"])
        got = {**got, "sent": True, "channel": sent.get("channel", "mock")}
    return got


@app.get("/api/call/{token}/script", response_model=models.CallScript)
def get_call_script(token: str) -> dict:
    """The script the page runs. Marks the session opened."""
    row = call_row(token, want_consent=False)
    sessions.open_session(token)
    from .agent import voices

    short = bool(row["short"])
    return callscript.payload(short=short, audio=voices.audio_map())


@app.post("/api/call/{token}/consent")
def post_call_consent(token: str, body: models.ConsentBody) -> dict:
    """Store the four consent answers. No task runs until the first three are true."""
    row = call_row(token, want_consent=False)
    sessions.patch(token, {"consent": db.enc(body.model_dump())})
    db.patch("consents", str(db.consent_for(row["patient_id"])["token"]) if db.consent_for(row["patient_id"]) else "",
             {"calls": int(body.calls), "ai": int(body.ai), "recording": int(body.recording),
              "genetic": int(body.genetic), "time": db.now()}, key="token")
    db.event(row["patient_id"], "consent", {**body.model_dump(), "via": "web call"})
    return {"ok": True, "ready": sessions.consent_ok(sessions.get(token)), **body.model_dump()}


@app.post("/api/call/{token}/redflags", response_model=models.RedflagResult)
def post_call_redflags(token: str, body: models.RedflagBody) -> dict:
    """Run the safety screen. The backend decides, never the page.

    A clinician must confirm this question list before any use outside the team.
    """
    row = call_row(token)
    pid = str(row["patient_id"])
    answers = {k: bool(v) for k, v in (body.answers or {}).items()}
    got = safety.screen(answers)
    sessions.patch(token, {"redflags": db.enc(answers)})

    from .agent import voices

    audio = voices.audio_map()
    if got["stop"]:
        alertmod.red_flag(pid, answers, notify=True)
        pat = db.patient(pid)
        from .comms import clinic_call

        clinic_call.call(pid, agent_summary.clinician_text(str(pat["name"]), int(row["week"] or 0),
                                                           None, got["flags"]))
        sessions.set_state(token, "stopped", finished=db.now())
        db.event(pid, "call_red_flag", {"week": int(row["week"] or 0), "flags": got["flags"]})
        name = audio.get("emergency")
        return {"stop": True, "say": got["say"],
                "audio": f"/voice/{name}" if name else None}
    name = audio.get("clear")
    return {"stop": False, "say": got["say"], "audio": f"/voice/{name}" if name else None}


@app.post("/api/call/{token}/symptoms", response_model=models.SymptomResult)
def post_call_symptoms(token: str, body: models.SymptomBody) -> dict:
    """Store the symptom scores and say which blocks to skip."""
    row = call_row(token)
    scores = {k: float(v) for k, v in (body.scores or {}).items()}
    have = db.dec(row["symptoms"], {}) or {}
    merged = {**have.get("symptoms", {}), **scores}

    jump = 0.0
    if body.phase == "rerate" and have.get("symptoms"):
        jump = float(sum(merged.values()) - sum(have["symptoms"].values()))
    short = bool(safety.short_version(merged, jump))
    sessions.patch(token, {
        "symptoms": db.enc({**have, "symptoms": merged, "jump": jump}),
        "short": int(short or bool(row["short"])),
    })
    skip = callscript.SHORT_DROP if (short or bool(row["short"])) else []
    return {"jump": bool(jump >= 10.0), "short": bool(short or row["short"]), "skip": list(skip)}


@app.post("/api/call/{token}/live")
def post_call_live(token: str, body: models.LiveBody, request: Request) -> dict:
    """Fire and forget live telemetry, forwarded to the R1 console as a RigEvent."""
    row = sessions.live(token)
    if row is None:
        raise HTTPException(404, "unknown link")
    limit(token, request, per=sessions.RATE_MAX * 2)
    rig_hub.STATE.update({"running": True, "pid": row["patient_id"],
                          "week": int(row["week"] or 0), "step": body.step})
    rig_hub.frame_event(
        body.step,
        (body.gaze.x, body.gaze.y),
        (body.target.x, body.target.y),
        body.quality.model_dump(),
        body.pursuit_gain,
        body.line.model_dump() if body.line else None,
    )
    if body.line and body.line.text:
        sessions.store_chunk(token, body.step, "line",
                             {"who": body.line.who, "text": body.line.text, "t": body.t / 1000.0})
    return {"ok": True}


@app.post("/api/call/{token}/frames")
def post_call_frames(token: str, body: webframes.FramesBody, request: Request) -> dict:
    """One chunk of measurements for one task. Never video, only numbers."""
    call_row(token)
    limit(token, request)
    try:
        webframes.check_frames(body.frames, body.meta)
        webframes.check_stim(body.stim)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None

    if body.frames:
        sessions.store_chunk(token, body.task, "frames",
                             [f.model_dump() for f in body.frames])
    if body.stim:
        sessions.store_chunk(token, body.task, "stim",
                             [s.model_dump(exclude_none=True) for s in body.stim])
    meta = db.dec(sessions.get(token)["meta"], {}) or {}
    meta.update(body.meta.model_dump())
    sessions.patch(token, {"meta": db.enc(meta)})
    return {"ok": True, "frames": len(body.frames), "stim": len(body.stim)}


@app.post("/api/call/{token}/audio/{task}")
async def post_call_audio(token: str, task: str, request: Request,
                          file: UploadFile = File(...)) -> dict:
    """One task recording. Decoded to 16 kHz mono wav and deleted after the features."""
    call_row(token)
    limit(token, request, per=30)
    data = await file.read()
    try:
        got = callaudio.ingest(token, task, data, file.content_type or "")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return {"ok": True, **{k: v for k, v in got.items() if k != "wav"}}


@app.post("/api/call/{token}/finish")
def post_call_finish(token: str, body: models.FinishBody, tasks: BackgroundTasks) -> dict:
    """End the call and run the pipeline in the background."""
    row = sessions.live(token)
    if row is None:
        raise HTTPException(404, "unknown link")
    if row["state"] in ("done", "processing"):
        return {"ok": True, "call_id": row["call_id"], "state": row["state"]}
    sessions.set_state(token, "processing")
    tasks.add_task(callrun.finish, token, bool(body.aborted))
    return {"ok": True, "call_id": None, "state": "processing"}


@app.get("/api/call/{token}/status", response_model=models.CallStatus)
def get_call_status(token: str) -> dict:
    """Where the call is up to. The wrap screen polls this until it says done."""
    row = sessions.get(token)
    if row is None:
        raise HTTPException(404, "unknown link")
    out = {"state": str(row["state"] or "waiting")}
    if row["call_id"]:
        out["call_id"] = str(row["call_id"])
    if row["summary"]:
        out["summary"] = str(row["summary"])
    if row["error"]:
        out["error"] = str(row["error"])
    return out


@app.get("/api/call/{token}/agent")
def get_call_agent(token: str) -> dict:
    """Whether the optional question and answer agent is available after the script.

    Off by default. It is never on the safety or the measurement path: the red flag
    decision is made from the answers by the backend, the script is fixed, and this
    agent's transcript is stored but never scored and never fed to the twin.
    """
    call_row(token, want_consent=False)
    on = bool(cfg.live_agent and cfg.eleven_agent and cfg.eleven_key)
    return {
        "enabled": on,
        "agent_id": cfg.eleven_agent if on else "",
        "banner": "This assistant is software and cannot give medical advice. It will not "
                  "tell you what is wrong with you, and it will not tell you when you can "
                  "go back to sport, work or driving. Ask your clinician those.",
        "note": "Anything said here is passed to your clinician but is not measured and "
                "does not change your results.",
    }


@app.post("/api/call/{token}/agent/transcript")
def post_call_agent_transcript(token: str, body: models.AgentTranscript) -> dict:
    """Store what was said to the optional agent. Never used for scoring or safety."""
    row = call_row(token, want_consent=False)
    if not cfg.live_agent:
        raise HTTPException(404, "the question and answer agent is off")
    sessions.store_chunk(token, "agent", "agent_line",
                         {"who": body.who, "text": safety.clean(body.text), "t": body.t})
    db.event(row["patient_id"], "agent_qa", {"who": body.who, "chars": len(body.text)})
    return {"ok": True, "scored": False}


@app.get("/api/voices", response_model=models.Voices)
def get_voices() -> dict:
    """Every script line, its hash, and whether its mp3 exists."""
    from .agent import voices

    return voices.payload()


@app.post("/api/voices/{step_id}/regenerate")
def post_voice_regenerate(step_id: str) -> dict:
    """Regenerate one line's mp3."""
    from .agent import voices

    known = {row["id"] for row in voices.lines()}
    if step_id not in known:
        raise HTTPException(404, f"no script line {step_id}")
    got = voices.build(force=True, only=step_id)
    return {"ok": not got["failed"], "line": got["lines"].get(step_id, {}), "live": got["live"]}


@app.get("/api/summary/{pid}/{week}")
def get_summary(pid: str, week: int) -> dict:
    """Both summaries for one week, the patient text and the clinician update."""
    need(pid)
    return summary.for_checkin(pid, int(week))


RESERVED = ("api", "voice", "ui", "stimulus", "docs", "redoc", "openapi.json", "ws", "assets")


@app.get("/{path:path}", response_model=None)
def spa(path: str):
    """Serve the single page app for any client side route.

    Registered last so every real route wins. Anything under a reserved prefix that got
    this far is a genuine 404 rather than a page the app should try to render.
    """
    head = path.split("/", 1)[0]
    if head in RESERVED:
        raise HTTPException(404, f"no route /{path}")
    asset = WEB_DIR / path
    if path and asset.is_file() and WEB_DIR in asset.resolve().parents:
        return FileResponse(str(asset))
    return index_or_json()


def main() -> None:
    """Run the server directly, for when make dev is not handy."""
    import uvicorn

    uvicorn.run("backend.app:app", host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":
    main()
