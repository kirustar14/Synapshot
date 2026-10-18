"""The FastAPI app. Every route in the contract, with the contract's exact field names."""

from contextlib import asynccontextmanager
from pathlib import Path
import time

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import alerts as alertmod
from . import auth, db, demo, live, logs, models, observability, team, telemetry
from .agent import creao, safety, summary
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
# Before the app exists, so the FastAPI integration instruments it. A no-op without
# SENTRY_DSN in .env.
observability.init()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Open the database and mask call tokens in the access log."""
    db.conn()
    logs.install()
    team.ensure_demo()
    yield


app = FastAPI(title="Synapshot", version="0.2.0", lifespan=lifespan)

# The mesh is about 1.5 MB of JSON and the twin payload is not small either, so every
# response over a kilobyte is compressed. Measured: the mesh goes to 499 KB and the twin
# to 48 KB. On a phone reaching this over a tunnel that is the whole difference.
app.add_middleware(GZipMiddleware, minimum_size=1024)

# Everything under /api is clinician-only except the patient token routes, the sign in
# routes and the public reference data. The allow list is explicit: a new route is
# protected by default, which is the direction a mistake should fail in.
PUBLIC_API = (
    "/api/health",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",
    "/api/auth/demo",
    "/api/call/",
    "/api/mesh",
    "/api/receptors",
    "/api/loadings",
    "/api/voices",
    "/api/messages/inbound",
    "/api/creao/callback",
)


def _public(path: str) -> bool:
    """Exact match for a route, prefix match for a token namespace."""
    return any(path == item or (item.endswith("/") and path.startswith(item))
               for item in PUBLIC_API)


@app.middleware("http")
async def auth_gate(request: Request, call_next):
    """Reject an unauthenticated API request before it reaches a route.

    This is coarse on purpose. Per-patient scoping happens in the route with
    auth.require_patient, because only the route knows which patient id it is about.
    """
    path = request.url.path
    if cfg.auth_enabled and path.startswith("/api/") and not _public(path):
        who = auth.from_request(request)
        if who is None:
            return JSONResponse({"detail": "sign in required"}, status_code=401)
        request.state.clinician = who
    return await call_next(request)


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

def checkin_obj(row, with_gaze: bool = True, with_evidence: bool = True) -> dict:
    """One Checkin in the contract shape.

    `with_evidence=False` drops the three bulky fields (gaze, traces, transcript) and keeps
    the scored ones. A list or a `last_call` pointer is read for its measures, week and
    duration; the raw traces are only ever rendered on the one assessment that is open.
    Dropping them here is a 290 KB saving per row on each of those reads.
    """
    out = {
        "id": row["id"],
        "patient_id": row["patient_id"],
        "week": int(row["week"]),
        "date": row["date"],
        "duration_s": float(row["duration_s"] or 0),
        "steps": db.dec(row["steps"], []) or [],
        "channel": db.dec(row["channel"], {}) or {"fps": 0, "calib_err_deg": 0, "face_share": 0, "flash_ok": False},
        "features": db.dec(row["features"], []) or [],
        "gaze": (db.dec(row["gaze"], []) or []) if with_gaze and with_evidence else [],
        "traces": (db.dec(row["traces"], None)) if with_evidence else None,
        "transcript": (db.dec(row["transcript"], []) or []) if with_evidence else [],
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


def patient_row(row, flags: list[str] | None = None) -> dict:
    """One PatientRow in the contract shape."""
    return {
        "id": row["id"],
        "name": row["name"],
        "week": int(row["week"] or 0),
        "drift_z": round(float(row["drift_z"] or 0.0), 3),
        "last_call": row["last_call"],
        "flags": alertmod.flags(row["id"]) if flags is None else flags,
        "synthetic": bool(row["synthetic"]),
    }


def patient_obj(pid: str) -> dict:
    """One Patient in the contract shape."""
    row = need(pid)
    chk = db.latest_checkin_summary(pid)
    params = db.dec(row["params"], {}) or {}
    return {
        "id": row["id"],
        "name": row["name"],
        "age": int(row["age"] or 0),
        "sex": row["sex"],
        "week": int(row["week"] or 0),
        "injury": db.dec(row["injury"], {}) or {},
        "chart": db.dec(row["chart"], {}) or {},
        # current_inputs reads the uploads table first and only decrypts the twin bundle
        # when there are none, so this no longer pulls 145 KB to build a four item list.
        "inputs": current_inputs(pid),
        "alleles": db.dec(row["alleles"], {}) or {},
        "biomarkers": db.dec(row["biomarkers"], {}) or {},
        "fc_fit": None if row["fc_fit"] is None else float(row["fc_fit"]),
        "coverage": round(float(row["coverage"] or 0.0), 3),
        "drift_z": round(float(row["drift_z"] or 0.0), 3),
        "contraction": db.dec(row["contraction"], {"k": 0.0}) or {"k": 0.0},
        "params": {
            "G": float(params.get("G", 0.0)), "k": float(params.get("k", 0.0)),
            "p": float(params.get("p", 0.0)), "eps": float(params.get("eps", 0.0)),
        },
        "alerts": [alert_obj(a) for a in db.alerts(pid)],
        "last_call": checkin_obj(chk, with_evidence=False) if chk else None,
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
    """Is the backend up, in which mode, on which database, with login on or off."""
    return {"ok": True, "mode": cfg.mode(), "db": db.dialect(),
            "auth": cfg.auth_enabled}


# ---------------------------------------------------------------- auth and team

@app.post("/api/auth/login", response_model=models.ClinicianOut)
def post_login(body: models.LoginBody, request: Request, response: Response) -> dict:
    """Email and password, one session cookie, the same error for every failure."""
    got = auth.login(body.email, body.password,
                     user_agent=request.headers.get("user-agent", ""))
    if got is None:
        raise HTTPException(401, "email or password is wrong")
    response.set_cookie(
        auth.COOKIE, got["token"], max_age=int(cfg.session_ttl_h * 3600),
        httponly=True, samesite="lax", secure=auth.cookie_secure(), path="/",
    )
    return got["clinician"]


@app.post("/api/auth/demo", response_model=models.ClinicianOut)
def post_demo_login(response: Response) -> dict:
    """The one click demo account. Off unless DEMO_LOGIN=1."""
    got = auth.demo_login()
    if got is None:
        raise HTTPException(404, "the demo account is not available")
    response.set_cookie(
        auth.COOKIE, got["token"], max_age=int(cfg.session_ttl_h * 3600),
        httponly=True, samesite="lax", secure=auth.cookie_secure(), path="/",
    )
    return got["clinician"]


@app.get("/api/auth/me")
def get_me(request: Request) -> dict:
    """The signed in clinician. 401 is the normal signed out answer, not an error."""
    who = auth.from_request(request)
    if who is None:
        raise HTTPException(401, "not signed in")
    return {**who, "auth": cfg.auth_enabled}


@app.post("/api/auth/logout")
def post_logout(request: Request, response: Response) -> dict:
    """Drop the server side session and clear the cookie."""
    auth.logout(auth.token_of(request))
    response.delete_cookie(auth.COOKIE, path="/")
    return {"ok": True}


@app.get("/api/clinics")
def get_clinics(request: Request) -> list[dict]:
    """The clinics. A clinician may only see their own unless they are an admin."""
    who = auth.current(request)
    rows = [dict(r) for r in db.rows("select * from clinics order by name")]
    if who.get("role") != "admin" and who.get("clinic_id"):
        rows = [r for r in rows if str(r["id"]) == who.get("clinic_id")]
    return rows


@app.get("/api/clinicians")
def get_clinicians(request: Request) -> list[dict]:
    """Everyone who can sign in. Never the password hash."""
    who = auth.current(request)
    rows = team.staff_rows()
    if who.get("clinic_id"):
        rows = [r for r in rows if str(r.get("clinic_id") or "") == who.get("clinic_id")]
    return rows


@app.get("/api/assignments")
def get_assignments(request: Request, patient_id: str | None = None) -> list[dict]:
    """Who is responsible for which patient."""
    who = auth.current(request)
    if patient_id:
        auth.require_patient(patient_id, request)
        return team.assignments(patient_id)
    rows = team.assignments()
    allowed = auth.patient_ids(who)
    if allowed is not None:
        rows = [r for r in rows if str(r.get("patient_id")) in allowed]
    return rows


@app.post("/api/assignments")
def post_assignment(body: models.AssignmentBody, request: Request) -> dict:
    """Assign a patient to a clinician. The pair is unique, so this is safe to repeat."""
    who = auth.current(request)
    auth.require_patient(body.patient_id, request)
    if who.get("role") not in ("admin", "doctor"):
        raise HTTPException(403, "only a doctor or an admin can assign a patient")
    try:
        return team.assign(body.patient_id, body.clinician_id, body.role)
    except KeyError as exc:
        raise HTTPException(404, str(exc).strip("'\"")) from None


@app.delete("/api/assignments/{aid}")
def delete_assignment(aid: str, request: Request) -> dict:
    """Deactivate one assignment. The audit row stays.

    The patient is scoped before the row is touched, so knowing an assignment id from
    another clinic is not enough to remove it.
    """
    who = auth.current(request)
    if who.get("role") not in ("admin", "doctor"):
        raise HTTPException(403, "only a doctor or an admin can unassign a patient")
    row = db.one("select * from assignments where id=?", (aid,))
    if row is None:
        raise HTTPException(404, f"no assignment {aid}")
    auth.require_patient(str(row["patient_id"]), request)
    if not team.unassign(aid):
        raise HTTPException(404, f"no assignment {aid}")
    return {"ok": True, "id": aid, "active": False}


# ---------------------------------------------------------------- patients

@app.get("/api/patients", response_model=list[models.PatientRow])
def list_patients(request: Request) -> list[dict]:
    """The clinician's worklist. Scoped to assignments and, for an admin, the clinic."""
    allowed = auth.scoped_patients(request)
    rows = db.worklist_rows()
    if allowed is not None:
        rows = [r for r in rows if str(r["id"]) in allowed]
    # One query for every patient's flags: this used to be one query per row, and each one
    # costs a round trip to the hosted database.
    flags = db.alert_types()
    return [patient_row(r, flags.get(str(r["id"]), [])) for r in rows]


def assign_patient(pid: str, who: dict) -> None:
    """Put a newly created record in its creator's clinic and worklist."""
    if who.get("clinic_id"):
        db.patch("patients", pid, {"clinic_id": who["clinic_id"]})
        team.assign(pid, str(who["id"]), "primary")
    else:
        # AUTH_ENABLED=0 has no clinic on the synthetic admin. Put the new record in the
        # first clinic and let the deterministic assignment pass pick it up, so a local
        # checkout never creates a patient nobody can see.
        clinic = db.one("select id from clinics order by id")
        if clinic is not None:
            db.patch("patients", pid, {"clinic_id": str(clinic["id"])})
            team.assign_demo()


@app.post("/api/patients", response_model=models.Patient)
def create_patient(body: models.NewPatient, request: Request) -> dict:
    """Create a patient, put it in the clinician's clinic, and build its twin."""
    who = auth.current(request)
    pid = demo.new_patient(body.name, body.age, body.sex)
    assign_patient(pid, who)
    return patient_obj(pid)


@app.post("/api/patients/ingest", response_model=None)
async def post_ingest(request: Request, files: list[UploadFile] = File(default=[]), sample: int = Form(default=0)):
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

    who = auth.current(request)
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
                    if event.get("kind") == "done":
                        assign_patient(str(event["patient_id"]), who)
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
def get_patient(pid: str, request: Request) -> dict:
    """One patient, everything the detail view needs."""
    auth.require_patient(pid, request)
    return patient_obj(pid)


@app.get("/api/patients/{pid}/provenance")
def get_provenance(pid: str, request: Request) -> dict:
    """Where every extracted field came from: the file, the quote and the confidence.

    This is what the Data tab shows on hover. A patient created without documents has no
    provenance and says so, rather than returning an empty object that reads like a
    clean extraction.
    """
    auth.require_patient(pid, request)
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
def get_forecast(pid: str, request: Request) -> dict:
    """Twelve week forecast with 80% bands and the coverage history."""
    auth.require_patient(pid, request)
    return forecast_obj(pid)


@app.get("/api/patients/{pid}/twin", response_model=models.Twin)
def get_twin(pid: str, request: Request) -> dict:
    """Regions, edges and top tracts over the forecast weeks."""
    auth.require_patient(pid, request)
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
def get_shape(pid: str, request: Request) -> dict:
    """How this patient's brain differs in shape from the template. Illustrative."""
    auth.require_patient(pid, request)
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


# The Treatment tab used to simulate a drug: it perturbed the dynamic mean field model
# with a receptor-weighted gain and showed a baseline, a with-drug and a difference. That
# is a treatment response prediction, and nothing in this system has the standing to make
# one. It is gone, along with the /intervention route and the effect size slider, and
# what replaced it only shows where a medicine's known targets and pathways are. See
# DECISIONS.md.


@app.get("/api/formulary", response_model=None)
def get_formulary() -> dict:
    """Every medicine, what it does, what it acts on, and where that is in the brain.

    Medicines with no mapped brain target stay in the list with that said plainly.
    Leaving them out would make the formulary look like a complete picture of what
    somebody is taking when it is not.
    """
    from .data import drugs as drugmod

    return drugmod.listing()


@app.get("/api/pathways", response_model=None)
def get_pathways() -> dict:
    """Schematic transmitter pathways, in the same space as the mesh and the vessels."""
    from .data import drugs as drugmod

    return drugmod.pathways()


@app.get("/api/drugs/{name}", response_model=None)
def get_drug(name: str) -> dict:
    """One medicine's full record."""
    from .data import drugs as drugmod

    got = drugmod.drug(name)
    if got is None:
        raise HTTPException(404, f"no medicine called {name}")
    return drugmod.clean_record(got)


@app.get("/api/drugs/{name}/map", response_model=None)
def get_drug_map(name: str) -> dict:
    """Per target z scored density over the 100 regions, and the mean across targets."""
    from .data import drugs as drugmod

    if drugmod.drug(name) is None:
        raise HTTPException(404, f"no medicine called {name}")
    return drugmod.density(name)


@app.get("/api/patients/{pid}/drugs/{name}/overlap", response_model=None)
def get_drug_overlap(pid: str, request: Request, name: str, week: int = 0) -> dict:
    """Regions that are both damaged in this patient and dense in this drug's targets.

    An intersection of two maps. It does not say the medicine reaches those regions and
    it does not say anything would improve if it did.
    """
    auth.require_patient(pid, request)
    from .data import drugs as drugmod

    if drugmod.drug(name) is None:
        raise HTTPException(404, f"no medicine called {name}")
    return drugmod.overlap(pid, name, week=week)


@app.get("/api/patients/{pid}/suggested-drugs", response_model=None)
def get_suggested_drugs(pid: str, request: Request) -> dict:
    """Medicines commonly considered for the symptoms this patient reported.

    Ordered by how many of their elevated symptoms each one is ordinarily used for. Not a
    ranking of which is better, because nothing here could know that.
    """
    auth.require_patient(pid, request)
    from .data import suggest

    return suggest.suggested(pid)


@app.get("/api/loadings", response_model=models.Loadings)
def get_loadings() -> dict:
    """Which regions drive which signal. A design assumption, behind REGIONAL_LOADINGS."""
    from .twin import loadings as loadmod

    if not loadmod.enabled():
        raise HTTPException(404, "regional loadings are off, set REGIONAL_LOADINGS=1")
    return loadmod.payload()


@app.post("/api/patients/{pid}/scenarios", response_model=models.ScenarioResult)
def post_scenarios(pid: str, body: models.ScenarioBody, request: Request) -> dict:
    """Two what-if impacts side by side."""
    reach_only("scenario compare")
    auth.require_patient(pid, request)
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
def post_counterfactual(pid: str, body: models.CounterfactualBody, request: Request) -> dict:
    """Forecast with the recovery rate scaled and the residual shifted."""
    reach_only("the counterfactual slider")
    auth.require_patient(pid, request)
    return counterfactual.forecast(pid, body.k_mult, body.p_add)


@app.get("/api/patients/{pid}/attribution", response_model=list[models.Attribution])
def get_attribution(pid: str, request: Request) -> list[dict]:
    """Top tracts per signal. Always labelled a hypothesis."""
    reach_only("tract attribution")
    auth.require_patient(pid, request)
    return attribution.attribution(pid)


@app.get("/api/patients/{pid}/checkins", response_model=list[models.Checkin])
def get_checkins(pid: str, request: Request) -> list[dict]:
    """Every check-in for a patient, as a summary: measures, week and duration.

    Gaze traces, face traces and the transcript are the detail of one assessment, and they
    are 290 KB of a row. The list never renders them, so it does not carry them; open the
    check-in itself (`/api/checkins/{cid}`) for those.
    """
    auth.require_patient(pid, request)
    return [checkin_obj(r, with_evidence=False) for r in db.checkins_summary(pid)]


@app.get("/api/checkins/{cid}", response_model=models.Checkin)
def get_checkin(cid: str, request: Request) -> dict:
    """One check-in, with the gaze arrays."""
    row = db.checkin(cid)
    if row is None:
        raise HTTPException(404, f"no checkin {cid}")
    auth.require_patient(str(row["patient_id"]), request)
    return checkin_obj(row, with_gaze=True)


@app.post("/api/checkins/{cid}/rescore")
def rescore(cid: str, body: models.RescoreBody, request: Request) -> dict:
    """Re-run the feature functions for one task of a stored check-in."""
    row = db.checkin(cid)
    if row is None:
        raise HTTPException(404, f"no checkin {cid}")
    auth.require_patient(str(row["patient_id"]), request)
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
def mark_unusable(cid: str, request: Request) -> dict:
    """Mark a check-in unusable and drop its observations from the twin."""
    row = db.checkin(cid)
    if row is None:
        raise HTTPException(404, f"no checkin {cid}")
    auth.require_patient(str(row["patient_id"]), request)
    db.patch("checkins", cid, {"unusable": 1})
    db.run("delete from observations where patient_id=? and week=?", (row["patient_id"], int(row["week"])))
    db.event(row["patient_id"], "checkin_unusable", {"checkin": cid, "week": int(row["week"])})
    build.rebuild_forecast(row["patient_id"])
    return {"ok": True, "checkin_id": cid, "unusable": True}


@app.post("/api/patients/{pid}/uploads", response_model=list[models.InputFile])
async def post_uploads(pid: str, request: Request, kind: str | None = Form(default=None), file: UploadFile | None = File(default=None)) -> list[dict]:
    """A real multipart upload, or the synthetic shortcut when no file is sent."""
    auth.require_patient(pid, request)
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
def get_twin_inputs(pid: str, request: Request) -> dict:
    """What the twin was built from, the FC fit and whether it is low fidelity."""
    auth.require_patient(pid, request)
    row = need(pid)
    bundle = inputs_of(pid)
    return {
        "inputs": current_inputs(pid),
        "fc_fit": None if row["fc_fit"] is None else float(row["fc_fit"]),
        "low_fidelity": bool(row["low_fidelity"]) or bool(bundle.get("low_fidelity")),
    }


@app.post("/api/patients/{pid}/build-twin", response_model=models.Patient)
def post_build_twin(pid: str, request: Request) -> dict:
    """Rebuild the twin from whatever inputs are there now."""
    auth.require_patient(pid, request)
    has_imaging = any(r["kind"] in ("dwi", "fmri") and r["status"] in ("ok", "warn") for r in db.uploads(pid))
    build.build_twin(pid, template_only=not has_imaging if db.uploads(pid) else None)
    return patient_obj(pid)


@app.get("/api/patients/{pid}/messages", response_model=list[models.Message])
def get_messages(pid: str, request: Request) -> list[dict]:
    """The message thread for a patient, each row saying which transport carried it."""
    auth.require_patient(pid, request)
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
def post_note(pid: str, body: models.NoteBody, request: Request) -> dict:
    """Store a clinician note on a patient."""
    auth.require_patient(pid, request)
    db.patch("patients", pid, {"note": body.text})
    db.event(pid, "note", {"text": body.text})
    return {"ok": True, "patient_id": pid, "text": body.text}


# ---------------------------------------------------------------- alerts and cohort

@app.get("/api/alerts", response_model=list[models.Alert])
def get_alerts(request: Request, patient_id: str | None = None) -> list[dict]:
    """Alerts, newest first, optionally for one patient, scoped to this clinician."""
    if patient_id:
        auth.require_patient(patient_id, request)
    allowed = auth.scoped_patients(request)
    rows = db.alerts(patient_id)
    if allowed is not None:
        rows = [a for a in rows if str(a["patient_id"]) in allowed]
    return [alert_obj(a) for a in rows]


def _alert_row(aid: str, request: Request):
    row = db.one("select * from alerts where id=?", (aid,))
    if row is None:
        raise HTTPException(404, f"no alert {aid}")
    auth.require_patient(str(row["patient_id"]), request)
    return row


@app.post("/api/alerts/{aid}/ack")
def ack_alert(aid: str, request: Request) -> dict:
    """Acknowledge an alert."""
    _alert_row(aid, request)
    alertmod.ack(aid)
    return {"ok": True, "id": aid, "acked": True}


@app.get("/api/alerts/{aid}/explain")
def explain_alert(aid: str, request: Request) -> dict:
    """The rule behind one flag, its threshold, and where this patient sits against it.

    The left rail shows one line of reason per flag and clicking it opens this, so a flag
    is never a coloured dot with an assertion attached.
    """
    _alert_row(aid, request)
    got = alertmod.explain(aid)
    if not got.get("ok"):
        raise HTTPException(404, f"no alert {aid}")
    return got


@app.get("/api/patients/{pid}/timeline")
def get_timeline(pid: str, request: Request) -> dict:
    """Everything dated that happened to this patient, plus the calendar day summary.

    Four tables, one list. The Timeline tab should not have to know that a check-in, an
    alert, a text and a document ingest are stored in different places.
    """
    auth.require_patient(pid, request)
    from . import timeline as tl

    return {
        "events": tl.events(pid),
        "days": tl.days(pid),
        "next_call": tl.next_call(pid),
        "bands": tl.BANDS,
    }


@app.get("/api/patients/{pid}/percentile")
def get_percentile(pid: str, request: Request) -> dict:
    """Where this patient's fitted recovery rate sits in the cohort.

    A ribbon with a marker on it, not a grade. `limits` is served with it and the panel
    shows it, because "68th percentile" reads like a result and is a much narrower claim
    than it looks.
    """
    auth.require_patient(pid, request)
    from . import timeline as tl

    return tl.percentile(pid)


# ---------------------------------------------------------------- the data platform

@app.get("/api/pulse")
def get_pulse(request: Request, bench: bool = False, minutes: int = 60, hours: int = 48) -> dict:
    """The live dashboard read path, backed by local SQLite telemetry.

    The legacy benchmark option remains admin-only and reports that it is unavailable.
    """
    who = auth.current(request)
    # A dashboard read is also the natural moment to publish the buffered samples. It is
    # one batched insert at most, and it means the chart is never five seconds stale while
    # claiming to be live.
    telemetry.flush()
    got = telemetry.pulse(minutes=max(5, min(int(minutes), 1440)),
                      hours=max(1, min(int(hours), 24 * 30)))
    if bench:
        if who.get("role") != "admin":
            raise HTTPException(403, "the benchmark is admin only")
        got["bench"] = {"available": False, "reason": "SQLite storage has no aggregate benchmark"}
    return got


@app.get("/api/cohort", response_model=models.Cohort)
def get_cohort() -> dict:
    """The population layer results. Seeds on demand when cohort.json is missing."""
    got = population.load()
    if got is None:
        from . import seed

        got = seed.build(quiet=True)["cohort"]
    return got


# ---------------------------------------------------------------- demo controls

@app.get("/api/observability")
def observability_status() -> dict:
    """Whether the backend is reporting to Sentry, and which products it sends."""
    return observability.status()


@app.post("/api/demo/sentry/error")
def demo_sentry_error() -> dict:
    """Send one deliberate, handled error to Sentry. No patient data involved."""
    if not observability.status()["on"]:
        raise HTTPException(409, "Sentry is off: set SENTRY_DSN in .env and restart")
    return observability.demo_error()


@app.post("/api/demo/sentry/trace")
def demo_sentry_trace() -> dict:
    """Run a short traced job with a span and a log per step, for the Sentry demo."""
    if not observability.status()["on"]:
        raise HTTPException(409, "Sentry is off: set SENTRY_DSN in .env and restart")
    return observability.demo_trace()


@app.post("/api/demo/reset")
def demo_reset(request: Request) -> dict:
    """Reseed the six demo patients and the cohort. Admin only."""
    who = auth.current(request)
    if who.get("role") != "admin":
        raise HTTPException(403, "only an admin can reset the demo data")
    got = demo.reset(quiet=True)
    return {"ok": True, **got}


@app.post("/api/demo/advance-week")
def demo_advance(body: models.DemoBody, request: Request) -> dict:
    """Move a patient one week on: next truth, mock call, EnKF update."""
    pid = body.patient_id or ""
    auth.require_patient(pid, request)
    got = demo.advance_week(pid)
    return {
        "ok": True, "patient_id": pid, "week": got["week"],
        "drift_z": round(float(got["diag"]["drift_z"]), 3),
        "coverage": got["diag"]["cov"],
        "alerts": [a["type"] for a in got["alerts"]],
    }


@app.post("/api/demo/inject-drift")
def demo_drift(body: models.DemoBody, request: Request) -> dict:
    """Push next week's truth outside the band."""
    reach_only("drift injection")
    pid = body.patient_id or ""
    auth.require_patient(pid, request)
    got = demo.inject_drift(pid, body.size)
    return {"ok": True, "patient_id": pid, "week": got["week"], "size": body.size}


@app.post("/api/demo/trigger-call")
def demo_call(body: models.DemoBody, tasks: BackgroundTasks, request: Request) -> dict:
    """Start a call now.

    With a real transport, create a session and text the link, then wait for the patient
    to open it on their own phone. In demo mode, run a generated session through the real
    ingest and the real pipeline, so the whole path is exercised with no phone at all.
    """
    pid = body.patient_id or ""
    auth.require_patient(pid, request)

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


@app.get("/api/patients/{pid}/baseline", response_model=None)
def get_baseline(pid: str, request: Request) -> dict:
    """The brain as it was first built, plus every check-in appended since.

    The viewer's Baseline and Latest toggle reads this. Before it existed there was one
    copy of the brain and a check-in overwrote it, so the state the patient was built
    from could not be got back and a call looked like it had replaced them.
    """
    auth.require_patient(pid, request)
    from .twin import build as buildmod

    points = buildmod.timepoints_of(pid)
    return {
        "baseline": buildmod.baseline_of(pid),
        "timepoints": points,
        "count": len(points),
        "note": "The baseline is the brain as first built from this patient's documents. "
                "It is never rewritten. Each check-in is appended on top of it.",
    }


@app.post("/api/dev/reset-demo-patient", response_model=None)
def post_reset_demo_patient(request: Request, pid: str = "") -> dict:
    """Put the flagship demo patient back to pristine, so the demo can be run again.

    Demo mode only. It rebuilds from the sample documents, which is the same path the
    Add patient screen uses, so what comes back is what a judge would have seen the first
    time rather than a special case.
    """
    if cfg.mode() != "mock":
        raise HTTPException(403, "only available in demo mode")

    from .twin import build as buildmod

    want = pid
    if not want:
        # The flagship one by name, so the demo button needs no id.
        allowed = auth.scoped_patients(request)
        hit = [p for p in db.patients()
               if "maya" in str(p["name"]).lower()
               and (allowed is None or str(p["id"]) in allowed)]
        if not hit:
            raise HTTPException(404, "no sample patient to reset. Add one from the sample files.")
        want = str(hit[-1]["id"])
    auth.require_patient(want, request)

    # Everything a call wrote. The documents, the extraction and the patient's own record
    # are left alone, which is what makes this a reset rather than a delete.
    db.run("delete from checkins where patient_id=?", (want,))
    db.run("delete from observations where patient_id=?", (want,))
    db.run("delete from alerts where patient_id=?", (want,))
    db.run("delete from call_sessions where patient_id=?", (want,))
    db.run("delete from events where patient_id=? and kind in "
           "('call_update','call_session','notify','agent_triage','creao_run_started')", (want,))
    db.patch("patients", want, {"week": 0, "drift_z": 0.0, "coverage": 0.0, "last_call": None})

    got = buildmod.build_twin(want)
    return {"ok": True, "patient_id": want, "regions": len(got["twin"]["regions"]),
            "note": "rebuilt from this patient's own documents and inputs. "
                    "Nothing uploaded was deleted."}


@app.get("/api/patients/{pid}/latest-update", response_model=models.CallUpdate | None)
def get_latest_update(pid: str, request: Request) -> dict | None:
    """What the most recent check-in changed in the brain, or null if there has not been one.

    The same payload the stream pushes on `call_done`. A page that loads after the call
    landed needs it too, and reading it back from the event row rather than recomputing
    it means the banner says the same thing either way.
    """
    auth.require_patient(pid, request)
    rows = db.rows(
        "select * from events where patient_id=? and kind='call_update' "
        "order by time desc limit 1", (pid,))
    if not rows:
        return None
    return db.dec(rows[0]["payload"], {}) or None


# ---------------------------------------------------------------- the event stream

@app.get("/api/patients/{pid}/stream")
async def get_stream(pid: str, request: Request):
    """Server-sent events for one patient: live call frames, alerts, and call_done.

    This replaces the rig websocket. The workspace opens it when it loads, so the brain
    and the flags update themselves rather than waiting for somebody to hit refresh. One
    stream per patient, so a clinician with one chart open is never sent another
    patient's measurements.
    """
    auth.require_patient(pid, request)
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
def post_calls(body: models.CallBody, request: Request) -> dict:
    """Create a call session and, when asked, text the patient the link.

    What comes back about the text is deliberately detailed: the channel, the status,
    the message row so delivery can be polled, and the real reason when it failed. The
    modal shows all of it, because "iMessage could not deliver" with no reason is the
    thing that wasted an afternoon.
    """
    pid = body.patient_id or ""
    auth.require_patient(pid, request)
    got = sessions.create(pid, body.week)
    if body.send:
        from .comms import notify as texter

        sent = texter.send(pid, "call_link", link=got["url"])
        got = {
            **got,
            "sent": True,
            "channel": sent.get("channel", "mock"),
            "status": sent.get("status", "mock"),
            "message_id": sent.get("message_id", ""),
            "why": sent.get("why", ""),
            "error": sent.get("imessage_error", ""),
            "tried": sent.get("tried", []),
        }
    return got


@app.post("/api/calls/{token}/send", response_model=models.CallSend)
def post_call_send(token: str, request: Request) -> dict:
    """Text an existing check-in link to the patient.

    Separate from creating the session on purpose. Creating a link is a local act; putting a
    message on somebody's phone is not, so the two are not the same button. Reusing the
    session keeps one link per check-in instead of one per click.
    """
    row = sessions.get(token)
    if row is None:
        raise HTTPException(404, "unknown link")
    pid = str(row["patient_id"])
    auth.require_patient(pid, request)
    from .comms import notify as texter

    sent = texter.send(pid, "call_link", link=f"{cfg.base_url()}/call/{token}")
    return {"ok": bool(sent.get("ok")), "channel": str(sent.get("channel") or "mock"),
            "to": str(sent.get("to") or ""), "body": str(sent.get("body") or ""),
            "error": str(sent.get("error") or "")}


@app.get("/api/messages/{mid}/status")
def get_message_status(mid: str, request: Request) -> dict:
    """Has this message been delivered yet?

    The call modal polls this for half a minute after a send. It is the only thing that
    can turn `sent` into `delivered`, and it only does so when the provider says so: a
    message that was accepted and never confirmed stays `sent` forever, which is the
    truth about it.
    """
    from .comms import notify as texter

    row = db.one("select * from messages where id=?", (mid,))
    if row is None:
        raise HTTPException(404, f"no message {mid}")
    auth.require_patient(str(row["patient_id"]), request)
    got = texter.confirm(mid)
    fresh = db.one("select * from messages where id=?", (mid,))
    status = str(got.get("status") or fresh["status"] or "sent")
    # `failed` is what the transport layer calls it. `not_sent` is what it means on a
    # screen: nothing left the building. Four states, and none of them is a guess.
    if status == "failed":
        status = "not_sent"
    if status not in ("sent", "delivered", "not_sent", "mock"):
        status = "sent"

    delivered_at = str(fresh["delivered_at"] or "") or None
    confirmation = "provider" if status == "delivered" else got.get("confirmation", "unavailable")
    return {
        "ok": True,
        "id": mid,
        "channel": str(fresh["channel"] or ""),
        "status": status,
        "provider_id": str(fresh["provider_id"] or "") or None,
        "error": str(fresh["detail"] or "") or None,
        "delivered_at": delivered_at,
        # Only ever "provider" when a provider actually said so. Everything else is
        # "unavailable", including local iMessage, which cannot read receipts at all.
        "delivery_confirmation": confirmation,
        "note": got.get("note", ""),
    }


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
                              audio=voices.audio_meta())


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


@app.post("/api/call/{token}/next-block", response_model=models.AdaptiveResult)
def post_next_block(token: str, body: models.AdaptiveBody) -> dict:
    """Ask the decision model which assessment block should run next.

    The call page passes the blocks it has completed. The answer names its source: a Veri
    deployment, the deterministic heuristic, or the static script after a model miss.
    Safety and calibration blocks are not candidates and never appear here.
    """
    row = call_row(token, want_consent=False)
    from .agent import adaptive

    got = adaptive.decide(str(row["patient_id"]), session=dict(row), done=body.done)
    return {
        "next": got["next"],
        "probabilities": got["probabilities"],
        "source": got["source"],
        "reason": got["reason"],
        "scores": got["scores"],
        "minutes_saved": adaptive.free_minutes(got["state"] | {"next": got["next"]}),
        "ms": got["ms"],
    }


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
    # The same payload that feeds the console also feeds the time-series table. It is
    # buffered and written in batches, so this is not one insert per post.
    telemetry.observe(token, str(row["patient_id"]), body.quality, body.gaze, body.target,
                      body.pursuit_gain)
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
    frame_row = sessions.get(token)
    if frame_row is not None:
        telemetry.observe_frame(token, str(frame_row["patient_id"]),
                                len(body.frames), len(body.stim))
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
    telemetry.flush(token)
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


# ---------------------------------------------------------------- CREAO briefing agent

@app.post("/api/patients/{pid}/pipeline", response_model=models.AgentPipeline, status_code=202)
def start_pipeline(pid: str, request: Request) -> dict:
    """Start the CREAO care pipeline (triage, then briefing and outreach). Returns at once."""
    auth.require_patient(pid, request)
    row = db.patient(pid)
    if row is None:
        raise HTTPException(404, "no such patient")
    return creao.start(pid, int(row["week"] or 0))


@app.get("/api/patients/{pid}/pipeline", response_model=models.AgentPipeline | None)
def get_pipeline(pid: str, request: Request) -> dict | None:
    """The newest pipeline for this patient, advanced from CREAO if it is still going."""
    auth.require_patient(pid, request)
    if db.patient(pid) is None:
        raise HTTPException(404, "no such patient")
    return creao.latest(pid)


@app.post("/api/creao/callback")
async def creao_callback(request: Request, token: str = "") -> dict:
    """CREAO's webhook. Unsigned, so only the run id is read and the state is fetched fresh."""
    import hmac

    if not hmac.compare_digest(token, creao.token()):
        raise HTTPException(403, "bad token")
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    return {"ok": creao.on_callback(payload if isinstance(payload, dict) else {})}


@app.get("/api/creao/status")
def creao_status() -> dict:
    """Whether the CREAO agent is wired up. Never returns the key."""
    return creao.status()


@app.get("/api/summary/{pid}/{week}")
def get_summary(pid: str, week: int, request: Request) -> dict:
    """Both summaries for one week, the patient text and the clinician update."""
    auth.require_patient(pid, request)
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
