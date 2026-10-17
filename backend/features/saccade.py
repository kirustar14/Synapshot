"""Saccade latency, tier B. Measured between two events in the same returned stream.

latency = T_e - T_f
T_f = the returned flash frame that marks the target jump
T_e = the first sample after T_f where gaze speed passes the threshold in the direction
      the target jumped
Both timestamps come from the returned video, so the FaceTime delay is in both and
cancels. If the flash is not detectable the latency is not reported at all.
"""

import numpy as np

SPEED_DEG_S = 30.0    # saccade onset threshold
MAX_LAT_S = 0.7       # anything later is not a response to this trial
MIN_LAT_S = 0.08      # anything faster is an anticipation, not a reaction


def onset(t: np.ndarray, x: np.ndarray, y: np.ndarray, t_f: float, side: int, speed: np.ndarray) -> dict:
    """First supra threshold sample after t_f whose direction matches the target jump."""
    t = np.asarray(t, dtype=float)
    win = np.flatnonzero((t >= t_f + MIN_LAT_S) & (t <= t_f + MAX_LAT_S))
    for i in win:
        if speed[i] < SPEED_DEG_S:
            continue
        step = float(x[min(i + 1, len(x) - 1)] - x[max(i - 1, 0)])
        if side * step > 0:
            return {"ok": True, "t": float(t[i]), "latency": float(t[i] - t_f), "speed": float(speed[i])}
    return {"ok": False, "t": None, "latency": None, "speed": 0.0}


def trials(trace: dict, jumps: list[dict], flash_times: list[float | None]) -> dict:
    """Latency per trial and the median, in ms.

    jumps[i] = {"side": -1 or +1}, flash_times[i] = the returned flash time or None
    """
    from . import gaze as gz

    t = np.asarray(trace["t"], dtype=float)
    x = np.asarray(trace["x"], dtype=float)
    y = np.asarray(trace["y"], dtype=float)
    if len(t) < 10:
        return {"saccade_latency": None, "trials": 0, "used": 0, "latencies": []}
    speed = gz.speed_deg(t, x, y)

    lats = []
    for jump, tf in zip(jumps, flash_times):
        if tf is None:
            continue
        got = onset(t, x, y, float(tf), int(jump["side"]), speed)
        if got["ok"]:
            lats.append(got["latency"] * 1000.0)
    return {
        "saccade_latency": float(np.median(lats)) if lats else None,
        "saccade_latency_sd": float(np.std(lats)) if len(lats) > 1 else None,
        "trials": len(jumps),
        "used": len(lats),
        "latencies": [round(v, 1) for v in lats],
    }
