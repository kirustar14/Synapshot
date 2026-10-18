"""The FastAPI app. Every route in the contract, with the contract's exact field names."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import alerts as alertmod
from . import db, demo, live, logs, models
from .agent import safety, summary
from .calls import audio as callaudio
from .calls import run as callrun
from .calls import script as callscript
from .calls import sessions
from .comms import photon
from .config import ROOT, cfg
from .data import upload
from .features import sem as semmod
from .features import webframes
from .ingest import run as ingestrun
from .ingest import schema as ingest_schema
from .twin import attribution, build, counterfactual, forecast as fcast, population


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Open the database and mask call tokens in the access log."""
    db.conn()
    logs.install()
    yield


app = FastAPI(title="Synapshot", version="0.2.0", lifespan=lifespan)

# The mesh is about 1.5 MB of JSON and the twin payload is not small either, so every
# response over a kilobyte is compressed. Measured: the mesh goes to 499 KB and the twin
# to 48 KB. On a phone reaching this over a tunnel that is the whole difference.
app.add_middleware(GZipMiddleware, minimum_size=1024)

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
        "chart": db.dec(row["chart"], {}) or {},
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


@app.post("/api/patients/ingest", response_model=None)
async def post_ingest(files: list[UploadFile] = File(default=[]), sample: int = Form(default=0)):
    """Build a patient from their documents, streaming the five steps as they happen.

    The response is an event stream on the POST itself rather than a job id and a second
    connection: there is one upload, one pipeline and one page waiting on it, and a job
    table would be three moving parts where one will do. The page reads it with fetch and
    draws a line per step.

    With sample=1 the bundle comes from backend/data/sample, so the demo works with no
    files to hand. It is the same code path either way: the sample files are read off disk
    and pushed through the same reader, the same extractor and the same checks.
    """
    import asyncio

    got: list[tuple[str, bytes]] = []
    for item in files or []:
        got.append((item.filename or "unnamed", await item.read()))
    if sample or not got:
        got = ingestrun.sample_files()
    if not got:
        raise HTTPException(
            400,
            "no files, and the sample bundle is not on disk. Run `make sample` or attach files.",
        )

    async def body():
        # The pipeline is synchronous and CPU bound (the twin fit is numpy), so it runs in
        # a worker thread. Without that the event loop would block and the events would
        # all arrive at once at the end, which would make the build log a lie.
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def work():
            try:
                for event in ingestrun.stream(got):
                    loop.call_soon_threadsafe(queue.put_nowait, event)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        task = asyncio.get_running_loop().run_in_executor(None, work)
        while True:
            event = await queue.get()
            if event is None:
                break
            yield live.sse(event)
        await task

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.get("/api/patients/{pid}", response_model=models.Patient)
def get_patient(pid: str) -> dict:
    """One patient, everything the detail view needs."""
    return patient_obj(pid)


@app.get("/api/patients/{pid}/provenance")
def get_provenance(pid: str) -> dict:
    """Where every extracted field came from: the file, the quote and the confidence.

    This is what the Data tab shows on hover. A patient created without documents has no
    provenance and says so, rather than returning an empty object that reads like a
    clean extraction.
    """
    need(pid)
    rows = db.rows("select * from events where patient_id=? and kind='ingest' order by time",
                   (pid,))
    if not rows:
        return {"ok": True, "ingested": False, "threshold": ingest_schema.NEEDS_REVIEW,
                "fields": {}, "needs_review": [],
                "note": "This patient was generated, not read from documents. "
                        "Every value comes from the synthetic generator."}
    got = db.dec(rows[-1]["payload"], {}) or {}
    return {"ok": True, "ingested": True, "threshold": ingest_schema.NEEDS_REVIEW,
            "fields": got.get("sources") or {},
            "needs_review": got.get("needs_review") or [],
            "extraction": got.get("extraction") or {},
            "note": "Hover a value to see the file and the sentence it was read from."}


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


@app.get("/api/evidence")
def get_evidence() -> dict:
    """What the model rests on, parsed out of docs/RESEARCH.md, plus the live numbers.

    Served from the file rather than a second copy in code, so the drawer and the
    document cannot drift apart. The validation numbers are read from the cohort fit as
    it actually is right now, not from a figure somebody typed in once.
    """
    from . import evidence as evmod

    return evmod.payload()


@app.get("/api/vessels")
def get_vessels() -> dict:
    """The schematic vessel layout, in the same millimetre space as the mesh.

    A diagram, not this patient's vessels. The caption says so and the viewer shows it on
    the layer, because a rendered vessel beside a rendered brain is exactly the thing that
    gets mistaken for an angiogram.
    """
    from .data import vessels as vesselmod

    return vesselmod.load()


@app.get("/api/receptors", response_model=models.Receptors)
def get_receptors() -> dict:
    """Group average receptor maps for the what-if overlay."""
    from .twin import intervention as interv

    return interv.receptors()


BANNER = ("Hypothetical what-if on a network model. Not a treatment recommendation, not "
          "a prediction, and no dose is modelled.")


@app.get("/api/formulary", response_model=models.Formulary)
def get_formulary() -> dict:
    """The drug list, what each one acts on, and what the maps behind it really are.

    Drugs this model cannot represent stay in the list with the reason. Leaving them out
    would make the formulary look like a complete picture of what somebody is taking.
    """
    from .twin import drugs as drugmod

    rec = drugmod.receptor_payload()
    return {
        "drugs": drugmod.drugs(),
        "receptors": rec["names"],
        "tracers": rec.get("tracers") or {},
        "stand_in": rec.get("stand_in") or [],
        "synthetic_template": bool(rec.get("synthetic_template")),
        "banner": BANNER,
        "note": rec.get("note", ""),
    }


@app.post("/api/patients/{pid}/intervention", response_model=None)
def post_intervention(pid: str, body: models.InterventionBody):
    """A clinician only what-if: a receptor slider, or a drug from the formulary.

    Both are the same perturbation underneath. The slider scales one receptor map; a drug
    combines its own targets into one weight first. Neither ever reaches a patient: no
    text, no summary and no forecast sees any of this, and the API test checks that.
    """
    need(pid)
    from .twin import drugs as drugmod
    from .twin import intervention as interv

    if body.drugs:
        picked = [{"name": d.name, "gain": d.gain} for d in body.drugs]
        gain = next((d.gain for d in body.drugs if d.gain is not None), body.gain)
        got = drugmod.simulate(pid, picked, float(gain))
        return {"kind": "drugs", "banner": BANNER, **got}

    if not body.target:
        raise HTTPException(400, "give either a receptor target or a list of drugs")
    try:
        return {"kind": "receptor", "banner": BANNER, **interv.run(pid, body.target, body.gain)}
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


@app.get("/api/alerts/{aid}/explain")
def explain_alert(aid: str) -> dict:
    """The rule behind one flag, its threshold, and where this patient sits against it.

    The left rail shows one line of reason per flag and clicking it opens this, so a flag
    is never a coloured dot with an assertion attached.
    """
    got = alertmod.explain(aid)
    if not got.get("ok"):
        raise HTTPException(404, f"no alert {aid}")
    return got


@app.get("/api/patients/{pid}/timeline")
def get_timeline(pid: str) -> dict:
    """Everything dated that happened to this patient, plus the calendar day summary.

    Four tables, one list. The Timeline tab should not have to know that a check-in, an
    alert, a text and a document ingest are stored in different places.
    """
    need(pid)
    from . import timeline as tl

    return {
        "events": tl.events(pid),
        "days": tl.days(pid),
        "next_call": tl.next_call(pid),
        "bands": tl.BANDS,
    }


@app.get("/api/patients/{pid}/percentile")
def get_percentile(pid: str) -> dict:
    """Where this patient's fitted recovery rate sits in the cohort.

    A ribbon with a marker on it, not a grade. `limits` is served with it and the panel
    shows it, because "68th percentile" reads like a result and is a much narrower claim
    than it looks.
    """
    need(pid)
    from . import timeline as tl

    return tl.percentile(pid)


@app.get("/api/cohort", response_model=models.Cohort)
def get_cohort() -> dict:
    """The population layer results. Seeds on demand when cohort.json is missing."""
    got = population.load()
    if got is None:
        from . import seed

        got = seed.build(quiet=True)["cohort"]
    return got


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

    With a real transport, create a session and text the link, then wait for the patient
    to open it on their own phone. In demo mode, run a generated session through the real
    ingest and the real pipeline, so the whole path is exercised with no phone at all.
    """
    pid = body.patient_id or ""
    need(pid)

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


# ---------------------------------------------------------------- the event stream

@app.get("/api/patients/{pid}/stream")
async def get_stream(pid: str):
    """Server-sent events for one patient: live call frames, alerts, and call_done.

    This replaces the rig websocket. The workspace opens it when it loads, so the brain
    and the flags update themselves rather than waiting for somebody to hit refresh. One
    stream per patient, so a clinician with one chart open is never sent another
    patient's measurements.
    """
    need(pid)
    return StreamingResponse(
        live.stream(pid),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


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
        "routes": ["/", "/clinic", "/patients/new", "/patients/:id", "/call/:token"],
    })


@app.get("/", response_model=None)
def root():
    """The clinician app, or a pointer list before the frontend is built."""
    return index_or_json()


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


@app.post("/api/messages/inbound")
def post_inbound(body: models.InboundBody) -> dict:
    """A reply coming back from the patient.

    One route for both the real transport's webhook and the demo console, so the
    midweek symptom check, the STOP withdrawal and the reply parsing are the same code
    either way. Spectrum Cloud signs its webhooks, and verifying that signature is the
    one piece still to do before this is exposed publicly. See DECISIONS.md.
    """
    pid = body.patient_id or ""
    need(pid)
    return photon.incoming(pid, body.body, channel=body.channel or "")


@app.post("/api/comms/midweek")
def post_midweek(body: models.MidweekBody) -> dict:
    """Text every consented patient who is due a midweek symptom check."""
    got = photon.run_midweek(body.days)
    return {"ok": True, "sent": got}


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
def get_call_script(token: str, full: int = 0) -> dict:
    """The script the page runs. Marks the session opened.

    The brief four minute version by default, which is what a patient on a phone gets.
    ?full=1 serves the whole fourteen minute protocol. `short` is the separate symptom
    rule and applies to either.
    """
    row = call_row(token, want_consent=False)
    sessions.open_session(token)
    from .agent import voices

    return callscript.payload(short=bool(row["short"]), full=bool(full),
                              audio=voices.audio_map())


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
        # The patient is told to get help now and the tasks stop. The alert lands in the
        # clinician's workspace over the event stream; nothing here phones anybody.
        alertmod.red_flag(pid, answers, notify=True)
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


@app.post("/api/call/{token}/answer")
def post_call_answer(token: str, body: models.AnswerBody) -> dict:
    """One spoken or tapped answer that is not a symptom score.

    The near point of convergence is the case this exists for: the patient taps when the
    dot goes double and the page reports the distance in centimetres. The pipeline has
    always read `answers["npc_cm"]`, and before this there was no way to put it there.
    """
    row = call_row(token)
    have = db.dec(row["symptoms"], {}) or {}
    answers = dict(have.get("answers") or {})
    answers[body.task] = body.value
    sessions.patch(token, {"symptoms": db.enc({**have, "answers": answers})})
    return {"ok": True, "task": body.task, "stored": list(answers)}


@app.post("/api/call/{token}/live")
def post_call_live(token: str, body: models.LiveBody, request: Request) -> dict:
    """Fire and forget live telemetry, pushed to the clinician's open call modal.

    The phone posts this about every 200 ms while a task runs. It is numbers only, never
    video, and it is not stored or scored: the measurements that count arrive in whole
    chunks on /frames. This exists so the strip in the modal shows something true while
    the call is happening.
    """
    row = sessions.live(token)
    if row is None:
        raise HTTPException(404, "unknown link")
    limit(token, request, per=sessions.RATE_MAX * 2)
    live.frame(
        str(row["patient_id"]),
        body.step,
        {"x": body.gaze.x, "y": body.gaze.y},
        {"x": body.target.x, "y": body.target.y},
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


RESERVED = ("api", "voice", "docs", "redoc", "openapi.json", "assets")


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
