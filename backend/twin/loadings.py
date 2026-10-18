"""Signal to region loadings, so each signal reads the damage where it actually lives.

Without this every observable reads one global damage number, which is why tract
attribution hands back the same ordering for every signal. With it, each signal s gets
its own damage

    d_s(t) = sum over regions r of w_sr * damage_r(t),   w_sr >= 0, sum_r w_sr = 1

and because the weights sum to 1, a uniformly damaged brain gives d_s = d for every
signal. Only the spatial pattern of the injury separates the signals, which is the point.

The weights are my design assumption. They are loosely motivated by what these tasks are
known to involve and they are not taken from any paper, so the API labels them a
hypothesis and the UI shows that badge. Behind REGIONAL_LOADINGS=1, off by default.
See DECISIONS.md.
"""

import os

import numpy as np

from ..data.templates import net_ids, templates

NOTE = ("hypothesis: a design assumption about which networks each task involves, not a "
        "result from any paper")

# Signal key -> the seven network labels it loads on, with a relative weight each.
# Networks are the Yeo seven: Vis, SomMot, DorsAttn, SalVentAttn, Limbic, Cont, Default.
WEIGHTS = {
    "pursuit_gain": {"DorsAttn": 1.0, "Vis": 1.0},
    "antisaccade_err": {"Cont": 1.0, "DorsAttn": 1.0},
    "saccade_latency": {"DorsAttn": 1.0, "SalVentAttn": 1.0},
    "speech_rate": {"SomMot": 1.0, "SalVentAttn": 1.0},
    "recall_delayed": {"Default": 1.0, "Limbic": 1.0},
    "symptom_total": {"Limbic": 1.0, "Default": 1.0, "Cont": 1.0},
}
# Speech is left lateralized in most people, so its left hemisphere regions count more.
LEFT_HEAVY = {"speech_rate": 1.5}


def enabled() -> bool:
    """True when REGIONAL_LOADINGS is set. The global damage path stays the default."""
    return os.environ.get("REGIONAL_LOADINGS", "0") not in ("0", "", "false", "False", "no")


_CACHE: np.ndarray | None = None


def matrix() -> np.ndarray:
    """Signal by region weights, each row non-negative and summing to 1.

    A region's weight is its network's weight, times 1.5 on the left for a lateralized
    signal, times the region's own structural strength so a hub counts for more than a
    sliver. Then the row is normalized.
    """
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    tpl = templates()
    names = [str(n) for n in tpl["names"]]
    nets = net_ids(names)
    from ..data.templates import NETS

    strength = tpl["sc"].sum(axis=1)
    strength = strength / (strength.mean() or 1.0)
    left = np.array([1.0 if "LH" in n else 0.0 for n in names])

    rows = []
    for key in keys():
        want = WEIGHTS[key]
        w = np.zeros(len(names))
        for net, val in want.items():
            w[nets == NETS.index(net)] = float(val)
        if key in LEFT_HEAVY:
            w = w * np.where(left > 0, LEFT_HEAVY[key], 1.0)
        w = w * strength
        total = float(w.sum())
        rows.append(w / total if total > 1e-12 else np.full(len(names), 1.0 / len(names)))
    _CACHE = np.vstack(rows)
    return _CACHE


def keys() -> list[str]:
    """Signal keys in the forecast's own OBS order, so rows line up with observables."""
    from . import forecast as fcast

    return [o["key"] for o in fcast.OBS]


def d_per_signal(dreg: np.ndarray) -> np.ndarray:
    """One week zero damage level per signal from the per region damage map, length 6."""
    return matrix() @ np.asarray(dreg, dtype=float)


def payload() -> dict:
    """The Loadings contract object."""
    mat = matrix()
    return {
        "signals": keys(),
        "weights": {key: [round(float(v), 6) for v in mat[i]] for i, key in enumerate(keys())},
        "note": NOTE,
    }
