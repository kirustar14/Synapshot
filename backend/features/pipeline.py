"""Turn one recorded session into the Feature list, the channel and the gaze traces.

A session is a plain dict so the mock rig and a real capture are the same thing here:
  frames  list of frame records from face.py, each with a monotonic t_ns
  stim    stimulus log, each entry {t_ns, kind, params}, written by the stimulus page
  calib   the nine calibration dots, {t_ns, sx, sy}
  flashes test flash times in session seconds
  trials  {"saccade": [{side, t_f}], "antisaccade": [{side, t_f}]}
  audio   {"wave", "sr"} and optional per task waves in audio_tasks
  answers spoken answers the agent collected: symptoms, recalls, fluency, npc
"""

import numpy as np

from ..config import cfg
from . import antisaccade, blink, fixation, flash, gaze as gz, fluency, memory, pursuit, quality, sem as semmod, speech

# Everything that can come out of a session, with its tier and unit.
SPEC = {
    "pursuit_gain": ("A", "ratio"),
    "pursuit_rms": ("A", "% screen"),
    "pursuit_gain_v": ("A", "ratio"),
    "saccade_latency": ("B", "ms"),
    "antisaccade_err": ("B", "%"),
    "antisaccade_latency": ("B", "ms"),
    "bcea": ("A", "deg^2"),
    "intrusions": ("A", "count"),
    "blink_rate": ("A", "per min"),
    "blink_dur": ("A", "ms"),
    "speech_rate": ("A", "syll/s"),
    "ptk_rate": ("A", "syll/s"),
    "ah_duration": ("A", "s"),
    "jitter": ("A", "%"),
    "shimmer": ("A", "%"),
    "hnr": ("A", "dB"),
    "cpp": ("A", "dB"),
    "rapid_naming": ("A", "s/card"),
    "recall_immediate": ("A", "of 15"),
    "recall_delayed": ("A", "of 15"),
    "fluency_animals": ("A", "count"),
    "symptom_total": ("A", "0 to 80"),
    "npc_cm": ("A", "cm"),
    "smile_mean": ("A", "0 to 1"),
    "brow_mean": ("A", "0 to 1"),
}
EYE_KEYS = ["pursuit_gain", "pursuit_rms", "pursuit_gain_v", "saccade_latency",
            "antisaccade_err", "antisaccade_latency", "bcea", "intrusions"]
SYMPTOMS = ["headache", "pressure", "neck_pain", "nausea", "dizziness", "blurred_vision", "light_sensitivity", "fatigue"]


def windows(stim: list[dict]) -> list[dict]:
    """Task windows from the stimulus log: each show runs until the next one."""
    shows = [s for s in stim or [] if s.get("kind")]
    out = []
    for i, s in enumerate(shows):
        end = shows[i + 1]["t_ns"] if i + 1 < len(shows) else None
        out.append({"kind": s["kind"], "t0_ns": int(s["t_ns"]), "t1_ns": end, "params": s.get("params", {})})
    return out


def in_window(frames: list[dict], win: dict) -> list[dict]:
    """Frames inside one task window."""
    t1 = win["t1_ns"]
    return [f for f in frames if f["t_ns"] >= win["t0_ns"] and (t1 is None or f["t_ns"] < t1)]


def trace_of(frames: list[dict], beta, win: dict) -> dict:
    """Calibrated gaze trace for one window, with the target it was tracking."""
    got = in_window(frames, win)
    trace = gz.apply(beta, got)
    params = win.get("params") or {}
    amp = float(params.get("amp", 0.35))
    freq = float(params.get("freq", 0.4))
    t = np.asarray(trace["t"], dtype=float)
    if win["kind"] == "pursuit_h":
        tx, ty = pursuit.target(t, amp, freq), np.full_like(t, 0.5)
    elif win["kind"] == "pursuit_v":
        tx, ty = np.full_like(t, 0.5), pursuit.target(t, amp, freq)
    else:
        tx = np.asarray(params.get("tx", np.full_like(t, 0.5)), dtype=float)
        ty = np.asarray(params.get("ty", np.full_like(t, 0.5)), dtype=float)
        if tx.shape != t.shape:
            tx, ty = np.full_like(t, 0.5), np.full_like(t, 0.5)
    return {"task": win["kind"], "t": t, "x": trace["x"], "y": trace["y"], "tx": tx, "ty": ty,
            "calibrated": bool(trace.get("calibrated", False))}


def eye_values(session: dict, beta, flash_ok: bool) -> tuple[dict, list[dict]]:
    """Every eye measure plus the traces the frontend draws."""
    frames = session.get("frames") or []
    vals: dict = {}
    traces = []
    for win in windows(session.get("stim") or []):
        if win["kind"] not in ("pursuit_h", "pursuit_v", "saccade", "antisaccade", "fixation"):
            continue
        tr = trace_of(frames, beta, win)
        if len(tr["t"]) < 10:
            continue
        traces.append(tr)
        if win["kind"] == "pursuit_h":
            got = pursuit.measure(tr["t"], tr["x"], tr["t"], tr["tx"])
            vals["pursuit_gain"] = got["gain"]
            vals["pursuit_rms"] = got["rms"] * 100.0
        elif win["kind"] == "pursuit_v":
            got = pursuit.measure(tr["t"], tr["y"], tr["t"], tr["ty"])
            vals["pursuit_gain_v"] = got["gain"]
        elif win["kind"] == "saccade" and flash_ok:
            from . import saccade as sac

            jumps = (session.get("trials") or {}).get("saccade") or []
            got = sac.trials(tr, jumps, [j.get("t_f") for j in jumps])
            if got["saccade_latency"] is not None:
                vals["saccade_latency"] = got["saccade_latency"]
        elif win["kind"] == "antisaccade":
            if not cfg.reach:
                continue
            shown = (session.get("trials") or {}).get("antisaccade") or []
            got = antisaccade.trials(tr, shown, [j.get("t_f") for j in shown])
            if got["antisaccade_err"] is not None:
                vals["antisaccade_err"] = got["antisaccade_err"]
            if flash_ok and got["antisaccade_latency"] is not None:
                vals["antisaccade_latency"] = got["antisaccade_latency"]
        elif win["kind"] == "fixation":
            got = fixation.measure(tr)
            vals["bcea"] = got["bcea"]
            vals["intrusions"] = float(got["intrusions"])
    return vals, traces


def answer_values(session: dict) -> dict:
    """Measures that come from what the patient said, not from the video."""
    ans = session.get("answers") or {}
    out = {}
    sym = ans.get("symptoms") or {}
    if sym:
        out["symptom_total"] = float(sum(float(sym.get(k, 0)) for k in SYMPTOMS))
    if ans.get("recall_immediate") is not None:
        out["recall_immediate"] = memory.immediate(ans["recall_immediate"])
    if ans.get("recall_delayed") is not None:
        out["recall_delayed"] = memory.delayed(ans["recall_delayed"])
    if ans.get("fluency") is not None:
        out["fluency_animals"] = fluency.score(ans["fluency"])["fluency_animals"]
    if ans.get("npc_cm") is not None:
        out["npc_cm"] = float(ans["npc_cm"])
    return out


def run(session: dict, prev: dict | None = None, age: int = 30, sex: str = "M", baseline: dict | None = None) -> dict:
    """Features, channel, gaze traces and the observable values for one call."""
    frames = session.get("frames") or []
    t, lum = flash.lum_of(frames)
    block = flash.test_block(t, lum, session.get("flashes") or [])
    cal = gz.fit(frames, session.get("calib") or [])

    vals, traces = eye_values(session, cal["beta"], block["flash_ok"])
    vals.update(answer_values(session))
    sp = speech.measure(session, age=age, sex=sex, baseline=baseline)
    for key in ("speech_rate", "ptk_rate", "ah_duration", "jitter", "shimmer", "hnr", "cpp", "rapid_naming"):
        if sp.get(key) is not None:
            vals[key] = float(sp[key])

    bl = blink.detect(np.array([f["t_ns"] for f in frames if f.get("face")], dtype=float) / 1e9,
                      np.array([f.get("ear", 0.3) for f in frames if f.get("face")], dtype=float))
    vals["blink_rate"] = bl["blink_rate"]
    vals["blink_dur"] = bl["blink_dur"]
    smile = blink.expression(frames, "mouthSmileLeft") if cfg.reach else {"t": [], "v": []}
    brow = blink.expression(frames, "browInnerUp") if cfg.reach else {"t": [], "v": []}
    if smile["v"]:
        vals["smile_mean"] = float(np.mean(smile["v"]))
    if brow["v"]:
        vals["brow_mean"] = float(np.mean(brow["v"]))

    gates = quality.gates(frames, block["found"], cal["err_deg"])
    chan = quality.channel(frames, block["flash_ok"], cal["err_deg"])

    # A failed quality gate blocks the eye tasks. Reporting a gaze number measured
    # through a dark or uncalibrated channel would be worse than reporting nothing.
    blocked = not gates["eye_tasks_ok"]
    if blocked:
        for key in EYE_KEYS:
            vals.pop(key, None)

    return {
        "eye_blocked": blocked,
        "features": feature_list(vals, prev, block["flash_ok"]),
        "channel": chan,
        "gaze": [pack_trace(tr) for tr in traces],
        "traces": {"blink": blink.trace(frames), "smile": smile, "brow": brow},
        "values": vals,
        "quality": gates,
        "flash_ok": block["flash_ok"],
        "flash": block,
        "calib": {"err_deg": cal["err_deg"], "points": cal["points"]},
        "speech_how": sp.get("how", "none"),
        "steps": [w["kind"] for w in windows(session.get("stim") or [])],
    }


def feature_list(vals: dict, prev: dict | None, flash_ok: bool) -> list[dict]:
    """The Feature list in the contract shape, with MDC and the changed flag."""
    out = []
    for key, value in vals.items():
        if key not in SPEC or value is None:
            continue
        tier, unit = SPEC[key]
        if tier == "B" and not flash_ok:
            continue
        was = None if not prev else prev.get(key)
        out.append({
            "name": key,
            "tier": tier,
            "value": float(value),
            "prev": None if was is None else float(was),
            "mdc": semmod.mdc(key),
            "unit": unit,
            "changed": semmod.changed(key, float(value), was),
        })
    return out


def pack_trace(tr: dict, keep: int = 600) -> dict:
    """One gaze trace thinned to at most `keep` samples and rounded for transport."""
    n = len(tr["t"])
    step = max(1, n // keep)
    keys = ("t", "x", "y", "tx", "ty")
    out = {"task": tr["task"]}
    for key in keys:
        out[key] = [round(float(v), 4) for v in np.asarray(tr[key])[::step]]
    return out


def observables(vals: dict) -> dict:
    """The six forecast observables, taken out of the full feature set."""
    from ..twin import forecast as fcast

    return {o["key"]: float(vals[o["key"]]) for o in fcast.OBS if vals.get(o["key"]) is not None}
