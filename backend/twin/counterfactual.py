"""What-if forecasts: nudge the recovery rate or the residual damage and refit the bands."""

import numpy as np

from .. import db
from . import build, forecast as fcast, priors


def shift(ens: np.ndarray, k_mult: float = 1.0, p_add: float = 0.0) -> np.ndarray:
    """Ensemble with k scaled and p shifted, kept on the log and logit scales.

    log k' = log k + log(k_mult)
    p'     = clip(p + p_add, 0.001, 0.95) , logit p' = log(p' / (1 - p'))
    """
    out = np.array(ens, dtype=float)
    out[:, 0] = out[:, 0] + np.log(max(float(k_mult), 1e-6))
    p = priors.expit(out[:, 1])
    p = np.clip(p + float(p_add), 0.001, 0.95)
    out[:, 1] = np.log(p / (1.0 - p))
    return out


def forecast(pid: str, k_mult: float = 1.0, p_add: float = 0.0) -> dict:
    """Counterfactual forecast in the Forecast contract shape."""
    row = db.patient(pid)
    state = build.state_of(pid)
    widen = build.WIDEN if int(row["low_fidelity"] or 0) else 1.0
    ens = shift(state["ens"], k_mult, p_add)
    return fcast.signals(ens, state["d0"], obs_rows=db.observations(pid), widen=widen, cov=state["coverage"])


def scenario(pid: str, helmet: str, angle_deg: float) -> dict:
    """Forecast for a different impact: rebuild D0 with another helmet and angle.

    Only the initial damage changes, the recovery parameters stay at their posterior.
    """
    from ..data import synthetic as syn
    from . import strain

    row = db.patient(pid)
    state = build.state_of(pid)
    bio = db.dec(row["biomarkers"], {"gfap_z": 0.0, "uchl1_z": 0.0})
    zbio = float(0.5 * (bio["gfap_z"] + bio["uchl1_z"]))
    injury = db.dec(row["injury"], {})
    eps = float(np.exp(priors.HYPER["mu_eps"]))
    severity = float(np.clip(0.45 + 0.2 * zbio, 0.05, 1.0))
    strains = strain.strain(float(angle_deg), injury.get("location", "frontal"), str(helmet), severity)
    d0 = syn.mean_damage(strain.damage0(strains, eps, zbio))
    widen = build.WIDEN if int(row["low_fidelity"] or 0) else 1.0
    fore = fcast.signals(state["ens"], d0, obs_rows=[], widen=widen)
    return {"forecast": fore, "d0": d0}
