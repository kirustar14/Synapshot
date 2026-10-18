"""Pydantic models that mirror the API contract exactly. Field names are frozen."""

from typing import Literal

from pydantic import BaseModel, Field

Flag = Literal["red_flag", "missed_call", "low_quality", "drift"]
Kind = Literal["t1", "dwi", "fmri", "vcf", "labs", "injury"]
Group = Literal["eyes", "speech", "memory", "symptoms"]
Tier = Literal["A", "B"]


class PatientRow(BaseModel):
    """One row of the clinician patient list."""

    id: str
    name: str
    week: int
    drift_z: float
    last_call: str | None
    flags: list[Flag]
    synthetic: bool


class InputFile(BaseModel):
    """One uploaded or synthetic input file and what it changes in the twin."""

    kind: Kind
    file: str
    synthetic: bool
    status: Literal["ok", "warn", "error", "missing"]
    sets: str
    note: str | None = None


class Alert(BaseModel):
    """A clinician facing alert."""

    id: str
    patient_id: str
    type: Flag
    trigger: str
    time: str
    called: bool
    acked: bool


class Injury(BaseModel):
    """How the head was hit."""

    mechanism: str
    helmet: str
    angle_deg: float
    location: str
    date: str
    loc: bool


class Alleles(BaseModel):
    """The three genotype calls kept from the VCF."""

    apoe_e4: Literal[0, 1, 2]
    bdnf_met: bool
    comt: Literal["Val/Val", "Val/Met", "Met/Met"]


class Biomarkers(BaseModel):
    """Blood marker z scores."""

    gfap_z: float
    uchl1_z: float


class Contraction(BaseModel):
    """Posterior contraction per parameter."""

    k: float


class Params(BaseModel):
    """Current point estimates of the twin parameters."""

    G: float
    k: float
    p: float
    eps: float


class Feature(BaseModel):
    """One measured feature from one call."""

    name: str
    tier: Tier
    value: float
    prev: float | None
    mdc: float
    unit: str
    changed: bool


class Channel(BaseModel):
    """Call quality of the video and audio channel."""

    fps: float
    calib_err_deg: float
    face_share: float
    flash_ok: bool


class GazeTrace(BaseModel):
    """Gaze and target over one eye task."""

    task: str
    t: list[float]
    x: list[float]
    y: list[float]
    tx: list[float]
    ty: list[float]


class Trace(BaseModel):
    """One time series trace."""

    t: list[float]
    v: list[float]


class Traces(BaseModel):
    """Exploratory blink and expression traces."""

    blink: Trace
    smile: Trace
    brow: Trace


class Line(BaseModel):
    """One line of the call transcript."""

    who: Literal["agent", "patient"]
    text: str
    t: float


class Checkin(BaseModel):
    """One weekly call."""

    id: str
    patient_id: str
    week: int
    date: str
    duration_s: float
    steps: list[str]
    channel: Channel
    features: list[Feature]
    gaze: list[GazeTrace]
    traces: Traces | None = None
    transcript: list[Line]
    unusable: bool


class Patient(BaseModel):
    """Everything the frontend shows about one patient."""

    id: str
    name: str
    age: int
    sex: Literal["F", "M"]
    week: int
    injury: Injury
    inputs: list[InputFile]
    alleles: Alleles
    biomarkers: Biomarkers
    fc_fit: float | None
    coverage: float
    contraction: Contraction
    params: Params
    alerts: list[Alert]
    last_call: Checkin | None
    twin_built: bool
    template_only: bool
    low_fidelity: bool


class ObsPoint(BaseModel):
    """One observed value on a signal."""

    week: int
    value: float
    sem: float


class Signal(BaseModel):
    """One forecast signal with its band and its observations."""

    key: str
    label: str
    unit: str
    group: Group
    tier: Tier
    mean: list[float]
    lo: list[float]
    hi: list[float]
    obs: list[ObsPoint]


class CoveragePoint(BaseModel):
    """One-step-ahead band coverage at one week."""

    week: int
    cov: float


class Forecast(BaseModel):
    """Twelve week forecast across every signal."""

    weeks: list[int]
    signals: list[Signal]
    coverage: list[CoveragePoint]


class Region(BaseModel):
    """One brain region in the twin view."""

    id: int
    name: str
    hemi: Literal["L", "R"]
    x: float
    y: float
    z: float
    ei: float
    template_ei: float
    damage: list[float]
    activity: list[float]
    damage_lo: list[float]
    damage_hi: list[float]
    recovery: float
    network: str


class Edge(BaseModel):
    """One tract in the twin view."""

    a: int
    b: int
    damage: list[float]
    template_w: float
    personal_w: float


class TopTract(BaseModel):
    """A tract worth naming in the summary."""

    name: str
    damage_w0: float
    damage_now: float


class Twin(BaseModel):
    """The whole brain twin over weeks."""

    weeks: list[int]
    regions: list[Region]
    edges: list[Edge]
    top_tracts: list[TopTract]


class Mesh(BaseModel):
    """The cortical surface the viewer renders. Flat arrays, millimetres, origin centred."""

    space: Literal["fsaverage5", "procedural"]
    source: Literal["fsaverage5", "procedural"]
    verts: int
    pial: list[float]
    inflated: list[float]
    faces: list[int]
    labels: list[int]
    border: list[int]
    region_names: list[str]
    networks: list[str]
    lobes: list[str]
    region_xyz: list[float]


class Impact(BaseModel):
    """Where the head was hit, on the surface, and how the swelling settles."""

    vertex: int
    point: list[float]
    radius: float
    amp: list[float]


class Shape(BaseModel):
    """Per person visual deformation of the template mesh. Illustrative, not a segmentation."""

    scale: list[float]
    atrophy: float
    thick_z: list[float]
    impact: Impact
    template_diff: list[float]
    source: Literal["synthetic", "freesurfer"]
    mesh_source: str
    age: int
    sex: str
    severity: float
    note: str


class Receptors(BaseModel):
    """Group average receptor and transporter maps, z scored over the 100 regions."""

    names: list[str]
    maps: dict[str, list[float]]
    synthetic_template: bool
    note: str


class SummaryDelta(BaseModel):
    """What the perturbation did to the three network summaries."""

    fc_strength: float
    rate: float
    metastability: float


class Intervention(BaseModel):
    """A clinician only receptor weighted gain what-if. Never a recommendation."""

    target: str
    gain: float
    region_effect: list[float]
    summary_delta: SummaryDelta
    baseline: SummaryDelta
    receptor: list[float]
    synthetic_template: bool
    note: str


class InterventionBody(BaseModel):
    """Body of POST /api/patients/{id}/intervention."""

    target: str
    gain: float = 0.0


class Loadings(BaseModel):
    """Signal to region loadings behind REGIONAL_LOADINGS. Always a design assumption."""

    signals: list[str]
    weights: dict[str, list[float]]
    note: str


class Scenario(BaseModel):
    """A what-if impact configuration."""

    helmet: str
    angle_deg: float


class DiffRow(BaseModel):
    """One parameter difference between two scenarios."""

    param: str
    a: str
    b: str


class ScenarioResult(BaseModel):
    """Two scenario forecasts side by side."""

    a: Forecast
    b: Forecast
    diff: list[DiffRow]


class Message(BaseModel):
    """One message in or out, with the transport that actually carried it.

    `channel` is never guessed. An SMS says sms even though it lands in the same app.
    """

    dir: Literal["out", "in"]
    body: str
    time: str
    channel: Literal["imessage", "sms", "mock"] = "mock"
    kind: str | None = None


class Check(BaseModel):
    """One preflight check."""

    name: str
    ok: bool
    detail: str


class Effect(BaseModel):
    """One population level effect, truth against estimate."""

    name: str
    true: float
    est: float
    lo: float
    hi: float


class Cohort(BaseModel):
    """Population layer results across the synthetic cohort."""

    weeks: list[int]
    coverage: list[CoveragePoint]
    k_true: list[float]
    k_est: list[float]
    effects: list[Effect]
    size: int


class TractScore(BaseModel):
    """One tract and its attribution score."""

    name: str
    score: float


class Attribution(BaseModel):
    """Which tracts drive one signal. Always a hypothesis."""

    signal: str
    tracts: list[TractScore]
    note: str


class Quality(BaseModel):
    """Live quality flags on the rig stream."""

    face: bool
    dist: bool
    light: bool
    fps: float


class RigLine(BaseModel):
    """The line being spoken right now."""

    who: Literal["agent", "patient"]
    text: str


class Point(BaseModel):
    """A normalized screen point."""

    x: float
    y: float


class RigEvent(BaseModel):
    """One frame of the live rig stream."""

    type: Literal["frame"] = "frame"
    gaze: Point
    target: Point
    quality: Quality
    pursuit_gain: float | None
    step: str
    line: RigLine | None
    frame: str | None = None


class NewPatient(BaseModel):
    """Body of POST /api/patients."""

    name: str
    age: int
    sex: Literal["F", "M"]
    synthetic: bool = True


class ScenarioBody(BaseModel):
    """Body of POST /api/patients/{id}/scenarios."""

    a: Scenario
    b: Scenario


class CounterfactualBody(BaseModel):
    """Body of POST /api/patients/{id}/counterfactual."""

    k_mult: float = 1.0
    p_add: float = 0.0


class NoteBody(BaseModel):
    """Body of POST /api/patients/{id}/note."""

    text: str


class RescoreBody(BaseModel):
    """Body of POST /api/checkins/{cid}/rescore."""

    task: str


class ConsentBody(BaseModel):
    """Body of POST /api/consent/{token}."""

    calls: bool = False
    ai: bool = False
    recording: bool = False
    genetic: bool = False


class ConsentText(BaseModel):
    """What the consent page shows."""

    patient_name: str
    text: list[str]


class Gait(BaseModel):
    """Gait numbers from the texted web page."""

    cadence: float
    variability: float
    steps: int


class Hearing(BaseModel):
    """Hearing thresholds from the texted web page."""

    thresholds: dict[str, float]


class StretchBody(BaseModel):
    """Body of POST /api/stretch/{token}."""

    gait: Gait | None = None
    hearing: Hearing | None = None


class DemoBody(BaseModel):
    """Body of the demo endpoints."""

    patient_id: str | None = None
    size: float = 1.0


class UploadBody(BaseModel):
    """JSON body of the synthetic upload shortcut."""

    synthetic: bool = True


class TwinInputs(BaseModel):
    """Response of GET /api/patients/{id}/twin-inputs."""

    inputs: list[InputFile]
    fc_fit: float | None
    low_fidelity: bool


class Health(BaseModel):
    """Response of GET /api/health.

    `db`, `tiger` and `auth` are additions. The two original fields keep their exact
    names and values, so an old client is unaffected.
    """

    ok: bool = True
    mode: Literal["mock", "live"] = Field(default="mock")
    db: Literal["sqlite", "postgres"] = "sqlite"
    tiger: bool = False
    auth: bool = True


# ---------------------------------------------------------------- the web call

class CallBody(BaseModel):
    """Body of POST /api/calls."""

    patient_id: str | None = None
    send: bool = False
    week: int | None = None


class CallStart(BaseModel):
    """Response of POST /api/calls. The url is what the patient opens."""

    token: str
    url: str
    expires: str
    sent: bool = False
    channel: str | None = None


class ScriptStep(BaseModel):
    """One screen of the call."""

    id: str
    say: str
    audio: str | None = None
    task: str
    minutes: float
    tier: Literal["A", "B", "safety", "gate", "none"]
    block: Literal["A", "B"] | None = None
    params: dict = Field(default_factory=dict)


class CallScript(BaseModel):
    """Everything the page needs to run the whole check-in."""

    consent: list[str]
    steps: list[ScriptStep]
    voice_base: str
    symptom_items: list[str]
    redflag_items: list[str]
    words: list[str]
    passage: str
    picture: Literal["kitchen"]
    fluency_seconds: int
    clinic_number: str = ""


class RedflagBody(BaseModel):
    """Body of POST /api/call/{token}/redflags."""

    answers: dict[str, bool] = Field(default_factory=dict)


class RedflagResult(BaseModel):
    """What the backend decided about the safety screen. The page never decides."""

    stop: bool
    say: str
    audio: str | None = None


class SymptomBody(BaseModel):
    """Body of POST /api/call/{token}/symptoms."""

    scores: dict[str, float] = Field(default_factory=dict)
    phase: Literal["baseline", "rerate"] = "baseline"


class SymptomResult(BaseModel):
    """Whether to shorten the call and which steps to skip."""

    jump: bool
    short: bool
    skip: list[str] = Field(default_factory=list)


class AnswerBody(BaseModel):
    """Body of POST /api/call/{token}/answer. One non-symptom answer from the page."""

    task: Literal["npc_cm", "recall_immediate", "recall_delayed", "fluency"]
    value: float | list[str]


class LiveBody(BaseModel):
    """Body of POST /api/call/{token}/live, posted about every 200 ms."""

    t: float = 0.0
    gaze: Point = Point(x=0.5, y=0.5)
    target: Point = Point(x=0.5, y=0.5)
    quality: Quality = Quality(face=False, dist=False, light=False, fps=0.0)
    pursuit_gain: float | None = None
    step: str = ""
    line: RigLine | None = None


class FinishBody(BaseModel):
    """Body of POST /api/call/{token}/finish."""

    aborted: bool = False


class CallStatus(BaseModel):
    """Response of GET /api/call/{token}/status."""

    state: Literal["waiting", "in_call", "stopped", "processing", "done", "failed"]
    call_id: str | None = None
    summary: str | None = None
    error: str | None = None


class InboundBody(BaseModel):
    """Body of POST /api/messages/inbound. A reply from the patient."""

    patient_id: str | None = None
    body: str = ""
    channel: Literal["imessage", "sms", "mock"] | None = None


class MidweekBody(BaseModel):
    """Body of POST /api/comms/midweek."""

    days: int = 3


class AgentTranscript(BaseModel):
    """One line said to the optional question and answer agent. Never scored."""

    who: Literal["agent", "patient"] = "patient"
    text: str = ""
    t: float = 0.0


class VoiceLine(BaseModel):
    """One generated line for the demo console voices panel."""

    id: str
    text: str
    hash: str
    file: str
    exists: bool
    duration_s: float | None = None
    stale: bool = False
    error: str | None = None


class Voices(BaseModel):
    """Response of GET /api/voices."""

    base: str
    live: bool
    model: str
    lines: list[VoiceLine]
    note: str


# ---------------------------------------------------------------- team and decisions

class LoginBody(BaseModel):
    """Body of POST /api/auth/login."""

    email: str
    password: str


class ClinicianOut(BaseModel):
    """A clinician as the API returns them. Never the password hash."""

    id: str
    email: str
    name: str
    role: Literal["doctor", "nurse", "admin"]
    clinic_id: str
    clinic_name: str
    last_login: str | None = None


class AssignmentBody(BaseModel):
    """Body of POST /api/assignments."""

    patient_id: str
    clinician_id: str
    role: Literal["primary", "covering", "consult"] = "covering"


class AdaptiveBody(BaseModel):
    """Body of POST /api/call/{token}/next-block."""

    done: list[str] = Field(default_factory=list)


class AdaptiveResult(BaseModel):
    """One adaptive decision. `source` is never guessed."""

    next: Literal["ocular", "speech", "memory", "symptoms", "stop"]
    probabilities: dict = Field(default_factory=dict)
    source: Literal["veri", "heuristic", "script"]
    reason: str
    scores: dict = Field(default_factory=dict)
    minutes_saved: float = 0.0
    ms: float = 0.0
