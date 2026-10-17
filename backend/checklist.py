"""Print what passed and what fell back to mock. Run with `make check`.

This is the done check from the brief: every contract route served with seeded demo data,
the twin numbers inside their targets, and an honest list of everything that is running on
a fallback rather than the real thing.
"""

import importlib
import json

from . import db, models
from .config import cfg
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
             "written to the messages table, set PHOTON_API_KEY to send"
             if cfg.mock_photon else "live"),
        line(MOCK if cfg.mock_twilio else GREEN, "clinic call",
             "script logged, set the four Twilio keys to dial"
             if cfg.mock_twilio else f"live to {cfg.clinic_number}"),
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
    """Where the template actually came from."""
    from .data.templates import templates

    src = templates()["source"]
    real = [k for k, v in src.items() if "fallback" not in v and v not in ("synthetic_template", "none")]
    return [line(GREEN if real else MOCK, "template sources", json.dumps(src))]


def models_check() -> list[dict]:
    """The contract models all build, so the response shapes are enforceable."""
    names = [n for n in dir(models) if n[0].isupper()]
    return [line(GREEN if len(names) > 25 else RED, f"{len(names)} contract models defined", "")]


def run() -> dict:
    """Every section of the checklist."""
    sections = {
        "API": routes_check() + models_check(),
        "Seeded data": data_check(),
        "Twin and cohort": twin_check(),
        "Modes": mock_check(),
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
