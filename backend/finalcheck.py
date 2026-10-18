"""The v2 checklist: what is real, what is mocked, what was removed, what was merged.

`make check` answers "does this work". This answers "what am I looking at", which is the
question somebody watching the demo actually has. It reads the live system rather than a
list somebody typed: which receptor maps loaded, which transport is live, which routes
exist, what the extractor scores. A line that says a thing is real has gone and looked.
"""

import sys

from . import db
from .config import cfg

GREEN = "real"
MOCK = "mock"
GONE = "gone"
MERGED = "merged"

W = 78


def line(state: str, name: str, detail: str = "") -> dict:
    return {"state": state, "name": name, "detail": detail}


def real() -> list[dict]:
    """What is genuinely running, checked rather than asserted."""
    from .data import mesh as meshmod
    from .twin import intervention, population

    out = []

    got = meshmod.mesh()
    out.append(line(GREEN if got["source"] == "fsaverage6" else MOCK,
                    f"Cortical surface: {got['source']}, {got['verts']} vertices",
                    "real fsaverage6 with Schaefer-100 labels, checked name for name "
                    "against the connectome's own order"
                    if got["source"] == "fsaverage6" else "procedural stand-in"))

    rec = intervention.receptors()
    nreal = len(rec.get("tracers") or {})
    ntot = len(rec["names"])
    out.append(line(GREEN if nreal == ntot else MOCK,
                    f"Receptor maps: {nreal} of {ntot} from real PET and SPECT",
                    ", ".join(sorted(rec.get("tracers") or {}))
                    or "every map is a smooth random stand-in"))

    cohort = population.load()
    if cohort:
        cov = [c["cov"] for c in cohort.get("coverage") or []]
        out.append(line(GREEN, f"Population fit: {cohort['size']} patients",
                        f"band coverage {cov[-1]:.0%} against a target of 80%"
                        if cov else "fitted"))

    pats = db.patients()
    chk = db.rows("select count(*) as c from checkins")[0]["c"]
    out.append(line(GREEN, f"Seeded: {len(pats)} patients, {chk} check-ins",
                    ", ".join(str(p["name"]) for p in pats[:4]) + ("..." if len(pats) > 4 else "")))

    from .ingest import run as ingestrun

    files = ingestrun.sample_files()
    out.append(line(GREEN if files else MOCK,
                    f"Sample document pack: {len(files)} files",
                    "eight typeset PDFs and two scans, with an answer key"
                    if files else "not on disk, run make sample"))

    from .data import vessels as vesselmod

    out.append(line(GREEN, f"Vessel atlas: {len(vesselmod.VESSELS)} vessels",
                    vesselmod.CAPTION))

    from .data import drugs as drugmod

    book = drugmod.drugs()
    mapped = [d for d in book if drugmod.mapped_keys(d)]
    out.append(line(GREEN, f"Formulary: {len(book)} medicines, {len(mapped)} with a target map",
                    f"{len(book) - len(mapped)} say no map available rather than being "
                    "drawn from a receptor they do not act on"))

    out.append(line(GREEN, f"Pathways: {len(drugmod.pathways()['pathways'])} centrelines",
                    drugmod.pathways()["caption"]))

    from .calls import script as callscript

    out.append(line(GREEN,
                    f"Call script: {callscript.minutes(full=False)} min brief, "
                    f"{callscript.minutes(full=True)} min full",
                    f"the brief version does not run {len(callscript.BRIEF_MISSING)} tasks, "
                    "and says which"))

    out.append(line(GREEN if not cfg.mock_eleven else MOCK, "Voice lines",
                    "pre-generated mp3s, nothing is spoken live"
                    if not cfg.mock_eleven else "the page uses browser speech synthesis"))

    model = (cfg.gemini_key and not cfg.mock_llm)
    out.append(line(GREEN if model else MOCK, "Document extraction",
                    f"Gemini {cfg.gemini_model.removeprefix('gemini-')} with a strict "
                    "schema, falling back to the built-in extractor"
                    if model else "the built-in extractor, no key set"))

    return out


def mocked() -> list[dict]:
    """What is standing in for something, and what it would take to make it real."""
    from .comms import notify as texter

    out = []
    status = texter.status()
    out.append(line(GREEN if status.get("imessage") else MOCK, "iMessage",
                    "live" if status.get("imessage")
                    else "set PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET"))
    out.append(line(GREEN if not cfg.mock_twilio else MOCK, "SMS fallback",
                    f"live from {cfg.twilio_from}" if not cfg.mock_twilio
                    else "set the three Twilio keys"))
    out.append(line(MOCK if cfg.mock_rig else GREEN, "Demo mode",
                    "a call can run from a generated session with no phone, through the "
                    "same ingest and the same pipeline" if cfg.mock_rig
                    else "off, every call needs a real phone"))
    out.append(line(GREEN if cfg.public_url else MOCK, "Public URL",
                    cfg.public_url or "not set, so a phone cannot reach this machine. "
                                      "make tunnel"))
    out.append(line(MOCK, "Every patient", "synthetic, including the flagship. No real "
                                           "person's data is anywhere in this system."))
    return out


def removed() -> list[dict]:
    """What v2 deleted, and the one-line reason."""
    return [
        line(GONE, "The FaceTime rig, OBS, BlackHole, the stimulus page",
             "the web call on the patient's own phone does the same measurements"),
        line(GONE, "The /ui harness", "a backend test page served at a route a visitor "
                                      "could reach. /docs already does this honestly"),
        line(GONE, "R1 live console, R2 preflight, D1 demo console",
             "the live strip is in the call modal, preflight is make check and make phone"),
        line(GONE, "P1 consent mock, P2 phone mock, P4 gait and hearing",
             "the first two are real inside /call/:token; gait and hearing were never "
             "validated and showed numbers with no interval"),
        line(GONE, "The clinic outbound phone call, CLINIC_NUMBER, LIVE_CLINIC_CALL",
             "it rang a real person over and over. A rule that fires in batches must not "
             "be able to ring a phone in batches, and no switch makes that safe"),
        line(GONE, "LIVE_AGENT and the question and answer agent",
             "it sat beside the measurement path adding risk and no measurement"),
        line(GONE, "ElevenLabs speech to text",
             "faster_whisper runs locally and the patient's audio never leaves the machine"),
        line(GONE, "Fetch.ai, Maps, PLANNER, EXPLAIN, NOTIFY_ON_MATCH",
             "none were on the demo path. Keys for services the app never calls are a "
             "liability, not a feature. Gemini used to be on this list and no longer is: "
             "it is the model behind every phrased line and the document extraction"),
    ]


def merged() -> list[dict]:
    """What moved rather than went."""
    return [
        line(MERGED, "C2 overview", "the workspace's Analysis tab"),
        line(MERGED, "C3 twin viewer", "the centre of the workspace, where it never leaves"),
        line(MERGED, "C4 scenario compare", "the Treatment tab's difference mode"),
        line(MERGED, "C5 call log", "the Timeline tab"),
        line(MERGED, "C6 alerts", "the left rail, with the rule behind each flag one click away"),
        line(MERGED, "Cohort page", "the population percentile ribbon in Analysis"),
        line(MERGED, "Model validation numbers", "the Evidence drawer, read live"),
        line(MERGED, "The live gaze dot", "the strip in the call modal"),
    ]


def routes() -> list[dict]:
    """The five routes the app has, and nothing else."""
    from .app import app

    paths = {r.path for r in app.routes}
    want = ["/", "/clinic", "/patients/new", "/patients/{id}", "/call/{token}"]
    out = [line(GREEN, "Routes", ", ".join(want))]
    for gone in ("/ws/rig", "/ws/stimulus", "/api/rig/preflight", "/api/consent/{token}",
                 "/api/stretch/{token}", "/api/alerts/{aid}/call"):
        out.append(line(GONE if gone not in paths else MOCK, f"  {gone}",
                        "removed" if gone not in paths else "STILL REGISTERED"))
    return out


def show(title: str, rows: list[dict]) -> None:
    print(f"  {title}")
    for row in rows:
        print(f"    [{row['state']:6s}] {row['name']}")
        if row["detail"]:
            words, out = row["detail"].split(), "             "
            for word in words:
                if len(out) + len(word) > W:
                    print(out)
                    out = "             "
                out += word + " "
            print(out.rstrip())
    print("")


def main() -> int:
    """Print the checklist. Always returns 0: this describes, it does not gate."""
    db.conn()
    print("")
    print("  Synapshot: what you are looking at")
    print("  " + "=" * W)
    print("")
    show("Real", real())
    show("Standing in", mocked())
    show("Removed in v2", removed())
    show("Merged into the workspace", merged())
    show("The app's routes", routes())
    print("  " + "=" * W)
    print("  Research prototype. Not a medical device. Every patient is synthetic.")
    print("  Claims and their sources: docs/RESEARCH.md. Decisions: DECISIONS.md.")
    print("")
    return 0


if __name__ == "__main__":
    sys.exit(main())
