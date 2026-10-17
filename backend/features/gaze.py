"""Nine point calibration from iris ratios and head pose to screen coordinates.

Gaze is relative to the phone screen as it appears in the stimulus video, which is what
the patient is actually looking at. Degrees assume the viewing distance in config.
"""

import numpy as np

from ..config import cfg, deg_per_unit

DOTS = [(0.15, 0.15), (0.5, 0.15), (0.85, 0.15),
        (0.15, 0.5), (0.5, 0.5), (0.85, 0.5),
        (0.15, 0.85), (0.5, 0.85), (0.85, 0.85)]
HOLD_S = 1.0       # the agent shows each dot for one second
SETTLE_S = 0.35    # the first third of each hold is thrown away as saccade time


def design(hx, hy, yaw, pitch) -> np.ndarray:
    """Degree 2 polynomial features of the two ratios and two pose angles.

    [1, hx, hy, hx^2, hy^2, hx*hy, yaw, pitch, yaw*hx, pitch*hy]
    """
    hx = np.asarray(hx, dtype=float)
    hy = np.asarray(hy, dtype=float)
    yaw = np.asarray(yaw, dtype=float) / 30.0
    pitch = np.asarray(pitch, dtype=float) / 30.0
    return np.stack([np.ones_like(hx), hx, hy, hx**2, hy**2, hx * hy, yaw, pitch, yaw * hx, pitch * hy], axis=1)


def samples(frames: list[dict], dots: list[dict]) -> dict:
    """Every settled frame held on a calibration dot, paired with that dot.

    One row per frame rather than one per dot. Nine rows against the ten polynomial
    terms would be underdetermined, which fits every dot exactly, reports a calibration
    error of zero and hands back a wildly overfit map.
    """
    rows, tgt, dot_id = [], [], []
    for j, dot in enumerate(dots):
        t0 = int(dot["t_ns"]) + int(SETTLE_S * 1e9)
        t1 = int(dot["t_ns"]) + int(HOLD_S * 1e9)
        for f in frames:
            if not f.get("face") or not (t0 <= f["t_ns"] <= t1):
                continue
            rows.append((f["ratio"][0], f["ratio"][1], f["pose"][0], f["pose"][1]))
            tgt.append((float(dot["sx"]), float(dot["sy"])))
            dot_id.append(j)
    return {"rows": np.asarray(rows), "tgt": np.asarray(tgt), "dot": np.asarray(dot_id)}


def fit(frames: list[dict], dots: list[dict]) -> dict:
    """Least squares map from ratios and pose to screen coordinates, with its error.

    [sx, sy] = design(hx, hy, yaw, pitch) @ beta
    err_deg  = rms residual in normalized units times degrees per unit
    """
    got = samples(frames, dots)
    if len(got["rows"]) < 30 or len(set(got["dot"].tolist())) < 6:
        return {"beta": None, "err_deg": 99.0, "points": len(got["rows"]), "dots": 0}
    x = design(got["rows"][:, 0], got["rows"][:, 1], got["rows"][:, 2], got["rows"][:, 3])
    beta, *_ = np.linalg.lstsq(x, got["tgt"], rcond=None)
    pred = x @ beta
    dx, dy = deg_per_unit()
    res = pred - got["tgt"]
    err = float(np.sqrt(np.mean((res[:, 0] * dx) ** 2 + (res[:, 1] * dy) ** 2)))
    return {"beta": beta, "err_deg": err, "points": len(got["rows"]),
            "dots": int(len(set(got["dot"].tolist())))}


def apply(beta, frames: list[dict]) -> dict:
    """Map every frame with a face to screen coordinates and seconds."""
    got = [f for f in frames if f.get("face")]
    if not got:
        return {"t": np.zeros(0), "x": np.zeros(0), "y": np.zeros(0)}
    t = np.array([f["t_ns"] for f in got], dtype=float) / 1e9
    t = t - t[0]
    hx = np.array([f["ratio"][0] for f in got])
    hy = np.array([f["ratio"][1] for f in got])
    yaw = np.array([f["pose"][0] for f in got])
    pitch = np.array([f["pose"][1] for f in got])
    if beta is None:
        # No usable calibration, fall back to the raw ratios so the trace is still drawable.
        return {"t": t, "x": hx, "y": hy, "calibrated": False}
    out = design(hx, hy, yaw, pitch) @ np.asarray(beta)
    return {"t": t, "x": out[:, 0], "y": out[:, 1], "calibrated": True}


def speed_deg(t: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Gaze speed in degrees per second from a normalized trace."""
    dx, dy = deg_per_unit()
    if len(t) < 2:
        return np.zeros_like(t)
    dt = np.gradient(t)
    vx = np.gradient(x) * dx / np.where(np.abs(dt) < 1e-9, 1e-9, dt)
    vy = np.gradient(y) * dy / np.where(np.abs(dt) < 1e-9, 1e-9, dt)
    return np.sqrt(vx**2 + vy**2)


def units_per_deg() -> tuple[float, float]:
    """Normalized screen units per degree, horizontal and vertical."""
    dx, dy = deg_per_unit()
    return 1.0 / dx, 1.0 / dy


def screen_mm() -> tuple[float, float]:
    """Phone screen size in mm, from config."""
    return cfg.screen_w_mm, cfg.screen_h_mm
