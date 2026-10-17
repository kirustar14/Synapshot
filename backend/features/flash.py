"""The flash trick: find the one frame brightness step that marks a trial start.

Every saccade trial begins with a single full screen white frame in the stimulus video at
a known Mac clock time T_f. The same step comes back through FaceTime in the returned
video, delayed by the call. Detecting it in the returned frames is what makes a latency
measurable at all: both the stimulus event and the response are then read off the same
returned stream, so the call delay cancels. If fewer than 8 of 10 test flashes are found,
`flash_ok` is false and every tier B measure is dropped everywhere.
"""

import numpy as np

NEED = 8          # of 10 test flashes
TRIALS = 10
BASE_S = 0.5      # rolling baseline window before the candidate
SEARCH_S = 1.5    # how far after T_f to look for the returned step
MIN_Z = 4.0       # step size in baseline sigmas


def detect(t: np.ndarray, lum: np.ndarray, t_f: float, base_s: float = BASE_S, search_s: float = SEARCH_S, min_z: float = MIN_Z) -> dict:
    """Find the brightness rise after t_f.

    z(i) = (lum_i - mean(baseline)) / sd(baseline)
    baseline = the samples in [t_i - base_s, t_i), the step is the first i with z > min_z
    """
    t = np.asarray(t, dtype=float)
    lum = np.asarray(lum, dtype=float)
    win = (t >= t_f) & (t <= t_f + search_s)
    idx = np.flatnonzero(win)
    if len(idx) == 0:
        return {"found": False, "t": None, "z": 0.0}

    best = {"found": False, "t": None, "z": 0.0}
    for i in idx:
        prev = (t >= t[i] - base_s) & (t < t[i])
        if prev.sum() < 5:
            continue
        mu = float(lum[prev].mean())
        sd = float(lum[prev].std())
        z = (float(lum[i]) - mu) / max(sd, 1e-6)
        if z > best["z"]:
            best = {"found": bool(z > min_z), "t": float(t[i]), "z": float(z)}
        if z > min_z:
            return {"found": True, "t": float(t[i]), "z": float(z)}
    return best


def lum_of(frames: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Seconds and mean face region luminance from frame records."""
    if not frames:
        return np.zeros(0), np.zeros(0)
    t = np.array([f["t_ns"] for f in frames], dtype=float) / 1e9
    return t - t[0], np.array([f.get("lum", 0.0) for f in frames], dtype=float)


def test_block(t: np.ndarray, lum: np.ndarray, flash_times: list[float]) -> dict:
    """Run the detector over the test flashes and decide flash_ok."""
    hits = [detect(t, lum, float(tf)) for tf in flash_times]
    found = [h for h in hits if h["found"]]
    return {
        "flash_ok": len(found) >= NEED,
        "found": len(found),
        "trials": len(flash_times),
        "need": NEED,
        "times": [h["t"] for h in hits],
        "mean_z": float(np.mean([h["z"] for h in hits])) if hits else 0.0,
        "delay_s": float(np.mean([h["t"] - tf for h, tf in zip(hits, flash_times) if h["found"]])) if found else None,
    }


def synth(dur_s: float = 3.0, fps: float = 30.0, t_f: float = 1.0, delay_s: float = 0.25, amp: float = 0.35, noise: float = 0.02, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """A synthetic brightness series with one returned flash, for tests and the mock rig."""
    rng = np.random.default_rng(seed)
    t = np.arange(0.0, dur_s, 1.0 / fps)
    lum = 0.45 + 0.01 * np.sin(2 * np.pi * 0.3 * t) + rng.normal(0, noise, t.size)
    hit = int(round((t_f + delay_s) * fps))
    if 0 <= hit < t.size:
        lum[hit] += amp
    return t, lum
