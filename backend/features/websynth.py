"""Generate what a phone would post for a whole call, for the mock web call and the tests.

This writes FrameRecs and StimEvents in exactly the shape the browser sends, so a mock
call goes through the same validation, the same camera latency estimate, the same
calibration fit and the same feature functions as a real one. The only thing it skips is
the phone.

The generated frames carry a known camera delay, so a test can check the estimate
recovers it and that the saccade latency comes back right once it is removed.
"""

import numpy as np

from ..agent import script as agentscript
from ..calls import script as webscript
from . import gaze as gz, memory, synth

FPS = 30.0
CAM_DELAY_S = 0.08      # what the tests expect the estimator to find
RATIO_A = synth.RATIO_A
RATIO_B = synth.RATIO_B


def _rec(when_ms: float, px: float, py: float, rng: np.random.Generator, bright: float,
         face: bool, ear: float, iris_px: float, smile: float, brow: float) -> dict:
    """One FrameRec in the contract shape."""
    return {
        "t": round(when_ms, 3),
        "cap": round(when_ms, 3),
        "face": bool(face),
        "ratio": {"h": round(RATIO_A + RATIO_B * px + float(rng.normal(0, 0.006)), 5),
                  "v": round(RATIO_A + RATIO_B * py + float(rng.normal(0, 0.006)), 5)},
        "iris": {"lx": round(0.42 + 0.02 * px, 5), "ly": round(0.46 + 0.02 * py, 5),
                 "rx": round(0.58 + 0.02 * px, 5), "ry": round(0.46 + 0.02 * py, 5)},
        "iris_px": round(iris_px, 2),
        "head": {"yaw": round(float(rng.normal(0, 1.5)), 3),
                 "pitch": round(float(rng.normal(0, 1.5)), 3),
                 "roll": round(float(rng.normal(0, 1.0)), 3)},
        "ear": {"l": round(ear, 4), "r": round(ear + float(rng.normal(0, 0.004)), 4)},
        "bright": round(float(np.clip(bright, 0.0, 1.0)), 5),
        "blend": {"smile": round(smile, 4), "brow_down": round(brow, 4), "jaw_open": 0.05},
    }


def _window(start_ms: float, dur_s: float, gx, gy, rng: np.random.Generator, lum: float,
            face_p: float, flashes_ms: list[float], cam_delay_s: float,
            blinks: bool = True) -> list[dict]:
    """Frames over one task window. Flash times are absolute browser ms when drawn."""
    out = []
    steps = int(dur_s * FPS)
    for i in range(steps):
        sec = i / FPS
        when = start_ms + sec * 1000.0
        px = gx(sec) if callable(gx) else float(gx)
        py = gy(sec) if callable(gy) else float(gy)
        ear = 0.3 + float(rng.normal(0, 0.008))
        if blinks and (i % 95) in (0, 1, 2):
            ear = 0.11
        bright = lum + 0.004 * float(np.sin(2 * np.pi * 0.3 * sec)) + float(rng.normal(0, 0.012))
        # The camera sees the white frame cam_delay_s after the page drew it.
        for tf in flashes_ms:
            if abs(when - (tf + cam_delay_s * 1000.0)) < 1000.0 / FPS / 2:
                bright += 0.35
        out.append(_rec(when, px, py, rng, bright, rng.random() < face_p, ear,
                        16.0 + float(rng.normal(0, 0.6)),
                        float(np.clip(0.18 + 0.05 * np.sin(2 * np.pi * 0.05 * sec), 0, 1)),
                        float(np.clip(0.10 + 0.04 * np.sin(2 * np.pi * 0.03 * sec), 0, 1))))
    return out


SACCADE_S = 0.045      # how long the eye takes to cross, a real 10 degree saccade


def _ramp(sec: float, start: float, dur: float) -> float:
    """A smooth 0 to 1 crossing over `dur` seconds, raised cosine."""
    if sec <= start:
        return 0.0
    if sec >= start + dur:
        return 1.0
    return float(0.5 - 0.5 * np.cos(np.pi * (sec - start) / dur))


def _step_gaze(jumps: list[dict], lat_s: float, cam_delay_s: float, centre: float = 0.5,
               amp: float = 0.3):
    """Gaze for a step task as the camera reports it.

    The eye starts moving lat_s after the jump was drawn and takes SACCADE_S to get
    there, and the camera reports all of it cam_delay_s late, so the flash and the
    response carry the same lag and subtracting it leaves the patient's latency.

    The crossing is a raised cosine rather than an instantaneous jump on purpose. A step
    discontinuity makes the numerical velocity gradient rise a sample before the movement
    actually starts, which biased the recovered latency a whole frame early. A real eye
    has a velocity profile, and with one the onset detector is close to unbiased.
    """
    def fn(sec: float) -> float:
        pos = centre
        for jump in jumps:
            out = _ramp(sec, jump["t"] + cam_delay_s + lat_s, SACCADE_S)
            back = _ramp(sec, jump["t"] + cam_delay_s + jump["hold"], SACCADE_S)
            pos = pos + jump["to"] * amp * (out - back)
        return pos

    return fn


def session(values: dict, seed: int = 0, poor: bool = False, cam_delay_s: float = CAM_DELAY_S,
            flash_ok: bool | None = None) -> dict:
    """Everything a phone would post for one call: chunks, answers and the audio stand-ins.

    Returns {"chunks": [...], "answers": {...}, "meta": {...}, "camera_delay_s": ...} where
    chunks are exactly what POST /frames receives, one entry per task.
    """
    rng = np.random.default_rng(seed)
    flash_ok = (not poor) if flash_ok is None else bool(flash_ok)

    gain = float(values.get("pursuit_gain", 0.8))
    lat_s = float(values.get("saccade_latency", 200.0)) / 1000.0
    err_pct = float(values.get("antisaccade_err", 20.0))
    rate = float(values.get("speech_rate", 4.5))
    recall = int(round(float(values.get("recall_delayed", 10.0))))
    total = float(values.get("symptom_total", 10.0))

    lum = 0.45 if not poor else 0.12
    face_p = 1.0 if not poor else 0.55
    clock = 1000.0            # browser ms, performance.now() style
    chunks: list[dict] = []

    def post(task: str, frames: list[dict], stim: list[dict]) -> None:
        """One chunk per task, the way the page posts it."""
        chunks.append({"task": task, "kind": "frames", "payload": frames})
        chunks.append({"task": task, "kind": "stim", "payload": stim})

    # Quality step: ten test flashes 1.5 s apart, which is where camera latency comes from.
    stim = [{"t": clock, "kind": "task", "task": "quality", "params": {}}]
    # Jittered spacing on purpose: flashes exactly 1500 ms apart all land on the same
    # phase of the 30 fps frame grid, which makes the per trial spread exactly zero and
    # leaves the 25 ms spread gate untested.
    flashes = [clock + 300.0 + 1500.0 * i + float(rng.uniform(0, 33.0)) for i in range(10)]
    for i, tf in enumerate(flashes):
        stim.append({"t": tf, "kind": "test_flash", "flash": True, "trial": i})
    frames = _window(clock, 16.0, 0.5, 0.5, rng, lum, face_p,
                     flashes if flash_ok else [], cam_delay_s)
    post("quality", frames, stim)
    clock += 16000.0

    # Calibration: nine dots, the page logs the exact coordinates it drew.
    stim = [{"t": clock, "kind": "task", "task": "calib", "params": {"dots": 9}}]
    frames = []
    bias_sd = 0.18 if poor else 0.035
    for sx, sy in gz.DOTS:
        stim.append({"t": clock, "kind": "calib_dot", "x": sx, "y": sy})
        bias = rng.normal(0, bias_sd, 2)
        frames += _window(clock, gz.HOLD_S, sx + bias[0], sy + bias[1], rng, lum, face_p,
                          [], cam_delay_s, blinks=False)
        clock += gz.HOLD_S * 1000.0
    post("calib", frames, stim)

    # Smooth pursuit, horizontal then vertical.
    for task, freq in (("pursuit_h", 0.4), ("pursuit_v", 0.3)):
        stim = [{"t": clock, "kind": "task", "task": task, "params": {"amp": 0.35, "freq": freq}}]
        fn = synth.sine(0.35, freq, gain)
        if task == "pursuit_h":
            frames = _window(clock, 20.0, fn, 0.5, rng, lum, face_p, [], cam_delay_s)
        else:
            frames = _window(clock, 20.0, 0.5, fn, rng, lum, face_p, [], cam_delay_s)
        post(task, frames, stim)
        clock += 20000.0

    # Ten saccade trials. Each jump is drawn with a one frame white flash.
    stim = [{"t": clock, "kind": "task", "task": "saccade", "params": {"trials": 10}}]
    jumps, jump_ms = [], []
    for i in range(10):
        sec = 0.4 + 2.0 * i
        side = 1 if rng.random() < 0.5 else -1
        jumps.append({"t": sec, "to": side, "hold": 1.2})
        jump_ms.append(clock + sec * 1000.0)
        stim.append({"t": clock + sec * 1000.0, "kind": "saccade_jump", "flash": True,
                     "trial": i, "side": "R" if side > 0 else "L",
                     "x": 0.5 + side * 0.3, "y": 0.5})
    frames = _window(clock, 20.0, _step_gaze(jumps, lat_s, cam_delay_s), 0.5, rng, lum,
                     face_p, jump_ms if flash_ok else [], cam_delay_s)
    post("saccade", frames, stim)
    clock += 20000.0

    # Twenty antisaccade trials. An error looks toward the target instead of away.
    stim = [{"t": clock, "kind": "task", "task": "antisaccade", "params": {"trials": 20}}]
    anti, anti_ms = [], []
    for i in range(20):
        sec = 0.3 + 2.0 * i
        side = 1 if rng.random() < 0.5 else -1
        wrong = rng.random() < (err_pct / 100.0)
        anti.append({"t": sec, "to": side if wrong else -side, "hold": 1.2})
        anti_ms.append(clock + sec * 1000.0)
        stim.append({"t": clock + sec * 1000.0, "kind": "antisaccade_jump", "flash": True,
                     "trial": i, "side": "R" if side > 0 else "L",
                     "x": 0.5 + side * 0.3, "y": 0.5})
    frames = _window(clock, 40.0, _step_gaze(anti, lat_s, cam_delay_s), 0.5, rng, lum,
                     face_p, anti_ms if flash_ok else [], cam_delay_s)
    post("antisaccade", frames, stim)
    clock += 40000.0

    # Ten second fixation hold.
    stim = [{"t": clock, "kind": "task", "task": "fixation", "params": {"seconds": 10}}]
    frames = _window(clock, 10.0, 0.5, 0.5, rng, lum, face_p, [], cam_delay_s)
    post("fixation", frames, stim)
    clock += 10000.0

    # Picture description, watching the face while they talk.
    stim = [{"t": clock, "kind": "task", "task": "picture", "params": {}}]
    frames = _window(clock, 10.0, 0.5, 0.5, rng, lum, face_p, [], cam_delay_s)
    post("picture", frames, stim)
    clock += 10000.0

    # Spoken parts. Word timings carry the target speech rate the way the rig did.
    from . import speech

    words, tnow = [], clock / 1000.0
    for word in webscript.PASSAGE.lower().replace(",", "").replace(".", "").split():
        dur = speech.count_syllables(word) / max(rate, 0.5)
        words.append({"w": word, "t0": round(tnow, 3), "t1": round(tnow + dur, 3), "task": "passage"})
        tnow += dur
    for _ in range(16):
        words.append({"w": str(rng.integers(1, 10)), "t0": round(tnow, 3),
                      "t1": round(tnow + 0.45, 3), "task": "numbers"})
        tnow += 0.5

    said = memory.WORDS[: max(0, min(15, recall))]
    answers = {
        "symptoms": dict(zip(agentscript.SYMPTOMS, synth.split_symptoms(total, rng))),
        "recall_immediate": said + ([memory.WORDS[-1]] if recall < 15 and rng.random() < 0.3 else []),
        "recall_delayed": said,
        "fluency": synth.fluency_said(rng, int(round(float(values.get("fluency_animals", 18))))),
        "npc_cm": float(np.clip(rng.normal(7.0, 1.5), 3, 20)),
    }

    return {
        "chunks": chunks,
        "answers": answers,
        "words": words,
        "meta": {"w_px": 390, "h_px": 844, "dpr": 3.0, "ua": "mock phone", "fps": FPS},
        "camera_delay_s": cam_delay_s,
        "ah_duration": float(np.clip(rng.normal(16.0, 2.0), 3, 40)),
        "ptk_rate": float(np.clip(rng.normal(6.0, 0.6), 1, 10)),
        "seconds": (clock - 1000.0) / 1000.0,
    }
