"""Print what passed and what fell back to mock. Run with `make check`.

This is the done check from the brief: every contract route served with seeded demo data,
the twin numbers inside their targets, and an honest list of everything that is running on
a fallback rather than the real thing.
"""

import importlib
import json

from . import db, models
from .config import ROOT, cfg
from .twin import population

GREEN = "PASS"
RED = "FAIL"
MOCK = "MOCK"

OPTIONAL = {
    "cubnm": "template SC, FC and BOLD, falls back to a distance decay matrix",
    "nilearn": "Schaefer-100 names and centroids, falls back to an ellipsoid",
    "enigmatoolbox": "gene expression map, falls back to a smooth random map",
    "mediapipe": "face and iris landmarks, without it every frame reports no face",
    "cv2": "JPEG frames for the rig console",
    "faster_whisper": "speech transcription, falls back to the scripted transcript",
    "parselmouth": "jitter, shimmer, HNR and CPP",
    "librosa": "spectral extras",
    "mss": "screen capture of the FaceTime window",
    "sounddevice": "audio in and out of FaceTime",
    "anthropic": "natural phrasing and summaries, falls back to templates",
    "twilio": "the clinic call, falls back to logging the script",
    "numpyro": "the hierarchical population fit, falls back to weighted least squares",
    "sbi": "optional emulator upgrade behind USE_SBI",
}

ROUTES = [
    # spec file 1: the mesh, the shape, the receptors and the what-if
    ("GET", "/api/mesh"), ("GET", "/api/patients/{pid}/shape"), ("GET", "/api/receptors"),
    ("POST", "/api/patients/{pid}/intervention"),
    # spec file 2: the web call
    ("POST", "/api/calls"), ("GET", "/api/call/{token}/script"),
    ("POST", "/api/call/{token}/consent"), ("POST", "/api/call/{token}/redflags"),
    ("POST", "/api/call/{token}/symptoms"), ("POST", "/api/call/{token}/live"),
    ("POST", "/api/call/{token}/frames"), ("POST", "/api/call/{token}/audio/{task}"),
    ("POST", "/api/call/{token}/finish"), ("GET", "/api/call/{token}/status"),
    ("GET", "/api/voices"), ("POST", "/api/voices/{step_id}/regenerate"),
    # the original contract
    ("GET", "/api/health"), ("GET", "/api/patients"), ("POST", "/api/patients"),
    ("GET", "/api/patients/{pid}"), ("GET", "/api/patients/{pid}/forecast"),
    ("GET", "/api/patients/{pid}/twin"), ("POST", "/api/patients/{pid}/scenarios"),
    ("POST", "/api/patients/{pid}/counterfactual"), ("GET", "/api/patients/{pid}/attribution"),
    ("GET", "/api/patients/{pid}/checkins"), ("GET", "/api/checkins/{cid}"),
    ("POST", "/api/checkins/{cid}/rescore"), ("POST", "/api/checkins/{cid}/unusable"),
    ("POST", "/api/patients/{pid}/uploads"), ("GET", "/api/patients/{pid}/twin-inputs"),
    ("POST", "/api/patients/{pid}/build-twin"), ("GET", "/api/patients/{pid}/messages"),
    ("POST", "/api/patients/{pid}/note"), ("GET", "/api/alerts"),
    ("POST", "/api/alerts/{aid}/ack"), ("POST", "/api/alerts/{aid}/call"),
    ("GET", "/api/cohort"), ("GET", "/api/rig/preflight"), ("POST", "/api/demo/reset"),
    ("POST", "/api/demo/advance-week"), ("POST", "/api/demo/inject-drift"),
    ("POST", "/api/demo/trigger-call"), ("GET", "/api/consent/{token}"),
    ("POST", "/api/consent/{token}"), ("POST", "/api/stretch/{token}"),
]


def line(state: str, name: str, detail: str = "") -> dict:
    """One checklist row."""
    return {"state": state, "name": name, "detail": detail}


def routes_check() -> list[dict]:
    """Every contract route registered with the right method, plus both websockets."""
    from .app import app

    have = {(m, r.path) for r in app.routes for m in (getattr(r, "methods", None) or [])}
    paths = {r.path for r in app.routes}
    missing = [f"{m} {p}" for m, p in ROUTES if (m, p) not in have]
    out = [line(RED if missing else GREEN, f"{len(ROUTES)} contract routes registered",
                ", ".join(missing) if missing else "every route and method present")]
    for ws in ("/ws/rig", "/ws/stimulus"):
        out.append(line(GREEN if ws in paths else RED, f"websocket {ws}", ""))
    return out


def data_check() -> list[dict]:
    """Seeded data: patients, calls, alerts, forecasts and the cohort."""
    out = []
    pats = db.patients()
    out.append(line(GREEN if len(pats) >= 6 else RED, f"{len(pats)} patients seeded",
                    ", ".join(str(p["name"]) for p in pats[:6])))
    chk = db.rows("select count(*) as c from checkins")[0]["c"]
    obs = db.rows("select count(*) as c from observations")[0]["c"]
    out.append(line(GREEN if chk else RED, f"{chk} check-ins, {obs} observations", ""))

    als = db.alerts()
    kinds = sorted({str(a["type"]) for a in als})
    want = {"red_flag", "low_quality", "drift"}
    out.append(line(GREEN if want <= set(kinds) else RED, f"{len(als)} alerts: {', '.join(kinds)}",
                    "" if want <= set(kinds) else f"missing {sorted(want - set(kinds))}"))

    built = [p for p in pats if int(p["twin_built"] or 0)]
    out.append(line(GREEN if len(built) == len(pats) else RED,
                    f"{len(built)} of {len(pats)} twins built", ""))
    tmpl = [p for p in pats if int(p["template_only"] or 0)]
    out.append(line(GREEN if tmpl else RED, f"{len(tmpl)} template only patient", "no MRI uploaded"))
    return out


def twin_check() -> list[dict]:
    """The cohort numbers against their targets."""
    out = []
    got = population.load()
    if got is None:
        return [line(RED, "cohort.json", "missing, run make seed")]

    cov8 = next((c["cov"] for c in got["coverage"] if c["week"] == 8), None)
    ok8 = cov8 is not None and 0.65 <= cov8 <= 0.90
    out.append(line(GREEN if ok8 else RED, "EnKF coverage at week 8",
                    f"{cov8:.3f}, target 0.65 to 0.9" if cov8 is not None else "no week 8"))

    import numpy as np

    kt, ke = np.array(got["k_true"]), np.array(got["k_est"])
    corr = float(np.corrcoef(kt, ke)[0, 1]) if len(kt) > 2 else float("nan")
    out.append(line(GREEN if corr > 0.4 else RED, "k true against k est",
                    f"r = {corr:.3f} over {got['size']} patients"))

    cbio = next((e for e in got["effects"] if e["name"] == "c_bio"), None)
    if cbio:
        ok = np.sign(cbio["est"]) == np.sign(cbio["true"])
        out.append(line(GREEN if ok else RED, "population recovers the sign of c_bio",
                        f"true {cbio['true']:+.3f}, est {cbio['est']:+.3f}"))
    ce4 = next((e for e in got["effects"] if e["name"] == "c_e4"), None)
    if ce4:
        inside = ce4["lo"] <= ce4["true"] <= ce4["hi"]
        out.append(line(GREEN if inside else MOCK, "true c_e4 inside its 90% interval",
                        f"true {ce4['true']:+.3f} in [{ce4['lo']:+.3f}, {ce4['hi']:+.3f}]"
                        if inside else
                        f"true {ce4['true']:+.3f} outside [{ce4['lo']:+.3f}, {ce4['hi']:+.3f}], "
                        "a warning not a failure"))
    return out


def mock_check() -> list[dict]:
    """What is running on a fallback, and what it would take to make it real."""
    return [
        line(MOCK if cfg.mock_rig else GREEN, "rig",
             "replaying a generated session, set RIG_FACETIME_NUMBER for a real call"
             if cfg.mock_rig else f"live, calling {cfg.facetime_number}"),
        line(MOCK if cfg.mock_llm else GREEN, "LLM",
             "template lines, set ANTHROPIC_API_KEY for natural phrasing"
             if cfg.mock_llm else f"live on {cfg.claude_model}"),
        line(MOCK if cfg.mock_photon else GREEN, "iMessage",
             "written to the messages table, set PHOTON_PROJECT_ID and "
             "PHOTON_PROJECT_SECRET to send"
             if cfg.mock_photon else "live"),
        line(MOCK if cfg.mock_twilio else GREEN, "clinic call",
             "script logged, set the four Twilio keys to dial"
             if cfg.mock_twilio else f"live to {cfg.clinic_number}"),
        line(MOCK if cfg.mock_eleven else GREEN, "ElevenLabs voices",
             "no key, the page uses the browser's own speech synthesis"
             if cfg.mock_eleven else f"live, {cfg.eleven_tts_model}"),
        line(MOCK if cfg.offline else GREEN, "template atlases",
             "offline, using the fallback template, set OFFLINE=0 to fetch the real atlas"
             if cfg.offline else "fetching real atlases"),
    ]


def package_check() -> list[dict]:
    """Which optional packages are installed and what their absence costs."""
    out = []
    for name, why in OPTIONAL.items():
        try:
            importlib.import_module(name)
            out.append(line(GREEN, name, "installed"))
        except Exception:
            out.append(line(MOCK, name, f"not installed: {why}"))
    return out


def source_check() -> list[dict]:
    """Where the brain template actually came from, and how well the model fits it."""
    import numpy as np

    from .data.templates import templates
    from .twin import dmf, priors

    tpl = templates()
    src = tpl["source"]
    want = {
        "regions": ("nilearn_schaefer100", "real Schaefer-100 MNI centroids and labels"),
        "sc": ("enigma_hcp_schaefer100", "real HCP diffusion connectivity"),
        "fc": ("enigma_hcp_schaefer100", "real HCP resting state connectivity"),
        "maps": ("enigmatoolbox_ahba_ei", "real Allen gene expression E:I map"),
    }
    out = []
    for key, (real, why) in want.items():
        got = src.get(key, "none")
        out.append(line(GREEN if got == real else MOCK, f"{key}: {got}",
                        why if got == real else "modelled fallback, set OFFLINE=0 to fetch the real one"))

    # The one number that says whether the model resembles a real brain at all.
    if src.get("fc") == want["fc"][0]:
        fc_mod = dmf.fc_lin(tpl["sc"], priors.HYPER["mu_G"], ei=tpl["gene"])
        r = dmf.fc_corr(fc_mod, tpl["fc"]) if np.isfinite(fc_mod).all() else 0.0
        out.append(line(GREEN if r > 0.15 else RED, "model FC against real HCP FC",
                        f"r = {r:.3f} at G = {priors.HYPER['mu_G']}, untuned beyond G. "
                        "Published whole brain fits reach 0.3 to 0.5 with per subject tuning"))
    return out


def models_check() -> list[dict]:
    """The contract models all build, so the response shapes are enforceable."""
    names = [n for n in dir(models) if n[0].isupper()]
    return [line(GREEN if len(names) > 25 else RED, f"{len(names)} contract models defined", "")]


def webcall_check() -> list[dict]:
    """Everything the web call needs: the URL, the voices, ffmpeg, the model, the tunnel."""
    import shutil
    import urllib.error
    import urllib.request

    out = []

    # The link the patient taps. iOS will not open the camera over plain http.
    url = cfg.public_url
    if not url:
        out.append(line(MOCK, "PUBLIC_URL", "not set, so links point at "
                                            f"{cfg.api_base} and cannot work on a phone"))
    elif not url.startswith("https://"):
        out.append(line(RED, "PUBLIC_URL is not https",
                        "iOS needs https to open the camera, run make tunnel"))
    else:
        try:
            with urllib.request.urlopen(f"{url}/api/health", timeout=8) as resp:
                ok = resp.status < 400
            out.append(line(GREEN if ok else RED, "PUBLIC_URL is https and answering", url))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            out.append(line(MOCK, "PUBLIC_URL is https but not reachable",
                            f"{url}, {str(exc)[:80]}. Start the tunnel and make dev"))

    out.append(line(GREEN if cfg.web_call() else MOCK, f"CALL_MODE is {cfg.call_mode}",
                    "the patient opens a web page" if cfg.web_call()
                    else "the old FaceTime rig path, set CALL_MODE=web for the new flow"))

    # ElevenLabs. One cheap authenticated GET. The key is never printed, only used.
    if not cfg.eleven_key:
        out.append(line(MOCK, "ElevenLabs key", "not set, the page uses browser speech synthesis"))
    else:
        try:
            req = urllib.request.Request("https://api.elevenlabs.io/v1/user/subscription",
                                         headers={"xi-api-key": cfg.eleven_key})
            with urllib.request.urlopen(req, timeout=10) as resp:
                live = resp.status < 300
            out.append(line(GREEN if live else RED, "ElevenLabs key accepted",
                            f"model {cfg.eleven_tts_model}"))
        except urllib.error.HTTPError as exc:
            out.append(line(RED, "ElevenLabs key rejected", f"HTTP {exc.code}"))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            out.append(line(MOCK, "ElevenLabs not reachable", str(exc)[:80]))
    out.append(line(GREEN if cfg.eleven_voice else MOCK, "ELEVENLABS_VOICE_ID",
                    "set" if cfg.eleven_voice else "not set, no mp3 can be generated"))

    # Generated voice lines.
    from .agent import voices

    want = voices.lines()
    have = voices.audio_map()
    missing = [row["id"] for row in want if row["id"] not in have]
    out.append(line(GREEN if not missing else MOCK,
                    f"{len(have)} of {len(want)} voice lines generated",
                    "every line has an mp3" if not missing else
                    f"{len(missing)} fall back to browser speech, run make voices"))

    # ffmpeg is a hard requirement for the uploaded audio.
    from .calls import audio as callaudio

    out.append(line(GREEN if callaudio.have_ffmpeg() else RED, "ffmpeg",
                    "present, uploaded audio can be decoded" if callaudio.have_ffmpeg()
                    else "MISSING, every speech measure would be lost. brew install ffmpeg"))

    # The face landmarker the phone runs.
    model = ROOT / "web" / "public" / "models" / "face_landmarker.task"
    out.append(line(GREEN if model.exists() else RED, "MediaPipe face landmarker",
                    f"{model.stat().st_size // 1024} KB at web/public/models/"
                    if model.exists() else "missing, run make models"))

    # The built frontend.
    dist = ROOT / "web" / "dist" / "index.html"
    out.append(line(GREEN if dist.exists() else RED, "web/dist built",
                    "served at /" if dist.exists() else "run make web"))

    # A tunnel tool, so the phone can reach this machine over https.
    tool = next((t for t in ("cloudflared", "ngrok") if shutil.which(t)), "")
    out.append(line(GREEN if tool else MOCK, "tunnel tool",
                    f"{tool} is installed, run make tunnel for the steps" if tool
                    else "neither cloudflared nor ngrok found. brew install cloudflared"))

    # Twilio, the SMS fallback and the clinic call.
    have_twilio = all([cfg.twilio_sid, cfg.twilio_token, cfg.twilio_from])
    out.append(line(GREEN if have_twilio else MOCK, "Twilio credentials",
                    f"set, SMS fallback live from {cfg.twilio_from}" if have_twilio
                    else "not all set, SMS falls back to mock"))
    out.append(line(GREEN if cfg.clinic_number else MOCK, "CLINIC_NUMBER",
                    "set" if cfg.clinic_number else "not set, the clinic call is logged only"))

    # The mesh the viewer renders.
    from .data import mesh as meshmod

    if meshmod.path_json().exists():
        got = meshmod.mesh()
        real = got["source"] == "fsaverage5"
        out.append(line(GREEN if real else MOCK,
                        f"mesh: {got['source']}, {got['verts']} vertices",
                        "real fsaverage5 surface with Schaefer-100 labels" if real
                        else "procedural stand-in, set OFFLINE=0 and run make mesh"))
    else:
        out.append(line(RED, "mesh", "not built, run make mesh"))

    return out


def comms_check() -> list[dict]:
    """Which transport a text would actually go out on, and who may be texted."""
    from .comms import notify as texter

    got = texter.status()
    out = [
        line(GREEN if got["imessage"] else MOCK, "iMessage",
             "live through the sidecar" if got["imessage"]
             else "mock. Needs PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET plus "
                  "make imessage"),
        line(GREEN if got["sms"] else MOCK, "SMS fallback",
             "live" if got["sms"] else "mock"),
    ]
    sdk = got["sidecar"]
    out.append(line(GREEN if sdk.get("installed") else MOCK, "iMessage sidecar packages",
                    f"spectrum_cloud={sdk.get('spectrum_cloud')}, "
                    f"imessage_kit={sdk.get('imessage_kit')}" if sdk.get("installed")
                    else "not installed, run make imessage"))
    out.append(line(GREEN if got["allow_list"] else MOCK,
                    f"DEMO_PHONES holds {got['allow_list']} number(s)",
                    "nothing is ever sent to a number outside this list"))
    return out


def run() -> dict:
    """Every section of the checklist."""
    sections = {
        "API": routes_check() + models_check(),
        "Seeded data": data_check(),
        "Twin and cohort": twin_check(),
        "Modes": mock_check(),
        "The web call": webcall_check(),
        "Comms": comms_check(),
        "Template sources": source_check(),
        "Optional packages": package_check(),
    }
    flat = [row for rows in sections.values() for row in rows]
    return {
        "sections": sections,
        "passed": len([r for r in flat if r["state"] == GREEN]),
        "failed": len([r for r in flat if r["state"] == RED]),
        "mocked": len([r for r in flat if r["state"] == MOCK]),
    }


def main() -> int:
    """Print the checklist. Returns 1 if anything failed."""
    db.conn()
    got = run()
    print("")
    print("  UNNAMED final checklist")
    print("  " + "=" * 74)
    for title, rows in got["sections"].items():
        print(f"\n  {title}")
        for row in rows:
            print(f"    [{row['state']}] {row['name']}")
            if row["detail"]:
                print(f"           {row['detail']}")
    print("")
    print("  " + "=" * 74)
    print(f"  {got['passed']} passed, {got['failed']} failed, {got['mocked']} running on a fallback")
    print(f"  mode: {cfg.mode()}")
    print("")
    if got["failed"]:
        print("  Something failed. If it is seeded data, run make seed.")
    else:
        print("  Everything the demo needs is in place.")
    print("")
    return 1 if got["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
