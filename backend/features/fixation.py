"""Steady fixation: bivariate contour ellipse area and saccadic intrusions."""

import numpy as np

from ..config import deg_per_unit

HOLD_S = 10.0
INTRUSION_DEG_S = 30.0   # same onset threshold as a saccade
INTRUSION_MIN_DEG = 0.5  # and it has to actually move somewhere


def bcea(x: np.ndarray, y: np.ndarray, prob: float = 0.68) -> float:
    """Bivariate contour ellipse area in square degrees.

    BCEA = 2 * k * pi * sd_x * sd_y * sqrt(1 - rho^2) , k = -ln(1 - P)
    """
    dx, dy = deg_per_unit()
    xs = np.asarray(x, dtype=float) * dx
    ys = np.asarray(y, dtype=float) * dy
    if len(xs) < 5:
        return 0.0
    rho = float(np.corrcoef(xs, ys)[0, 1]) if xs.std() > 1e-9 and ys.std() > 1e-9 else 0.0
    rho = 0.0 if not np.isfinite(rho) else rho
    k = -np.log(1.0 - prob)
    return float(2 * k * np.pi * xs.std() * ys.std() * np.sqrt(max(0.0, 1 - rho**2)))


def intrusions(t: np.ndarray, x: np.ndarray, y: np.ndarray) -> int:
    """Count movements that break fixation: speed over threshold and a real displacement."""
    from . import gaze as gz

    t = np.asarray(t, dtype=float)
    if len(t) < 5:
        return 0
    speed = gz.speed_deg(t, x, y)
    dx, dy = deg_per_unit()
    hot = speed > INTRUSION_DEG_S
    count, run = 0, False
    for i in range(1, len(t)):
        if hot[i] and not run:
            step = np.hypot((x[i] - x[i - 1]) * dx, (y[i] - y[i - 1]) * dy)
            if step > INTRUSION_MIN_DEG:
                count += 1
                run = True
        elif not hot[i]:
            run = False
    return int(count)


def measure(trace: dict) -> dict:
    """BCEA and intrusion count over the fixation hold."""
    t = np.asarray(trace["t"], dtype=float)
    x = np.asarray(trace["x"], dtype=float)
    y = np.asarray(trace["y"], dtype=float)
    return {"bcea": bcea(x, y), "intrusions": intrusions(t, x, y), "seconds": float(t[-1] - t[0]) if len(t) > 1 else 0.0}
