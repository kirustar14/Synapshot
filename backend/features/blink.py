"""Blink detection from the eye aspect ratio, with hysteresis. Reach feature."""

import numpy as np

SHUT = 0.17    # EAR below this starts a blink
OPEN = 0.22    # and it only ends once EAR comes back above this
MIN_MS = 50.0
MAX_MS = 600.0


def detect(t: np.ndarray, ear: np.ndarray) -> dict:
    """Blink rate per minute and the duration of each blink.

    A blink starts when EAR < SHUT and ends when EAR > OPEN, so noise around one
    threshold cannot produce a train of false blinks.
    """
    t = np.asarray(t, dtype=float)
    ear = np.asarray(ear, dtype=float)
    if len(t) < 5:
        return {"blink_rate": 0.0, "blink_dur": 0.0, "blinks": [], "seconds": 0.0}

    out, start = [], None
    for i in range(len(t)):
        if start is None and ear[i] < SHUT:
            start = t[i]
        elif start is not None and ear[i] > OPEN:
            ms = (t[i] - start) * 1000.0
            if MIN_MS <= ms <= MAX_MS:
                out.append({"t": float(start), "ms": float(ms)})
            start = None
    span = float(t[-1] - t[0]) or 1.0
    return {
        "blink_rate": float(60.0 * len(out) / span),
        "blink_dur": float(np.mean([b["ms"] for b in out])) if out else 0.0,
        "blinks": out,
        "seconds": span,
    }


def trace(frames: list[dict]) -> dict:
    """Seconds and EAR over frames with a face, for the exploratory blink trace."""
    got = [f for f in frames if f.get("face")]
    if not got:
        return {"t": [], "v": []}
    t = np.array([f["t_ns"] for f in got], dtype=float) / 1e9
    return {"t": [round(float(v), 3) for v in (t - t[0])], "v": [round(float(f.get("ear", 0.3)), 4) for f in got]}


def expression(frames: list[dict], key: str) -> dict:
    """One blendshape over time, labelled exploratory everywhere it is shown."""
    got = [f for f in frames if f.get("face")]
    if not got:
        return {"t": [], "v": []}
    t = np.array([f["t_ns"] for f in got], dtype=float) / 1e9
    return {"t": [round(float(v), 3) for v in (t - t[0])],
            "v": [round(float((f.get("blend") or {}).get(key, 0.0)), 4) for f in got]}
