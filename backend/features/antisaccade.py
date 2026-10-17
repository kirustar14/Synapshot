"""Antisaccade: look away from the target. Tier B, reach feature.

Twenty trials. The target appears left or right and the correct response is a saccade to
the opposite side. An error is a first saccade toward the target. Latency is reported for
correct trials only, because an error trial measures a different thing.
"""

import numpy as np

from . import saccade

TRIALS = 20


def first_move(t: np.ndarray, x: np.ndarray, speed: np.ndarray, t_f: float) -> int:
    """Direction of the first supra threshold movement after t_f, -1, +1 or 0."""
    win = np.flatnonzero((t >= t_f + saccade.MIN_LAT_S) & (t <= t_f + saccade.MAX_LAT_S))
    for i in win:
        if speed[i] < saccade.SPEED_DEG_S:
            continue
        step = float(x[min(i + 1, len(x) - 1)] - x[max(i - 1, 0)])
        if abs(step) > 1e-6:
            return 1 if step > 0 else -1
    return 0


def trials(trace: dict, shown: list[dict], flash_times: list[float | None]) -> dict:
    """Error rate and correct trial latency.

    error = first saccade goes toward the target side
    error rate in percent, latency in ms over correct trials only
    """
    from . import gaze as gz

    t = np.asarray(trace["t"], dtype=float)
    x = np.asarray(trace["x"], dtype=float)
    y = np.asarray(trace["y"], dtype=float)
    if len(t) < 10:
        return {"antisaccade_err": None, "antisaccade_latency": None, "trials": 0, "used": 0}
    speed = gz.speed_deg(t, x, y)

    errs, lats, used = 0, [], 0
    for item, tf in zip(shown, flash_times):
        if tf is None:
            continue
        side = int(item["side"])
        got = first_move(t, x, speed, float(tf))
        if got == 0:
            continue
        used += 1
        if got == side:
            errs += 1
            continue
        onset = saccade.onset(t, x, y, float(tf), -side, speed)
        if onset["ok"]:
            lats.append(onset["latency"] * 1000.0)
    return {
        "antisaccade_err": float(100.0 * errs / used) if used else None,
        "antisaccade_latency": float(np.median(lats)) if lats else None,
        "trials": len(shown),
        "used": used,
        "errors": errs,
    }
