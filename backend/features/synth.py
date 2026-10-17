"""Generate a session that looks like a real capture, for the mock rig and the tests.

Everything downstream of here cannot tell a synthetic session from a real one: the frames
carry iris ratios, head pose, EAR, blendshapes and luminance on a monotonic clock, and the
stimulus log carries the same timestamps the stimulus page would write. The synthetic
session is built from the target observable values, so the pipeline has to measure them
back out, which is what makes the mock loop a real test of the pipeline.
"""

import numpy as np

FPS = 30.0
NS = 1_000_000_000
RATIO_A = 0.3     # ratio = RATIO_A + RATIO_B * screen position, the map calibration inverts
RATIO_B = 0.4
CALL_DELAY_S = 0.22   # FaceTime round trip, the same delay on the flash and the response


def ratio_of(pos: np.ndarray, rng: np.random.Generator, noise: float = 0.006) -> np.ndarray:
    """Turn a screen position into an iris ratio the way an eye and a camera would."""
    return RATIO_A + RATIO_B * np.asarray(pos, dtype=float) + rng.normal(0, noise, np.shape(pos))


def frames_for(t0_ns: int, dur_s: float, gx, gy, rng: np.random.Generator, lum: float = 0.45, face_p: float = 1.0, blinks: bool = True, flashes: list[float] | None = None, sec0: float = 0.0) -> list[dict]:
    """Frame records over one window.

    Gaze functions and flash times are both in seconds from the start of this window.
    `sec0` is only there so a caller can pass flash times in session seconds instead.
    """
    steps = int(dur_s * FPS)
    out = []
    for i in range(steps):
        sec = i / FPS
        t_ns = int(t0_ns + sec * NS)
        face = rng.random() < face_p
        px = gx(sec) if callable(gx) else float(gx)
        py = gy(sec) if callable(gy) else float(gy)
        hx = float(ratio_of(np.array(px), rng))
        hy = float(ratio_of(np.array(py), rng))
        ear = 0.3 + float(rng.normal(0, 0.008))
        if blinks and (i % 95) in (0, 1, 2):
            ear = 0.11
        bright = lum + 0.004 * float(np.sin(2 * np.pi * 0.3 * sec)) + float(rng.normal(0, 0.012))
        for tf in flashes or []:
            if abs((sec0 + sec) - (tf + CALL_DELAY_S)) < 0.5 / FPS:
                bright += 0.35
        out.append({
            "t_ns": t_ns,
            "face": bool(face),
            "lum": float(np.clip(bright, 0, 1)),
            "ratio": (hx, hy),
            "pose": (float(rng.normal(0, 1.5)), float(rng.normal(0, 1.5)), float(rng.normal(0, 1.0))),
            "ear": float(ear),
            "iris_px": float(16.0 + rng.normal(0, 0.6)),
            "blend": {"mouthSmileLeft": float(np.clip(0.18 + 0.05 * np.sin(2 * np.pi * 0.05 * sec) + rng.normal(0, 0.02), 0, 1)),
                      "browInnerUp": float(np.clip(0.10 + 0.04 * np.sin(2 * np.pi * 0.03 * sec) + rng.normal(0, 0.02), 0, 1))},
        })
    return out


def sine(amp: float, freq: float, gain: float, centre: float = 0.5):
    """Gaze position function that follows a sine target at a given gain."""
    def fn(sec: float) -> float:
        return centre + gain * amp * np.sin(2 * np.pi * freq * sec)

    return fn


def step_task(jumps: list[dict], latency_s: float, centre: float = 0.5, amp: float = 0.3, delay_s: float = CALL_DELAY_S):
    """Gaze position function for a step task, in returned video time.

    The returned video is delayed as a whole, so the flash arrives at t_f + delay and the
    patient's response arrives at t_f + delay + latency. The measured difference is the
    latency, which is the point of timing both events off the same returned stream.
    """
    def fn(sec: float) -> float:
        pos = centre
        for jump in jumps:
            if sec >= jump["t_f"] + delay_s + latency_s:
                pos = centre + jump["to"] * amp
            if sec >= jump["t_f"] + delay_s + jump["hold"]:
                pos = centre
        return pos

    return fn


def session(values: dict, seed: int = 0, flash_ok: bool | None = None, poor: bool = False) -> dict:
    """A full session built to carry the given observable values.

    A poor channel fails the flash test unless the caller says otherwise, which is the
    case the tier B drop exists for.
    """
    rng = np.random.default_rng(seed)
    flash_ok = (not poor) if flash_ok is None else bool(flash_ok)
    from . import memory

    gain = float(values.get("pursuit_gain", 0.8))
    lat_s = float(values.get("saccade_latency", 200.0)) / 1000.0
    err_pct = float(values.get("antisaccade_err", 20.0))
    rate = float(values.get("speech_rate", 4.5))
    recall = int(round(float(values.get("recall_delayed", 10.0))))
    total = float(values.get("symptom_total", 10.0))

    lum = 0.45 if not poor else 0.12
    face_p = 1.0 if not poor else 0.55
    t0 = 1_000_000_000_000
    frames: list[dict] = []
    stim: list[dict] = []
    clock = 0.0

    def mark(kind: str, params: dict | None = None) -> None:
        stim.append({"t_ns": int(t0 + clock * NS), "kind": kind, "params": params or {}})

    # Nine point calibration, one second per dot.
    from . import gaze as gz

    # Each dot is fixated slightly off centre, by an amount the calibration polynomial
    # cannot absorb, which is where the reported calibration error in degrees comes from.
    bias_sd = 0.18 if poor else 0.035
    calib = []
    mark("calib")
    for sx, sy in gz.DOTS:
        bias = rng.normal(0, bias_sd, 2)
        calib.append({"t_ns": int(t0 + clock * NS), "sx": sx, "sy": sy})
        frames += frames_for(int(t0 + clock * NS), gz.HOLD_S, sx + bias[0], sy + bias[1],
                             rng, lum, face_p, blinks=False)
        clock += gz.HOLD_S

    # Ten test flashes, 1.5 s apart. A failed flash test means they do not come back.
    mark("blank")
    flashes = [clock + 0.3 + 1.5 * i for i in range(10)]
    frames += frames_for(int(t0 + clock * NS), 15.5, 0.5, 0.5, rng, lum, face_p,
                         flashes=flashes if flash_ok else [], sec0=clock)
    clock += 15.5

    # Smooth pursuit, horizontal then vertical.
    for kind, freq in (("pursuit_h", 0.4), ("pursuit_v", 0.3)):
        mark(kind, {"amp": 0.35, "freq": freq})
        fn = sine(0.35, freq, gain)
        if kind == "pursuit_h":
            frames += frames_for(int(t0 + clock * NS), 20.0, fn, 0.5, rng, lum, face_p)
        else:
            frames += frames_for(int(t0 + clock * NS), 20.0, 0.5, fn, rng, lum, face_p)
        clock += 20.0

    # Ten saccade trials, each starting with a flash at the jump.
    sac_trials, jumps = [], []
    mark("saccade", {"trials": 10})
    for i in range(10):
        tf = 0.4 + 2.0 * i
        side = 1 if rng.random() < 0.5 else -1
        jumps.append({"t_f": tf, "to": side, "hold": 1.2})
        sac_trials.append({"side": side, "t_f": (tf + CALL_DELAY_S) if flash_ok else None})
    frames += frames_for(int(t0 + clock * NS), 20.0, step_task(jumps, lat_s), 0.5, rng, lum, face_p,
                         flashes=[j["t_f"] for j in jumps] if flash_ok else [])
    clock += 20.0

    # Twenty antisaccade trials. An error trial looks toward the target instead of away.
    anti_trials, anti_jumps = [], []
    mark("antisaccade", {"trials": 20})
    for i in range(20):
        tf = 0.3 + 2.0 * i
        side = 1 if rng.random() < 0.5 else -1
        wrong = rng.random() < (err_pct / 100.0)
        anti_jumps.append({"t_f": tf, "to": side if wrong else -side, "hold": 1.2})
        anti_trials.append({"side": side, "t_f": tf + CALL_DELAY_S})
    frames += frames_for(int(t0 + clock * NS), 40.0, step_task(anti_jumps, lat_s), 0.5, rng, lum, face_p,
                         flashes=[j["t_f"] for j in anti_jumps] if flash_ok else [])
    clock += 40.0

    # Ten second fixation hold.
    mark("fixation", {"seconds": 10})
    frames += frames_for(int(t0 + clock * NS), 10.0, 0.5, 0.5, rng, lum, face_p)
    clock += 10.0

    mark("picture")
    frames += frames_for(int(t0 + clock * NS), 10.0, 0.5, 0.5, rng, lum, face_p)
    clock += 10.0

    # Spoken parts. Word timings carry the target speech rate.
    said = memory.WORDS[:max(0, min(15, recall))]
    passage = ("the north wind and the sun were disputing which was the stronger when a "
               "traveller came along wrapped in a warm cloak").split()
    words, tnow = [], clock
    for w in passage:
        from . import speech

        dur = speech.count_syllables(w) / max(rate, 0.5)
        words.append({"w": w, "t0": round(tnow, 3), "t1": round(tnow + dur, 3), "task": "passage"})
        tnow += dur
    for i in range(16):
        words.append({"w": str(rng.integers(1, 10)), "t0": round(tnow, 3), "t1": round(tnow + 0.45, 3), "task": "numbers"})
        tnow += 0.5

    sym = dict(zip(
        ["headache", "pressure", "neck_pain", "nausea", "dizziness", "blurred_vision", "light_sensitivity", "fatigue"],
        split_symptoms(total, rng)))

    return {
        "t0_ns": t0,
        "frames": frames,
        "stim": stim,
        "calib": calib,
        "flashes": flashes,
        "trials": {"saccade": sac_trials, "antisaccade": anti_trials},
        "words": words,
        "audio": {"wave": None, "sr": 16000},
        "ah_duration": float(np.clip(rng.normal(16.0, 2.0), 3, 40)),
        "ptk_rate": float(np.clip(rng.normal(6.0, 0.6), 1, 10)),
        "answers": {
            "symptoms": sym,
            "recall_immediate": said + ([] if recall >= 15 else [memory.WORDS[-1]] if rng.random() < 0.3 else []),
            "recall_delayed": said,
            "fluency": fluency_said(rng, int(round(float(values.get("fluency_animals", 18))))),
            "npc_cm": float(np.clip(rng.normal(7.0, 1.5), 3, 20)),
        },
        "seconds": clock,
    }


def split_symptoms(total: float, rng: np.random.Generator) -> list[float]:
    """Eight item scores, each 0 to 10, that add up to the symptom total.

    Dirichlet shares, then the excess over 10 on any item is poured into the items that
    still have room, so the eight answers really do sum to the total the twin expects.
    """
    cap = 10.0
    want = float(np.clip(total, 0.0, 8 * cap))
    out = np.clip(rng.dirichlet(np.ones(8)) * want, 0.0, cap)
    for _ in range(12):
        gap = want - out.sum()
        if abs(gap) < 0.05:
            break
        room = (cap - out) if gap > 0 else out
        if room.sum() < 1e-9:
            break
        out = np.clip(out + gap * room / room.sum(), 0.0, cap)
    return [float(round(v, 1)) for v in out]


def fluency_said(rng: np.random.Generator, count: int) -> list[str]:
    """A plausible list of animals named in 60 seconds, with a repeat or two."""
    from . import fluency

    count = int(np.clip(count, 1, 40))
    pick = list(rng.choice(fluency.ANIMALS, size=count, replace=False))
    if count > 3:
        pick.insert(count // 2, pick[0])
    return [str(p) for p in pick]
