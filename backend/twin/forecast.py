"""Damage decay, the six observables and the 12 week forecast with 80% bands."""

import numpy as np

from ..features import sem as semmod
from . import surrogate as sg

# D_ij(t) = D_ij(0) * (p + (1 - p) * exp(-k * t))        t in weeks
# d(t)    = SC weighted mean over edges of D_ij(t)
#         = d0 * (p + (1 - p) * exp(-k * t))             the time factor is edge free
# y_s(t)  = base_s + load_s * (z_of(d(t))[i_s] - z_of(0)[i_s]) / span_s + noise
# k = weekly recovery rate, p = residual damage fraction, d0 = mean damage at week 0
# i_s = which emulator summary drives observable s, span_s = that summary at full injury

WEEKS = 12

# key, label, unit, group, tier, healthy base, shift at full injury, driving summary.
# The SEM for each one is read from data/sem.json, never hard coded here.
OBS = [
    {"key": "pursuit_gain", "label": "Smooth pursuit gain", "unit": "ratio", "group": "eyes", "tier": "A", "base": 0.85, "load": -0.20, "summary": "fc_mean"},
    {"key": "antisaccade_err", "label": "Antisaccade errors", "unit": "%", "group": "eyes", "tier": "B", "base": 15.0, "load": 25.0, "summary": "meta"},
    {"key": "saccade_latency", "label": "Saccade latency", "unit": "ms", "group": "eyes", "tier": "B", "base": 200.0, "load": 40.0, "summary": "rate"},
    {"key": "speech_rate", "label": "Speech rate", "unit": "syll/s", "group": "speech", "tier": "A", "base": 4.5, "load": -1.0, "summary": "rate"},
    {"key": "recall_delayed", "label": "Delayed recall", "unit": "of 15 words", "group": "memory", "tier": "A", "base": 11.0, "load": -4.0, "summary": "fc_mean"},
    {"key": "symptom_total", "label": "Symptom total", "unit": "0 to 80", "group": "symptoms", "tier": "A", "base": 6.0, "load": 30.0, "summary": "fc_std"},
]
KEYS = [o["key"] for o in OBS]


def obs_of(key: str) -> dict:
    """One observable definition by key."""
    return OBS[KEYS.index(key)]


def sems() -> np.ndarray:
    """SEM per observable, in OBS order."""
    return np.array([semmod.sem(o["key"]) for o in OBS])


def weeks(upto: int = WEEKS) -> list[int]:
    """Week numbers 0 to upto."""
    return list(range(upto + 1))


def d_of(d0: float | np.ndarray, k: float | np.ndarray, p: float | np.ndarray, wk) -> np.ndarray:
    """Mean damage at the given weeks. d(t) = d0 * (p + (1 - p)*exp(-k*t))."""
    d0 = np.asarray(d0, dtype=float)[..., None]
    k = np.asarray(k, dtype=float)[..., None]
    p = np.asarray(p, dtype=float)[..., None]
    t = np.asarray(wk, dtype=float)
    return d0 * (p + (1.0 - p) * np.exp(-k * t))


def frac(d) -> np.ndarray:
    """Fraction of the full injury shift at damage d, per summary, shape (..., 4)."""
    return (sg.z_of(d) - sg.z_of(0.0)) / sg.span()


def y_of(d) -> np.ndarray:
    """Noise free observables at damage d, shape (..., 6) in OBS order."""
    fr = frac(d)
    cols = [o["base"] + o["load"] * fr[..., sg.index_of(o["summary"])] for o in OBS]
    return np.stack(cols, axis=-1)


def d0_vec(d0) -> np.ndarray:
    """One week zero damage level per observable, length 6.

    A scalar broadcasts to all six, which is the global damage path and the default. With
    regional loadings on, each signal carries its own level and the signals separate.
    """
    arr = np.atleast_1d(np.asarray(d0, dtype=float))
    if arr.size == len(OBS):
        return arr
    return np.full(len(OBS), float(arr.ravel()[0]))


def y_signals(d0, k, p, wk, scale=1.0) -> np.ndarray:
    """Noise free observables with one damage level per signal.

    d_s(t) = d0_s * scale * (p + (1 - p)*exp(-k*t)) , evaluated per signal
    Shapes follow d_of, so with k and p of length `draws` the result is
    (draws, weeks, 6). When d0 is a scalar this is exactly
    y_of(d_of(d0 * scale, k, p, wk)), which is why turning the loadings on cannot move
    the default path.
    """
    levels = d0_vec(d0)
    cols = []
    for o, level in zip(OBS, levels):
        d = d_of(level * np.asarray(scale, dtype=float), k, p, wk)
        fr = frac(d)[..., sg.index_of(o["summary"])]
        cols.append(o["base"] + o["load"] * fr)
    return np.stack(cols, axis=-1)


def truth(d0, k: float, p: float, upto: int = WEEKS, seed: int = 0, noise: bool = True) -> np.ndarray:
    """True weekly observables for a synthetic patient, weeks by 6, with SEM noise."""
    wk = np.asarray(weeks(upto), dtype=float)
    y = y_signals(d0, np.asarray(k, dtype=float), np.asarray(p, dtype=float), wk)
    if noise:
        rng = np.random.default_rng(seed)
        y = y + rng.normal(0.0, sems(), y.shape)
    return y


def spread(ens: np.ndarray, d0, upto: int = WEEKS, draws: int = 300, widen: float = 1.0, seed: int = 0) -> dict:
    """Predictive mean and 80% band per observable from the ensemble.

    theta member = [log k, logit p, log d0_scale]
    the band is the 10th to 90th percentile over members and measurement noise, so an
    observation falling inside it is the coverage the EnKF reports
    """
    rng = np.random.default_rng(seed)
    pick = rng.integers(0, ens.shape[0], draws) if ens.shape[0] != draws else np.arange(draws)
    th = ens[pick]
    k = np.exp(th[:, 0])
    p = 1.0 / (1.0 + np.exp(-np.clip(th[:, 1], -40, 40)))
    wk = np.asarray(weeks(upto), dtype=float)
    y = y_signals(d0, k, p, wk, scale=np.exp(th[:, 2]))   # draws by weeks by 6
    y = y + rng.normal(0.0, sems(), y.shape)
    mean = y.mean(axis=0)
    lo = np.percentile(y, 10, axis=0)
    hi = np.percentile(y, 90, axis=0)
    if widen != 1.0:
        lo = mean - widen * (mean - lo)
        hi = mean + widen * (hi - mean)
    return {"weeks": [int(v) for v in wk], "mean": mean, "lo": lo, "hi": hi}


def signals(ens: np.ndarray, d0, obs_rows: list[dict] | None = None, upto: int = WEEKS, widen: float = 1.0, cov: list[dict] | None = None, seed: int = 0) -> dict:
    """Forecast in the API contract shape, with observations attached per signal."""
    band = spread(ens, d0, upto=upto, widen=widen, seed=seed)
    sv = sems()
    out = []
    for i, o in enumerate(OBS):
        got = []
        for row in obs_rows or []:
            if o["key"] in row.get("values", {}):
                got.append({"week": int(row["week"]), "value": float(row["values"][o["key"]]), "sem": float(sv[i])})
        out.append({
            "key": o["key"], "label": o["label"], "unit": o["unit"], "group": o["group"], "tier": o["tier"],
            "mean": [float(v) for v in band["mean"][:, i]],
            "lo": [float(v) for v in band["lo"][:, i]],
            "hi": [float(v) for v in band["hi"][:, i]],
            "obs": got,
        })
    return {"weeks": band["weeks"], "signals": out, "coverage": cov or []}
