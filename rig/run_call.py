"""The whole call, end to end. Falls back to the mock session so a demo never dies.

  preflight -> place the call -> wait for an answer -> run the script -> hang up
  -> features -> update the twin -> alerts -> text the summary

Run: make rig      (or python rig/run_call.py [patient_id] [--week N] [--mock])
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import db, demo, rig_hub  # noqa: E402
from backend.config import cfg  # noqa: E402
from rig import audio, call, preflight  # noqa: E402

RETRIES = 3
ANSWER_WAIT_S = 45.0


def pick_patient(pid: str | None) -> str | None:
    """The patient to call: the one asked for, else the demo patient furthest along."""
    if pid:
        return pid if db.patient(pid) else None
    rows = db.patients()
    if not rows:
        return None
    rows = sorted(rows, key=lambda r: int(r["week"] or 0), reverse=True)
    return str(rows[0]["id"])


def gate() -> dict:
    """Run preflight and decide whether the real rig can be driven."""
    checks = preflight.run()
    blocking = ["Backend port", "Stimulus page", "OBS virtual camera",
                f"Audio out to FaceTime ({cfg.mic_device})",
                f"Audio in from FaceTime ({cfg.spk_device})",
                "Accessibility permission", "Screen Recording permission"]
    bad = [c for c in checks if not c["ok"] and c["name"] in blocking]
    return {"checks": checks, "ok": not bad, "blocking": [c["name"] for c in bad]}


def wait_for_answer(seconds: float = ANSWER_WAIT_S) -> bool:
    """Voice energy for two seconds means answered. Enter also means answered."""
    print(f"  waiting up to {seconds:.0f}s for an answer (or press Enter once they pick up)")
    import select

    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if audio.energy(audio.record(2.0)) > 0.01:
            print("  heard voice, starting")
            return True
        ready, _, _ = select.select([sys.stdin], [], [], 0.1)
        if ready:
            sys.stdin.readline()
            print("  operator says answered, starting")
            return True
    print("  nobody answered")
    return False


def live_call(pid: str, week: int) -> dict:
    """Place a real FaceTime call and run the script over it."""
    got = call.place(cfg.facetime_number)
    print(f"  place call: {got['detail']}")
    if got["manual"]:
        call.manual_prompt(cfg.facetime_number)
    elif not wait_for_answer():
        from backend import alerts

        alerts.missed(pid, week)
        return {"ok": False, "error": "no answer", "missed": True}

    hub = rig_hub.LiveHub(pid, week)
    out = run_with_hub(hub, pid, week)
    call.hang_up()
    return out


def run_with_hub(hub, pid: str, week: int) -> dict:
    """Drive the dialog with a hub, then store everything it produced."""
    from backend.agent import dialog, summary
    from backend.comms import notify as texter
    from backend.features import pipeline

    row = db.patient(pid)
    got = dialog.run(hub, pid, week)
    if got["red_flags"]:
        return {"ok": True, "red_flags": got["red_flags"], "week": week}

    res = got["pipeline"]
    cid = rig_hub.store_checkin(pid, week, got, res)
    upd = demo.assimilate(pid, week, pipeline.observables(res["values"]), res["channel"])
    texter.send(pid, "post_call", body=got["patient_note"])
    if upd["alerts"]:
        from backend.comms import clinic_call

        clinic_call.call(pid, summary.clinician_text(str(row["name"]), week, res))
    return {
        "ok": True, "week": week, "checkin_id": cid,
        "alerts": [a["type"] for a in upd["alerts"]],
        "drift_z": upd["diag"]["drift_z"],
        "features": len(res["features"]),
        "duration_s": got["duration_s"],
        "flash_ok": res["channel"]["flash_ok"],
        "eye_blocked": res["eye_blocked"],
    }


def main(argv: list[str]) -> int:
    """Preflight, call, measure, update, report."""
    force_mock = "--mock" in argv
    week = None
    if "--week" in argv:
        week = int(argv[argv.index("--week") + 1])
    pid = pick_patient(next((a for a in argv[1:] if not a.startswith("--") and not a.isdigit()), None))
    if pid is None:
        print("  no patients in the database. Run make seed first.")
        return 1
    row = db.patient(pid)
    week = int(row["week"] or 0) + 1 if week is None else week
    print("")
    print(f"  calling {row['name']} for week {week}")

    checks = gate()
    for c in checks["checks"]:
        print(f"  [{'GREEN' if c['ok'] else ' RED '}] {c['name']}")
    use_mock = force_mock or cfg.mock_rig or not checks["ok"]
    if use_mock and not force_mock and not cfg.mock_rig:
        print(f"  preflight blocks the real rig on: {', '.join(checks['blocking'])}")

    out: dict = {}
    if not use_mock:
        for attempt in range(1, RETRIES + 1):
            print(f"  live attempt {attempt} of {RETRIES}")
            try:
                out = live_call(pid, week)
            except Exception as exc:
                out = {"ok": False, "error": str(exc)}
            if out.get("ok"):
                break
            print(f"  attempt failed: {out.get('error')}")
        if not out.get("ok"):
            print("  falling back to the mock session so the rest of the loop still runs")
            use_mock = True

    if use_mock:
        truth = demo.truth_of(pid)
        if week not in truth:
            truth[week] = demo.extend_truth(pid, truth, week)
            demo.set_truth(pid, truth)
        hub = rig_hub.MockHub(pid, week, truth[week], poor=demo.profile_of(pid) == "low_quality")
        out = run_with_hub(hub, pid, week)
        out["mock"] = True

    print("")
    print("  call finished")
    for key in ("week", "checkin_id", "features", "duration_s", "flash_ok", "eye_blocked",
                "drift_z", "alerts", "red_flags", "mock", "error"):
        if key in out:
            val = out[key]
            print(f"    {key:12s} {round(val, 3) if isinstance(val, float) else val}")
    after = db.patient(pid)
    print(f"    twin         week {after['week']}, coverage {float(after['coverage'] or 0):.2f}, "
          f"drift z {float(after['drift_z'] or 0):.2f}")
    print(f"    alerts open  {len([a for a in db.alerts(pid) if not a['acked']])}")
    print("")
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
