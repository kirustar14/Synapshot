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
    With regional loadings on, each signal reads the damage through its own region
    weights, so healing the same tract moves each signal differently and the top three
    differ per signal. With the flag off every signal shares one damage number and the
    ordering is shared, which is the honest limit the note has always carried.
    """
    from ..data.templates import short_names
    from . import loadings

    if loadings.enabled():
        return regional_attribution(pid, keep)

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


def regional_attribution(pid: str, keep: int = 3) -> list[dict]:
    """Top tracts per signal through the regional loadings.

    Healing edge e removes its damage from both endpoint regions, which changes d_s only
    through the weight that signal puts on those two regions:

        delta d_s = sum over the two endpoints r of w_sr * (damage_r - damage_r without e)

    so a tract between two regions a signal cares about scores high for that signal and
    low for one that cares about other networks.
    """
    from ..data.templates import short_names
    from . import build, loadings

    dmg, _ = damage_now(pid)
    tpl = templates()
    reg = tpl["sc"].shape[0]
    names = short_names()
    ia, ib = np.triu_indices(reg, 1)
    w = dmf.upper(tpl["sc"])

    dreg = build.region_damage(dmg)
    mat = loadings.matrix()
    base_d = mat @ dreg

    # Region strength denominators, the same ones region_damage divides by.
    den = np.zeros(reg)
    np.add.at(den, ia, w)
    np.add.at(den, ib, w)
    den = np.where(den < 1e-12, 1e-12, den)

    # Healing edge e drops w_e * D_e from each endpoint's numerator.
    contrib = w * dmg
    cand = np.argsort(-contrib)[: max(keep * 4, 24)]

    out = []
    for i, o in enumerate(fcast.OBS):
        scores = []
        for e in cand:
            a, b = int(ia[e]), int(ib[e])
            alt = np.array(dreg)
            alt[a] = max(0.0, dreg[a] - contrib[e] / den[a])
            alt[b] = max(0.0, dreg[b] - contrib[e] / den[b])
            ds = float(mat[i] @ alt)
            scores.append(float(fcast.y_of(np.array([base_d[i]]))[0, i]
                                - fcast.y_of(np.array([ds]))[0, i]))
        order = np.argsort(-np.abs(scores))[:keep]
        tracts = [{"name": f"{names[ia[cand[j]]]} to {names[ib[cand[j]]]}",
                   "score": round(scores[j], 5)} for j in order]
        out.append({"signal": o["key"], "tracts": tracts,
                    "note": NOTE + ", through the regional loadings"})
    return out
