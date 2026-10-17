"""Which tracts drive which signal, by finite difference on the emulator.

Always labelled a hypothesis. This twin routes every observable through one global
damage summary, so the ordering of tracts is shared across signals and only the size of
the effect differs. A tract specific readout would need a model with more than one
damage dimension.
"""

import numpy as np

from .. import db
from ..data.templates import templates
from . import build, dmf, forecast as fcast, priors, strain

NOTE = "hypothesis, from a finite difference on a one dimensional emulator"


def damage_now(pid: str) -> tuple[np.ndarray, float]:
    """Current per edge damage and the mean damage, at the patient's current week."""
    row = db.patient(pid)
    state = build.state_of(pid)
    post = {"k": float(np.exp(state["ens"][:, 0]).mean()), "p": float(priors.expit(state["ens"][:, 1]).mean())}
    bio = db.dec(row["biomarkers"], {"gfap_z": 0.0, "uchl1_z": 0.0})
    zbio = float(0.5 * (bio["gfap_z"] + bio["uchl1_z"]))
    injury = db.dec(row["injury"], {})
    eps = float(np.exp(priors.HYPER["mu_eps"]))
    severity = float(np.clip(0.45 + 0.2 * zbio, 0.05, 1.0))
    strains = strain.strain(injury.get("angle_deg", 0.0), injury.get("location", "frontal"), injury.get("helmet", "A"), severity)
    dmg0 = strain.damage0(strains, eps, zbio)
    week = float(row["week"] or 0)
    decay = float(fcast.d_of(1.0, post["k"], post["p"], np.array([week]))[0])
    dmg = dmg0 * decay
    w = dmf.upper(templates()["sc"])
    return dmg, float(np.average(dmg, weights=w))


def attribution(pid: str, keep: int = 3) -> list[dict]:
    """Top tracts per signal, scored by the change in that signal when a tract is healed.

    d_without_e = (sum_j w_j D_j - w_e D_e) / sum_j w_j
    score_s,e   = y_s(d) - y_s(d_without_e)      in that signal's own units
    """
    from ..data.templates import short_names

    dmg, d = damage_now(pid)
    tpl = templates()
    w = dmf.upper(tpl["sc"])
    tot = float(w.sum())
    names = short_names()
    ia, ib = np.triu_indices(tpl["sc"].shape[0], 1)

    drop = (w * dmg) / max(tot, 1e-12)        # how much each edge contributes to d
    order = np.argsort(-drop)[: max(keep, 8)]
    base = fcast.y_of(np.array([d]))[0]
    alt = fcast.y_of(d - drop[order])          # one row per candidate edge

    out = []
    for i, o in enumerate(fcast.OBS):
        scores = base[i] - alt[:, i]
        rank = np.argsort(-np.abs(scores))[:keep]
        tracts = []
        for j in rank:
            e = int(order[j])
            tracts.append({"name": f"{names[ia[e]]} to {names[ib[e]]}", "score": float(scores[j])})
        out.append({"signal": o["key"], "tracts": tracts, "note": NOTE})
    return out
