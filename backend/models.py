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
    """How the head was hit.

    The first six fields drive the strain model. The rest are read off the documents and
    shown in the Data tab: they are what the chart said, not what the model used, and the
    provenance endpoint says which file each one came from.
    """

    mechanism: str
    helmet: str
    angle_deg: float
    location: str
    date: str
    loc: bool
    loc_seconds: float | None = None
    gcs: int | None = None
    days_ago: int | None = None
    contusion: str | None = None
    ct_finding: str | None = None
    mri_finding: str | None = None
    swi_foci: int | None = None


class Alleles(BaseModel):
    """The three genotype calls kept from the VCF.

    `apoe` and `bdnf` are the genotype as the report wrote it, so the Data tab can show
    "e3/e4" rather than "1". DNA changes the recovery rate and nothing else: it never
    changes brain shape.
    """

    apoe_e4: Literal[0, 1, 2]
    bdnf_met: bool
    apoe: str | None = None
    bdnf: str | None = None
    comt: Literal["Val/Val", "Val/Met", "Met/Met"]


class Biomarkers(BaseModel):
    """Blood marker z scores, and the measured values behind them where there are any.

    The z is what the twin consumes. The pg/mL is what the lab reported, carried through
    so the Data tab shows the number the clinician recognises next to the one the model
    used, and so the conversion between them can be checked rather than trusted. NfL has
    no z: there is no reference to standardise it against here, so it is shown and not
    modelled.
    """

    gfap_z: float
    uchl1_z: float
    gfap_pg_ml: float | None = None
    uchl1_pg_ml: float | None = None
    nfl_pg_ml: float | None = None


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


class ChartMed(BaseModel):
    """One medication as the chart wrote it. The dose is never interpreted."""

    name: str
    dose: str = ""
    status: str = "unknown"


class Chart(BaseModel):
    """Clinical facts read off the documents that the model does not consume."""

    occupation: str | None = None
    medications: list[ChartMed] = Field(default_factory=list)
    reported_symptoms: list[str] = Field(default_factory=list)


class Patient(BaseModel):
    """Everything the frontend shows about one patient."""

    id: str
    name: str
    age: int
    sex: Literal["F", "M"]
    week: int
    injury: Injury
    chart: Chart = Field(default_factory=lambda: Chart())
    inputs: list[InputFile]
    alleles: Alleles
    biomarkers: Biomarkers
    fc_fit: float | None
    coverage: float
    drift_z: float = 0.0
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

    space: Literal["fsaverage6", "procedural"]
    source: Literal["fsaverage6", "procedural"]
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


class DrugPick(BaseModel):
    """One drug selected in the viewer. The dose is never sent, because it is never used."""

    name: str
    gain: float | None = None


class InterventionBody(BaseModel):
    """Body of POST /api/patients/{id}/intervention.

    Two shapes through one route. `target` is the single receptor slider: one map, one
    gain. `drugs` is the formulary viewer: each drug's targets are combined into one
    weight per region first. When both are given, `drugs` wins, because it is the one a
    clinician chose by name.
    """

    target: str = ""
    gain: float = 0.2
    drugs: list[DrugPick] = Field(default_factory=list)


class DrugTarget(BaseModel):
    """One receptor a drug acts at, and in which direction."""

    receptor: str
    affinity: float
    direction: int
    proxy: bool = False
    why: str = ""


class DrugEntry(BaseModel):
    """One drug in the formulary, modelled or not."""

    name: str
    cls: str = Field(default="", alias="class")
    typical_dose: str = ""
    modeled: bool
    targets: list[DrugTarget] = Field(default_factory=list)
    note: str = ""
    why_not: str = ""
    proxy_targets: list[str] = Field(default_factory=list)
    stand_in_targets: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class Formulary(BaseModel):
    """GET /api/formulary. The drug list and what the maps behind it actually are."""

    drugs: list[DrugEntry]
    receptors: list[str]
    tracers: dict[str, str] = Field(default_factory=dict)
    stand_in: list[str] = Field(default_factory=list)
    synthetic_template: bool = False
    banner: str
    note: str


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
    """One tract and its attribution score.

    `a` and `b` are the region indices the tract joins, so the Analysis tab can click a
    tract and move the brain to one of its ends.
    """

    name: str
    score: float
    a: int | None = None
    b: int | None = None


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
    """Response of GET /api/health."""

    ok: bool = True
    mode: Literal["mock", "live"] = Field(default="mock")


# ---------------------------------------------------------------- the web call

class CallBody(BaseModel):
    """Body of POST /api/calls."""

    patient_id: str | None = None
    send: bool = False
    week: int | None = None


class CallStart(BaseModel):
    """Response of POST /api/calls. The url is what the patient opens.

    Everything after `channel` is about what happened to the text, and it is all here
    because the modal has to be able to explain itself. `status` is sent, delivered,
    failed or mock; `message_id` is what the delivery poll asks about; `why` and `error`
    are the real reason; `tried` is each transport that was attempted and how it failed.
    """

    token: str
    url: str
    expires: str
    sent: bool = False
    channel: str | None = None
    status: str | None = None
    message_id: str | None = None
    why: str | None = None
    error: str | None = None
    tried: list[dict] = Field(default_factory=list)


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
    full: bool = False
    minutes: float = 0.0
    skipped: list[str] = Field(default_factory=list)


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
