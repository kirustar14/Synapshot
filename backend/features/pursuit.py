"""Smooth pursuit gain against a sine target, with a lag search.

The lag found here is not reported clinically. It contains the FaceTime round trip, the
OBS virtual camera latency and the phone's own pipeline, so it says nothing about the
patient. Only the gain and the RMS error after alignment are reported.
"""

import numpy as np

MAX_LAG_S = 0.8
LAG_STEP_S = 0.01


def target(t, amp: float = 0.35, freq: float = 0.4, centre: float = 0.5) -> np.ndarray:
    """x(t) = amp * sin(2 pi f t) + centre."""
    return amp * np.sin(2 * np.pi * freq * np.asarray(t, dtype=float)) + centre


def gain_at(lag: float, t: np.ndarray, g: np.ndarray, tt: np.ndarray, tgt: np.ndarray) -> dict:
    """Regress gaze on the target shifted by one lag.

    g(t) = a + b * target(t - lag) , gain = b
    rms  = sqrt(mean((g - a - b*target)^2)) in normalized units
    """
    shifted = np.interp(t - lag, tt, tgt)
    xc = shifted - shifted.mean()
    gc = np.asarray(g) - np.mean(g)
    var = float((xc**2).sum())
    if var < 1e-12:
        return {"gain": 0.0, "r": 0.0, "rms": 1.0, "lag": lag}
    b = float((xc * gc).sum() / var)
    pred = b * xc
    res = gc - pred
    denom = float(np.sqrt((gc**2).sum() * (xc**2).sum())) + 1e-12
    return {
        "gain": b,
        "r": float((xc * gc).sum() / denom),
        "rms": float(np.sqrt(np.mean(res**2))),
        "lag": float(lag),
    }


def measure(t, g, tt=None, tgt=None, amp: float = 0.35, freq: float = 0.4, centre: float = 0.5) -> dict:
    """Pursuit gain at the best lag, plus the RMS error after alignment.

    The best lag maximizes the correlation between gaze and the shifted target.
    """
    t = np.asarray(t, dtype=float)
    g = np.asarray(g, dtype=float)
    if tt is None or tgt is None:
        tt = t
        tgt = target(t, amp, freq, centre)
    tt = np.asarray(tt, dtype=float)
    tgt = np.asarray(tgt, dtype=float)
    if len(t) < 10:
        return {"gain": 0.0, "rms": 1.0, "lag": 0.0, "r": 0.0, "samples": len(t)}

    lags = np.arange(0.0, MAX_LAG_S + 1e-9, LAG_STEP_S)
    best = max((gain_at(float(lag), t, g, tt, tgt) for lag in lags), key=lambda d: d["r"])
    best["samples"] = int(len(t))
    return best


def both(trace: dict, tt=None, txy=None, freq_h: float = 0.4, freq_v: float = 0.3) -> dict:
    """Horizontal and vertical pursuit from one calibrated trace."""
    t = np.asarray(trace["t"], dtype=float)
    h = measure(t, np.asarray(trace["x"], dtype=float), tt, None if txy is None else txy[0], freq=freq_h)
    v = measure(t, np.asarray(trace["y"], dtype=float), tt, None if txy is None else txy[1], freq=freq_v)
    return {
        "pursuit_gain": h["gain"],
        "pursuit_rms": h["rms"] * 100.0,
        "pursuit_gain_v": v["gain"],
        "pursuit_rms_v": v["rms"] * 100.0,
        "lag_s_not_clinical": h["lag"],
    }
