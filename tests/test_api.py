"""Contract test: every endpoint returns every field the frontend contract names.

The field sets below are transcribed from the TypeScript at the bottom of the brief. If
one of these ever fails, the frontend breaks, so they are written out literally rather
than derived from the pydantic models, which could drift together with the code.
"""

import pytest

PATIENT_ROW = {"id", "name", "week", "drift_z", "last_call", "flags", "synthetic"}
INPUT_FILE = {"kind", "file", "synthetic", "status", "sets"}
ALERT = {"id", "patient_id", "type", "trigger", "time", "called", "acked"}
PATIENT = {
    "id", "name", "age", "sex", "week", "injury", "inputs", "alleles", "biomarkers",
    "fc_fit", "coverage", "contraction", "params", "alerts", "last_call", "twin_built",
    "template_only", "low_fidelity",
}
INJURY = {"mechanism", "helmet", "angle_deg", "location", "date", "loc"}
ALLELES = {"apoe_e4", "bdnf_met", "comt"}
BIOMARKERS = {"gfap_z", "uchl1_z"}
PARAMS = {"G", "k", "p", "eps"}
SIGNAL = {"key", "label", "unit", "group", "tier", "mean", "lo", "hi", "obs"}
OBS_POINT = {"week", "value", "sem"}
FORECAST = {"weeks", "signals", "coverage"}
COVERAGE = {"week", "cov"}
TWIN = {"weeks", "regions", "edges", "top_tracts"}
REGION = {"id", "name", "hemi", "x", "y", "z", "ei", "template_ei", "damage", "activity"}
EDGE = {"a", "b", "damage", "template_w", "personal_w"}
TOP_TRACT = {"name", "damage_w0", "damage_now"}
FEATURE = {"name", "tier", "value", "prev", "mdc", "unit", "changed"}
CHECKIN = {
    "id", "patient_id", "week", "date", "duration_s", "steps", "channel", "features",
    "gaze", "transcript", "unusable",
}
CHANNEL = {"fps", "calib_err_deg", "face_share", "flash_ok"}
GAZE = {"task", "t", "x", "y", "tx", "ty"}
TRACE = {"t", "v"}
LINE = {"who", "text", "t"}
SCENARIO_RESULT = {"a", "b", "diff"}
DIFF = {"param", "a", "b"}
MESSAGE = {"dir", "body", "time"}
CHECK = {"name", "ok", "detail"}
COHORT = {"weeks", "coverage", "k_true", "k_est", "effects", "size"}
EFFECT = {"name", "true", "est", "lo", "hi"}
ATTRIBUTION = {"signal", "tracts", "note"}
TRACT_SCORE = {"name", "score"}
CONSENT_TEXT = {"patient_name", "text"}
RIG_EVENT = {"type", "gaze", "target", "quality", "pursuit_gain", "step", "line"}
QUALITY = {"face", "dist", "light", "fps"}


def has(obj: dict, fields: set, where: str) -> None:
    """Every named field is present, with no typos in either direction."""
    missing = fields - set(obj)
    assert not missing, f"{where} is missing {sorted(missing)}"


@pytest.fixture(scope="module")
def pid(client):
    """A patient with a full history: calls, alerts, messages, a built twin."""
    rows = client.get("/api/patients").json()
    best = max(rows, key=lambda r: r["week"])
    return best["id"]


def test_health(client):
    """GET /api/health reports ok and the mode."""
    got = client.get("/api/health").json()
    assert got["ok"] is True
    assert got["mode"] in ("mock", "live")


def test_patients_list(client):
    """GET /api/patients returns PatientRow objects."""
    rows = client.get("/api/patients").json()
    assert len(rows) >= 6, "the demo seeds six patients"
    for row in rows:
        has(row, PATIENT_ROW, "PatientRow")
        assert isinstance(row["flags"], list)
        assert all(f in ("red_flag", "missed_call", "low_quality", "drift") for f in row["flags"])
        assert isinstance(row["synthetic"], bool)
        assert row["last_call"] is None or isinstance(row["last_call"], str)


def test_patient_detail(client, pid):
    """GET /api/patients/{id} returns a full Patient, nested objects included."""
    got = client.get(f"/api/patients/{pid}").json()
    has(got, PATIENT, "Patient")
    has(got["injury"], INJURY, "Patient.injury")
    has(got["alleles"], ALLELES, "Patient.alleles")
    has(got["biomarkers"], BIOMARKERS, "Patient.biomarkers")
    has(got["contraction"], {"k"}, "Patient.contraction")
    has(got["params"], PARAMS, "Patient.params")
    assert got["sex"] in ("F", "M")
    assert got["alleles"]["apoe_e4"] in (0, 1, 2)
    assert got["alleles"]["comt"] in ("Val/Val", "Val/Met", "Met/Met")
    assert got["fc_fit"] is None or 0.0 <= got["fc_fit"] <= 1.0
    for row in got["inputs"]:
        has(row, INPUT_FILE, "Patient.inputs[]")
        assert row["status"] in ("ok", "warn", "error", "missing")
        assert row["kind"] in ("t1", "dwi", "fmri", "vcf", "labs", "injury")
    for row in got["alerts"]:
        has(row, ALERT, "Patient.alerts[]")
    if got["last_call"] is not None:
        has(got["last_call"], CHECKIN, "Patient.last_call")


def test_patient_404(client):
    """An unknown patient is a 404, not a 500."""
    assert client.get("/api/patients/pat_nope").status_code == 404


def test_create_patient(client):
    """POST /api/patients returns a Patient with a built twin."""
    got = client.post("/api/patients", json={"name": "Test Case", "age": 22, "sex": "F",
                                             "synthetic": True}).json()
    has(got, PATIENT, "created Patient")
    assert got["name"] == "Test Case" and got["age"] == 22 and got["sex"] == "F"
    assert got["twin_built"] is True


def check_forecast(got: dict) -> None:
    """A Forecast has weeks, every Signal, and the coverage history."""
    has(got, FORECAST, "Forecast")
    assert got["weeks"][0] == 0 and len(got["weeks"]) == 13
    keys = set()
    for sig in got["signals"]:
        has(sig, SIGNAL, "Signal")
        keys.add(sig["key"])
        assert sig["group"] in ("eyes", "speech", "memory", "symptoms")
        assert sig["tier"] in ("A", "B")
        assert len(sig["mean"]) == len(sig["lo"]) == len(sig["hi"]) == len(got["weeks"])
        assert all(lo <= m <= hi for lo, m, hi in zip(sig["lo"], sig["mean"], sig["hi"]))
        for point in sig["obs"]:
            has(point, OBS_POINT, "Signal.obs[]")
    assert keys == {"pursuit_gain", "antisaccade_err", "saccade_latency", "speech_rate",
                    "recall_delayed", "symptom_total"}
    for point in got["coverage"]:
        has(point, COVERAGE, "Forecast.coverage[]")


def test_forecast(client, pid):
    """GET /api/patients/{id}/forecast returns a complete Forecast."""
    check_forecast(client.get(f"/api/patients/{pid}/forecast").json())


def test_twin(client, pid):
    """GET /api/patients/{id}/twin returns regions, edges and top tracts."""
    got = client.get(f"/api/patients/{pid}/twin").json()
    has(got, TWIN, "Twin")
    assert len(got["regions"]) == 100
    weeks = len(got["weeks"])
    for reg in got["regions"]:
        has(reg, REGION, "Twin.regions[]")
        assert reg["hemi"] in ("L", "R")
        assert len(reg["damage"]) == weeks and len(reg["activity"]) == weeks
    assert got["edges"], "there should be edges to draw"
    for edge in got["edges"]:
        has(edge, EDGE, "Twin.edges[]")
        assert len(edge["damage"]) == weeks
        assert edge["personal_w"] <= edge["template_w"] + 1e-9
    assert len(got["top_tracts"]) == 3
    for tract in got["top_tracts"]:
        has(tract, TOP_TRACT, "Twin.top_tracts[]")
        assert tract["damage_now"] <= tract["damage_w0"] + 1e-9


def test_scenarios(client, pid):
    """POST /api/patients/{id}/scenarios returns two forecasts and the diff."""
    got = client.post(f"/api/patients/{pid}/scenarios",
                      json={"a": {"helmet": "A", "angle_deg": 10},
                            "b": {"helmet": "B", "angle_deg": 70}}).json()
    has(got, SCENARIO_RESULT, "ScenarioResult")
    check_forecast(got["a"])
    check_forecast(got["b"])
    assert got["diff"], "the diff should say what changed"
    for row in got["diff"]:
        has(row, DIFF, "ScenarioResult.diff[]")


def test_counterfactual(client, pid):
    """POST /api/patients/{id}/counterfactual returns a Forecast, and faster k helps."""
    base = client.get(f"/api/patients/{pid}/forecast").json()
    got = client.post(f"/api/patients/{pid}/counterfactual",
                      json={"k_mult": 2.0, "p_add": -0.05}).json()
    check_forecast(got)
    key = "symptom_total"
    a = next(s for s in base["signals"] if s["key"] == key)["mean"][-1]
    b = next(s for s in got["signals"] if s["key"] == key)["mean"][-1]
    assert b <= a + 1e-9, "doubling the recovery rate should not leave more symptoms"


def test_attribution(client, pid):
    """GET /api/patients/{id}/attribution returns tracts per signal, always a hypothesis."""
    rows = client.get(f"/api/patients/{pid}/attribution").json()
    assert rows, "there should be one entry per signal"
    for row in rows:
        has(row, ATTRIBUTION, "Attribution")
        assert "hypothesis" in row["note"], "the note must always say hypothesis"
        assert len(row["tracts"]) <= 3
        for tract in row["tracts"]:
            has(tract, TRACT_SCORE, "Attribution.tracts[]")


def test_checkins_list_has_no_gaze(client, pid):
    """GET /api/patients/{id}/checkins returns Checkins without the gaze arrays."""
    rows = client.get(f"/api/patients/{pid}/checkins").json()
    assert rows, "the patient should have check-ins"
    for row in rows:
        has(row, CHECKIN, "Checkin")
        assert row["gaze"] == [], "the list endpoint must not carry gaze arrays"
        has(row["channel"], CHANNEL, "Checkin.channel")
        for feat in row["features"]:
            has(feat, FEATURE, "Feature")
        for line in row["transcript"]:
            has(line, LINE, "Checkin.transcript[]")
            assert line["who"] in ("agent", "patient")


def test_checkin_detail_has_gaze(client, pid):
    """GET /api/checkins/{cid} returns the full Checkin with traces."""
    rows = client.get(f"/api/patients/{pid}/checkins").json()
    got = client.get(f"/api/checkins/{rows[-1]['id']}").json()
    has(got, CHECKIN, "Checkin")
    assert got["gaze"], "the detail endpoint must carry gaze arrays"
    for trace in got["gaze"]:
        has(trace, GAZE, "Checkin.gaze[]")
        assert len(trace["t"]) == len(trace["x"]) == len(trace["y"]) == len(trace["tx"])
    if got.get("traces"):
        for key in ("blink", "smile", "brow"):
            has(got["traces"][key], TRACE, f"Checkin.traces.{key}")


def test_rescore_and_unusable(client, pid):
    """Rescore recomputes a task, and unusable drops the week from the twin."""
    rows = client.get(f"/api/patients/{pid}/checkins").json()
    usable = [r for r in rows if not r["unusable"] and r["channel"]["face_share"] >= 0.7]
    cid = usable[-1]["id"]
    got = client.post(f"/api/checkins/{cid}/rescore", json={"task": "pursuit_h"})
    assert got.status_code == 200, got.text
    assert "pursuit_gain" in got.json()["values"]
    assert client.post(f"/api/checkins/{cid}/rescore", json={"task": "saccade"}).status_code == 400

    week = usable[-1]["week"]
    assert client.post(f"/api/checkins/{cid}/unusable").json()["unusable"] is True
    after = client.get(f"/api/patients/{pid}/forecast").json()
    weeks_with_obs = {p["week"] for s in after["signals"] for p in s["obs"]}
    assert week not in weeks_with_obs, "an unusable week must leave the forecast"


def test_uploads_and_twin_inputs(client, pid):
    """The synthetic upload shortcut returns InputFiles and twin-inputs agrees."""
    rows = client.post(f"/api/patients/{pid}/uploads", json={"synthetic": True}).json()
    assert len(rows) == 6
    for row in rows:
        has(row, INPUT_FILE, "InputFile")
        assert row["status"] in ("ok", "warn", "error", "missing")
        assert row["sets"], "every input must say what it changes"
    got = client.get(f"/api/patients/{pid}/twin-inputs").json()
    assert set(got) == {"inputs", "fc_fit", "low_fidelity"}
    assert len(got["inputs"]) == 6
    assert isinstance(got["low_fidelity"], bool)


def test_upload_a_real_file(client, pid):
    """A real multipart upload is validated and recorded."""
    body = b"##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\ts\n"
    got = client.post(f"/api/patients/{pid}/uploads",
                      data={"kind": "vcf"},
                      files={"file": ("tiny.vcf", body, "text/plain")})
    assert got.status_code == 200, got.text
    rows = got.json()
    vcf = next(r for r in rows if r["kind"] == "vcf")
    assert vcf["synthetic"] is False
    assert vcf["status"] in ("warn", "error")


def test_build_twin(client, pid):
    """POST /api/patients/{id}/build-twin returns the rebuilt Patient."""
    got = client.post(f"/api/patients/{pid}/build-twin").json()
    has(got, PATIENT, "Patient after build-twin")
    assert got["twin_built"] is True


def test_messages_and_note(client, pid):
    """Messages come back in the contract shape and a note is accepted."""
    for msg in client.get(f"/api/patients/{pid}/messages").json():
        has(msg, MESSAGE, "Message")
        assert msg["dir"] in ("out", "in")
    assert client.post(f"/api/patients/{pid}/note", json={"text": "Watching the eye block."}).json()["ok"]


def test_alerts(client, pid):
    """Alerts list, filter, ack and call all work."""
    rows = client.get("/api/alerts").json()
    assert rows, "the demo seeds alerts"
    for row in rows:
        has(row, ALERT, "Alert")
        assert row["type"] in ("red_flag", "missed_call", "low_quality", "drift")
    mine = client.get("/api/alerts", params={"patient_id": rows[0]["patient_id"]}).json()
    assert all(a["patient_id"] == rows[0]["patient_id"] for a in mine)

    aid = rows[0]["id"]
    assert client.post(f"/api/alerts/{aid}/ack").json()["acked"] is True
    assert client.post("/api/alerts/al_nope/ack").status_code == 404

    # A flag has to be able to say why it fired, with the threshold and where this
    # patient sits against it, so the left rail is never a coloured dot and a claim.
    why = client.get(f"/api/alerts/{aid}/explain").json()
    assert why["ok"] is True and why["type"] == rows[0]["type"]
    assert why["rule"] and why["detail"]
    assert "threshold" in why and "week" in why["state"]
    assert client.get("/api/alerts/al_nope/explain").status_code == 404
    # Nothing in the alert path dials anybody. The route that did is gone.
    assert client.post(f"/api/alerts/{aid}/call").status_code == 405
    del pid


def test_cohort(client):
    """GET /api/cohort returns the population layer results."""
    got = client.get("/api/cohort").json()
    has(got, COHORT, "Cohort")
    assert got["size"] >= 50
    assert len(got["k_true"]) == len(got["k_est"]) == got["size"]
    for point in got["coverage"]:
        has(point, COVERAGE, "Cohort.coverage[]")
    for row in got["effects"]:
        has(row, EFFECT, "Cohort.effects[]")
        assert row["lo"] <= row["hi"]


def test_demo_controls(client):
    """Reset, advance a week, inject drift and trigger a call."""
    rows = client.get("/api/patients").json()
    pid = min(rows, key=lambda r: r["week"])["id"]
    before = client.get(f"/api/patients/{pid}").json()["week"]

    got = client.post("/api/demo/advance-week", json={"patient_id": pid}).json()
    assert got["week"] == before + 1
    assert client.get(f"/api/patients/{pid}").json()["week"] == before + 1

    assert client.post("/api/demo/inject-drift", json={"patient_id": pid, "size": 1.5}).json()["ok"]
    assert client.post("/api/demo/trigger-call", json={"patient_id": pid}).json()["ok"]
    assert client.post("/api/demo/advance-week", json={"patient_id": "pat_nope"}).status_code == 404


def test_the_event_stream_carries_frames_and_alerts(pid):
    """The SSE hub delivers per patient events and keeps a short catch-up history."""
    import asyncio

    from backend import live

    # The hub keeps a short history so a browser joining mid-call catches up, and the
    # seed has already pushed alerts for this patient. Start from a clean slate.
    live.RECENT.pop(pid, None)

    async def drive():
        queue = live.subscribe(pid)
        other = live.subscribe("pat_someone_else")
        live.frame(pid, "pursuit_h", {"x": 0.52, "y": 0.49}, {"x": 0.55, "y": 0.5},
                   {"face": True, "dist": True, "light": True, "fps": 30.0},
                   0.78, {"who": "agent", "text": "follow the dot"})
        got = await asyncio.wait_for(queue.get(), timeout=2)
        assert other.empty(), "one patient's frames must not reach another patient's stream"
        return got

    got = asyncio.run(drive())
    assert got["kind"] == "frame" and got["step"] == "pursuit_h"
    has(got["gaze"], {"x", "y"}, "frame.gaze")
    has(got["target"], {"x", "y"}, "frame.target")
    has(got["quality"], QUALITY, "frame.quality")
    assert got["pursuit_gain"] == 0.78
    # The wire format is real SSE, named by kind, so EventSource can route on it.
    wire = live.sse(got)
    assert wire.startswith("event: frame\ndata: {") and wire.endswith("\n\n")


def test_the_event_stream_route_is_text_event_stream(client, pid):
    """GET /api/patients/{pid}/stream is an SSE endpoint, and 404s for a stranger.

    The response body never ends, so the route is called directly and the generator is
    read with a timeout rather than being consumed through the test client, which would
    sit there waiting for a stream that is designed to stay open.
    """
    import asyncio

    from backend import app as appmod
    from backend import live

    from starlette.requests import Request

    request = Request({"type": "http", "headers": []})
    resp = asyncio.run(appmod.get_stream(pid, request))
    assert resp.media_type == "text/event-stream"
    assert "no-cache" in resp.headers.get("cache-control", "")
    assert resp.headers.get("x-accel-buffering") == "no"

    live.RECENT.pop(pid, None)

    async def first_two():
        live.publish(pid, "frame_test", {"n": 1})
        gen = live.stream(pid)
        try:
            return [await asyncio.wait_for(gen.__anext__(), timeout=2) for _ in range(2)]
        finally:
            await gen.aclose()

    got = asyncio.run(first_two())
    assert got[0].startswith("event: hello")
    # The catch-up history means a browser that connects mid-call is not left blank.
    assert got[1].startswith("event: frame_test")

    assert client.get("/api/patients/pat_nope/stream").status_code == 404


def test_every_contract_route_exists(client):
    """Every route named in the contract is registered, with the right method."""
    from backend.app import app

    paths = {(r.path, tuple(sorted(getattr(r, "methods", []) or []))) for r in app.routes}
    flat = {p for p, _ in paths}
    want = [
        ("/api/health", "GET"), ("/api/patients", "GET"), ("/api/patients", "POST"),
        ("/api/patients/{pid}", "GET"), ("/api/patients/{pid}/forecast", "GET"),
        ("/api/patients/{pid}/twin", "GET"), ("/api/patients/{pid}/scenarios", "POST"),
        ("/api/patients/{pid}/counterfactual", "POST"),
        ("/api/patients/{pid}/attribution", "GET"), ("/api/patients/{pid}/checkins", "GET"),
        ("/api/checkins/{cid}", "GET"), ("/api/checkins/{cid}/rescore", "POST"),
        ("/api/checkins/{cid}/unusable", "POST"), ("/api/patients/{pid}/uploads", "POST"),
        ("/api/patients/{pid}/twin-inputs", "GET"), ("/api/patients/{pid}/build-twin", "POST"),
        ("/api/patients/{pid}/messages", "GET"), ("/api/patients/{pid}/note", "POST"),
        ("/api/alerts", "GET"), ("/api/alerts/{aid}/ack", "POST"),
        ("/api/alerts/{aid}/explain", "GET"),
        ("/api/cohort", "GET"), ("/api/demo/reset", "POST"),
        ("/api/demo/advance-week", "POST"), ("/api/demo/inject-drift", "POST"),
        ("/api/demo/trigger-call", "POST"), ("/api/patients/{pid}/stream", "GET"),
    ]
    for path, method in want:
        assert path in flat, f"{path} is not registered"
        assert any(p == path and method in m for p, m in paths), f"{path} has no {method}"


def test_the_removed_surfaces_are_really_gone(client):
    """Every route behind a surface the brief removed answers 404, not 500.

    These are listed by hand rather than derived, because the point is that somebody
    deleting a page cannot leave its backend half wired and still see green.
    """
    from backend.app import app

    flat = {r.path for r in app.routes}
    for path in ("/ws/rig", "/ws/stimulus", "/api/rig/preflight", "/api/consent/{token}",
                 "/api/stretch/{token}", "/api/alerts/{aid}/call",
                 "/api/call/{token}/agent", "/api/call/{token}/agent/transcript"):
        assert path not in flat, f"{path} should have been removed"
    # The /ui harness and the /stimulus pages are not mounted either.
    for mounted in ("/ui", "/stimulus"):
        assert not any(r.path.startswith(mounted) for r in app.routes), mounted
    # And the single page app does not quietly serve them as client side routes.
    assert client.get("/api/rig/preflight").status_code == 404
