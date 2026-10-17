"""Personalize a twin for one patient and write params, forecast and twin JSON to the DB."""

import numpy as np

from .. import db
from ..data import synthetic as syn
from ..data import upload
from ..data.templates import ei_map, short_names, templates
from . import dmf, enkf, forecast as fcast, priors, strain, surrogate as sg

LOW_FIT = 0.3     # below this FC fit the twin is flagged low fidelity
WIDEN = 1.3       # band widening factor for a low fidelity twin
EDGES_OUT = 200   # edges sent to the frontend, the most damaged ones, see DECISIONS.md


def bundle(row) -> dict:
    """Regenerate the synthetic source bundle for a patient from its seed.

    The arrays are reproducible from one integer, so nothing big is stored in sqlite.
    """
    return syn.make_patient(int(row["seed"]))


def inputs_for(pid: str, pat: dict, template_only: bool) -> list[dict]:
    """InputFile list: real uploads if there are any, else the synthetic set or template."""
    got = db.uploads(pid)
    if got:
        return [
            {"kind": r["kind"], "file": r["file"], "synthetic": bool(r["synthetic"]),
             "status": r["status"], "sets": r["sets"], "note": r["note"]}
            for r in got
        ]
    if template_only:
        return upload.template_set()
    return upload.synthetic_set(syn.write_bids(pat))


def build_twin(pid: str, template_only: bool | None = None) -> dict:
    """Fit G, set the priors, build D0 and the ensemble, store the first forecast."""
    row = db.patient(pid)
    if row is None:
        raise KeyError(f"no patient {pid}")
    pat = bundle(row)
    tpl = templates()
    if template_only is None:
        template_only = bool(row["template_only"])

    geno = db.dec(row["alleles"], pat["alleles"])
    bio = db.dec(row["biomarkers"], pat["biomarkers"])
    injury = db.dec(row["injury"], pat["injury"])
    sex = str(row["sex"])
    zbio = float(0.5 * (bio["gfap_z"] + bio["uchl1_z"]))
    ei = ei_map(zbio)

    # Template only patients have no personal DWI or fMRI, so there is nothing to fit.
    if template_only:
        sc = tpl["sc"]
        gfit = {"G": priors.HYPER["mu_G"], "fit": None}
        fc_fit = None
    else:
        sc = pat["sc"]
        gfit = dmf.fit_G(sc, pat["fc_emp"], ei=ei)
        fc_fit = float(gfit["fit"])

    low_fidelity = bool(fc_fit is not None and fc_fit < LOW_FIT) or template_only

    # The twin does not know the true strain threshold, so it uses the prior median.
    eps = float(np.exp(priors.HYPER["mu_eps"]))
    severity = float(np.clip(0.45 + 0.2 * zbio, 0.05, 1.0))
    strains = strain.strain(injury["angle_deg"], injury["location"], injury["helmet"], severity)
    dmg0 = strain.damage0(strains, eps, zbio)
    d0 = syn.mean_damage(dmg0)

    rng = np.random.default_rng(int(row["seed"]) + 77)
    state = enkf.init(rng, geno, zbio, sex, d0)
    post = enkf.params(state)

    widen = WIDEN if low_fidelity else 1.0
    fore = fcast.signals(state["ens"], d0, obs_rows=db.observations(pid), widen=widen)
    twin = twin_json(dmg0, ei, state, d0)

    params = {"G": float(gfit["G"]), "k": post["k"], "p": post["p"], "eps": eps}
    db.patch("patients", pid, {
        "params": db.enc(params),
        "fc_fit": fc_fit,
        "low_fidelity": int(low_fidelity),
        "template_only": int(template_only),
        "twin_built": 1,
        "d0": d0,
        "coverage": 0.0,
        "drift_z": 0.0,
        "contraction": db.enc(state["contraction"]),
        "state": db.enc(save_state(state)),
        "truth": db.enc(pat["truth"]),
    })
    db.put("parameters", {"id": db.new_id("par"), "patient_id": pid, "week": int(row["week"]),
                          "payload": db.enc({"params": params, "post": post, "d0": d0}), "time": db.now()})
    db.put("forecasts", {"id": db.new_id("fc"), "patient_id": pid, "week": int(row["week"]),
                         "payload": db.enc(fore), "time": db.now()})
    db.put("twin_inputs", {"id": db.new_id("tin"), "patient_id": pid, "time": db.now(),
                           "payload": db.enc({
                               "inputs": inputs_for(pid, pat, template_only),
                               "fc_fit": fc_fit,
                               "low_fidelity": low_fidelity,
                               "template_only": template_only,
                               "sources": tpl["source"],
                               "twin": twin,
                           })})
    db.event(pid, "twin_built", {"G": params["G"], "fc_fit": fc_fit, "low_fidelity": low_fidelity})
    return {"params": params, "forecast": fore, "twin": twin, "fc_fit": fc_fit, "low_fidelity": low_fidelity}


def save_state(state: dict) -> dict:
    """EnKF state as plain lists for sqlite."""
    return {
        "ens": state["ens"].tolist(),
        "disc": state["disc"].tolist(),
        "d0": state["d0"],
        "sd_prior_logk": state["sd_prior_logk"],
        "coverage": state["coverage"],
        "resid": state["resid"],
        "contraction": state["contraction"],
        "drift_z": state["drift_z"],
        "weeks": state["weeks"],
    }


def load_state(raw: dict) -> dict:
    """EnKF state back from sqlite."""
    return {
        "ens": np.asarray(raw["ens"], dtype=float),
        "disc": np.asarray(raw["disc"], dtype=float),
        "d0": float(raw["d0"]),
        "sd_prior_logk": float(raw["sd_prior_logk"]),
        "coverage": raw.get("coverage", []),
        "resid": raw.get("resid", []),
        "contraction": raw.get("contraction", {"k": 0.0}),
        "drift_z": float(raw.get("drift_z", 0.0)),
        "weeks": raw.get("weeks", []),
    }


def state_of(pid: str) -> dict:
    """Current EnKF state for a patient, rebuilding the twin first if needed."""
    row = db.patient(pid)
    raw = db.dec(row["state"])
    if not raw:
        build_twin(pid)
        row = db.patient(pid)
        raw = db.dec(row["state"])
    return load_state(raw)


def region_damage(dmg0: np.ndarray) -> np.ndarray:
    """Per region damage at week 0: SC weighted mean of the damage on incident edges."""
    tpl = templates()
    reg = tpl["sc"].shape[0]
    ia, ib = np.triu_indices(reg, 1)
    w = dmf.upper(tpl["sc"])
    num = np.zeros(reg)
    den = np.zeros(reg)
    np.add.at(num, ia, w * dmg0)
    np.add.at(num, ib, w * dmg0)
    np.add.at(den, ia, w)
    np.add.at(den, ib, w)
    return num / np.where(den < 1e-12, 1e-12, den)


def twin_json(dmg0: np.ndarray, ei: np.ndarray, state: dict, d0: float, upto: int = fcast.WEEKS) -> dict:
    """The Twin contract object: regions, edges and top tracts over 12 weeks."""
    tpl = templates()
    names = short_names()
    post = enkf.params(state)
    wk = np.asarray(fcast.weeks(upto), dtype=float)

    # D(t) = D(0) * decay(t), one scalar decay shared by every edge
    decay = fcast.d_of(1.0, post["k"], post["p"], wk)
    dreg = region_damage(dmg0)
    # Activity proxy, 1 is healthy:
    # act_i(t) = rate(d(t)) / rate(0) * (1 - 0.5 * D_i(t))
    rate = sg.z_of(d0 * decay)[..., sg.index_of("rate")] / sg.z_of(0.0)[sg.index_of("rate")]
    tei = ei_map(0.0)

    regions = []
    for i in range(tpl["sc"].shape[0]):
        dmg_i = dreg[i] * decay
        regions.append({
            "id": i,
            "name": names[i],
            "hemi": str(tpl["hemi"][i]),
            "x": float(tpl["xyz"][i][0]), "y": float(tpl["xyz"][i][1]), "z": float(tpl["xyz"][i][2]),
            "ei": float(ei[i]),
            "template_ei": float(tei[i]),
            "damage": [float(v) for v in dmg_i],
            "activity": [float(rate[t] * (1.0 - 0.5 * dmg_i[t])) for t in range(len(wk))],
        })

    tw = dmf.upper(tpl["sc"])
    order = np.argsort(-dmg0 * (tw > 0))[:EDGES_OUT]
    ia, ib = np.triu_indices(tpl["sc"].shape[0], 1)
    edges = []
    for e in order:
        edges.append({
            "a": int(ia[e]), "b": int(ib[e]),
            "damage": [float(v) for v in dmg0[e] * decay],
            "template_w": float(tw[e]),
            "personal_w": float(tw[e] * (1.0 - dmg0[e])),
        })

    tops = []
    for row in strain.top_tracts(dmg0 * (tw > 0), 3):
        tops.append({
            "name": row["name"],
            "damage_w0": float(row["damage"]),
            "damage_now": float(row["damage"] * decay[-1]),
        })
    return {"weeks": [int(v) for v in wk], "regions": regions, "edges": edges, "top_tracts": tops}


def rebuild_forecast(pid: str) -> dict:
    """Recompute and store the forecast from the current ensemble and observations."""
    row = db.patient(pid)
    state = state_of(pid)
    widen = WIDEN if int(row["low_fidelity"] or 0) else 1.0
    fore = fcast.signals(state["ens"], state["d0"], obs_rows=db.observations(pid),
                         widen=widen, cov=state["coverage"])
    db.put("forecasts", {"id": db.new_id("fc"), "patient_id": pid, "week": int(row["week"]),
                         "payload": db.enc(fore), "time": db.now()})
    return fore
