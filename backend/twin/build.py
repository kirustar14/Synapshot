"""Personalize a twin for one patient and write params, forecast and twin JSON to the DB."""

import numpy as np

from .. import db
from ..data import synthetic as syn
from ..data import upload
from ..data.templates import NETS, ei_map, short_names, templates
from . import dmf, enkf, forecast as fcast, loadings, priors, strain

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
    if loadings.enabled():
        state["d0_vec"] = loadings.d_per_signal(region_damage(dmg0))
    post = enkf.params(state)

    widen = WIDEN if low_fidelity else 1.0
    fore = fcast.signals(state["ens"], level_of(state), obs_rows=db.observations(pid), widen=widen)
    twin = twin_json(dmg0, ei, state, sc=sc, gval=float(gfit["G"]))

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
                               # The brain as built, kept so a check-in can be compared
                               # against where the patient started rather than replacing
                               # the only copy of it. Written once, never rewritten.
                               "baseline": twin,
                               "baseline_at": db.now(),
                               "timepoints": [],
                           })})
    db.event(pid, "twin_built", {"G": params["G"], "fc_fit": fc_fit, "low_fidelity": low_fidelity})
    return {"params": params, "forecast": fore, "twin": twin, "fc_fit": fc_fit, "low_fidelity": low_fidelity}


# What counts as a region having moved, for the banner after a call.
#
# Deliberately an order of magnitude under the 0.01 the report counts against. One week
# of filtering in steady state moves a region by about 0.002 to 0.004 on a damage scale
# that sits near 0.25, so a floor of 0.01 reports every ordinary call as no change at
# all. That is not nothing happening, it is the filter tightening by a believable amount,
# and the banner says "small change" rather than pretending it was large.
MOVED_FLOOR = 0.001


def region_diff(old: dict | None, new: dict, week: int, floor: float = MOVED_FLOOR) -> list[dict]:
    """Regions whose damage at `week` moved by more than `floor`, worst move first.

    Full readable name and network on every row, never "left cortex" on its own: two
    different parcels share that short name and a list that cannot tell them apart is
    not telling anybody anything.
    """
    if not old:
        return []

    def at(region: dict) -> float:
        series = region.get("damage") or [0.0]
        return float(series[min(max(week, 0), len(series) - 1)])

    was = {int(r["id"]): at(r) for r in old.get("regions", [])}
    out = []
    for r in new.get("regions", []):
        rid = int(r["id"])
        if rid not in was:
            continue
        now = at(r)
        if abs(now - was[rid]) <= floor:
            continue
        out.append({"id": rid, "name": str(r["name"]), "network": str(r.get("network") or ""),
                    "before": round(was[rid], 4), "after": round(now, 4)})
    out.sort(key=lambda r: abs(r["after"] - r["before"]), reverse=True)
    return out


def refresh_twin(pid: str) -> dict:
    """Recompute the regions from the current filter state, and store them.

    This is what makes the brain move after a check-in. `assimilate` updates the filter
    and rebuilds the forecast, but the twin, which is what the 3D view actually draws,
    was written once when the patient was created and never again. So every chart on the
    workspace responded to a call and the brain did not: a hundred regions, none of them
    moving, for the life of the patient. `scripts/call_update_report.py` printed 0 of 100
    regions moved, which is what sent me looking.

    Deliberately not `build_twin`. That refits G, which is the expensive part, and it
    also resets drift_z, coverage and the ensemble to their starting values, which would
    undo the update that just happened. Everything structural is recomputed here because
    it is cheap and comes from the patient's own record. The only thing that has actually
    changed is the ensemble, and that is what moves the per region damage curves.
    """
    row = db.patient(pid)
    if row is None:
        raise KeyError(f"no patient {pid}")
    pat = bundle(row)
    tpl = templates()
    template_only = bool(row["template_only"])

    bio = db.dec(row["biomarkers"], pat["biomarkers"])
    injury = db.dec(row["injury"], pat["injury"])
    zbio = float(0.5 * (bio["gfap_z"] + bio["uchl1_z"]))
    ei = ei_map(zbio)

    params = db.dec(row["params"], {}) or {}
    eps = float(params.get("eps") or np.exp(priors.HYPER["mu_eps"]))
    severity = float(np.clip(0.45 + 0.2 * zbio, 0.05, 1.0))
    strains = strain.strain(injury["angle_deg"], injury["location"], injury["helmet"], severity)
    dmg0 = strain.damage0(strains, eps, zbio)

    sc = tpl["sc"] if template_only else pat["sc"]
    gval = float(params.get("G") or priors.HYPER["mu_G"])
    twin = twin_json(dmg0, ei, state_of(pid), sc=sc, gval=gval)

    got = db.twin_inputs(pid)
    payload = db.dec(got["payload"], {}) if got is not None else {}

    # The baseline is written once and never again. Before this, `twin` was the only copy
    # of the brain that existed: a check-in overwrote it, all hundred regions moved at
    # once, and the state the patient was built from could not be got back. Nothing was
    # deleted, but nothing could be compared against either, which is what made a call
    # look like it had replaced the patient rather than added to them.
    if not payload.get("baseline"):
        payload["baseline"] = payload.get("twin") or twin
        payload["baseline_at"] = payload.get("baseline_at") or db.now()

    payload["twin"] = twin
    db.put("twin_inputs", {"id": db.new_id("tin"), "patient_id": pid, "time": db.now(),
                           "payload": db.enc(payload)})
    return twin


def add_timepoint(pid: str, point: dict) -> list[dict]:
    """Append one check-in to the patient's history. Never rewrites an earlier one.

    The list is append only on purpose. A timepoint is what happened at a moment and
    cannot stop having happened because a later call disagreed with it.
    """
    got = db.twin_inputs(pid)
    payload = db.dec(got["payload"], {}) if got is not None else {}
    points = list(payload.get("timepoints") or [])
    if any(p.get("call_id") and p["call_id"] == point.get("call_id") for p in points):
        return points
    points.append(point)
    payload["timepoints"] = points
    db.put("twin_inputs", {"id": db.new_id("tin"), "patient_id": pid, "time": db.now(),
                           "payload": db.enc(payload)})
    return points


def baseline_of(pid: str) -> dict | None:
    """The brain as it was first built, or None when the patient predates the baseline."""
    got = db.twin_inputs(pid)
    if got is None:
        return None
    return (db.dec(got["payload"], {}) or {}).get("baseline")


def timepoints_of(pid: str) -> list[dict]:
    """Every check-in appended to this patient, oldest first."""
    got = db.twin_inputs(pid)
    if got is None:
        return []
    return list((db.dec(got["payload"], {}) or {}).get("timepoints") or [])


def save_state(state: dict) -> dict:
    """EnKF state as plain lists for sqlite."""
    return {
        "ens": state["ens"].tolist(),
        "disc": state["disc"].tolist(),
        "d0": state["d0"],
        "d0_vec": None if state.get("d0_vec") is None else [float(v) for v in state["d0_vec"]],
        "sd_prior_logk": state["sd_prior_logk"],
        "coverage": state["coverage"],
        "resid": state["resid"],
        "drift_hist": state["drift_hist"],
        "contraction": state["contraction"],
        "drift_z": state["drift_z"],
        "weeks": state["weeks"],
    }


def load_state(raw: dict) -> dict:
    """EnKF state back from sqlite."""
    vec = raw.get("d0_vec")
    return {
        "ens": np.asarray(raw["ens"], dtype=float),
        "disc": np.asarray(raw["disc"], dtype=float),
        "d0": float(raw["d0"]),
        "d0_vec": None if vec is None else np.asarray(vec, dtype=float),
        "sd_prior_logk": float(raw["sd_prior_logk"]),
        "coverage": raw.get("coverage", []),
        "resid": raw.get("resid", []),
        "drift_hist": raw.get("drift_hist", []),
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


def population_k() -> float:
    """Typical weekly recovery rate, for the healing layer.

    The cohort's mean estimate when there is one, otherwise the prior median
    exp(mu_k) = 0.25 per week. `recovery` is this patient's k over this number.
    """
    try:
        from . import population

        got = population.load()
        if got and got.get("k_est"):
            val = float(np.mean(got["k_est"]))
            if np.isfinite(val) and val > 1e-6:
                return val
    except Exception:
        pass
    return float(np.exp(priors.HYPER["mu_k"]))


def region_bands(dreg: np.ndarray, state: dict, wk: np.ndarray) -> dict:
    """Per region damage mean and 10th to 90th percentile across the ensemble.

    member m: D_i(t, m) = dreg_i * exp(log d0_scale_m) * (p_m + (1 - p_m)*exp(-k_m*t))
    The band is the spread over the 200 members, which is why it narrows as calls arrive
    and the filter tightens k and p.
    """
    th = state["ens"]
    k = np.exp(th[:, 0])
    p = priors.expit(th[:, 1])
    scale = np.exp(th[:, 2])
    # members by weeks
    decay = scale[:, None] * (p[:, None] + (1.0 - p[:, None]) * np.exp(-k[:, None] * wk[None, :]))
    # regions by members by weeks, clipped because damage is a fraction
    full = np.clip(dreg[:, None, None] * decay[None, :, :], 0.0, 1.0)
    return {
        "mean": full.mean(axis=1),
        "lo": np.percentile(full, 10, axis=1),
        "hi": np.percentile(full, 90, axis=1),
    }


def region_activity(sc: np.ndarray, gval: float, ei: np.ndarray, dmg0: np.ndarray,
                    decay: np.ndarray) -> np.ndarray:
    """Per region simulated activity per week, z scored against the healthy brain.

    r_i(t) = the DMF transfer function at the healthy gating value with the damaged SC,
    holding the inhibition tuned on the healthy brain. Then
    act_i(t) = (r_i(t) - r_healthy_i) / sd over all regions and weeks of that deviation

    Zero means healthy and negative means firing below normal. The deviation is
    standardized over the whole region by week block, not per week, so the layer keeps
    the regional pattern and still shows the global return toward normal as weeks pass.
    It is deliberately not standardized against the healthy spread across regions:
    feedback inhibition pins every healthy region at the same 1.2 Hz working point, so
    that spread is numerically zero and dividing by it is meaningless. See DECISIONS.md.
    Falls back to scaling the healthy rate by (1 - damage) if the solve misbehaves.
    """
    jj = dmf.fic(sc, gval, ei)
    healthy = dmf.rates_at(sc, gval, ei, j=jj)
    if not np.isfinite(healthy).all():
        dreg = region_damage(dmg0)
        return np.stack([-dreg * d for d in decay], axis=1)
    out = np.empty((sc.shape[0], len(decay)))
    for t, fac in enumerate(decay):
        dmat = strain.damage_matrix(np.clip(dmg0 * float(fac), 0.0, 1.0))
        got = dmf.rates_at(sc * (1.0 - dmat), gval, ei, j=jj)
        if not np.isfinite(got).all():
            got = healthy * (1.0 - region_damage(dmg0) * float(fac))
        out[:, t] = got - healthy
    sd = float(out.std())
    return out / (sd if sd > 1e-9 else 1.0)


NET_NAMES = {"Vis": "Visual", "SomMot": "SomMot", "DorsAttn": "DorsAttn",
             "SalVentAttn": "SalVentAttn", "Limbic": "Limbic", "Cont": "Cont",
             "Default": "Default"}


def network_name(name: str) -> str:
    """The seven network label out of a Schaefer region name."""
    for net in NETS:
        if net in str(name):
            return NET_NAMES[net]
    return "Other"


def region_xyz_safe() -> np.ndarray:
    """Surface region centroids, falling back to the MNI volume centroids."""
    try:
        from ..data import mesh as meshmod

        got = meshmod.region_xyz()
        if got.shape == (templates()["sc"].shape[0], 3):
            return got
    except Exception:
        pass
    return templates()["xyz"]


def twin_json(dmg0: np.ndarray, ei: np.ndarray, state: dict, upto: int = fcast.WEEKS,
              sc: np.ndarray | None = None, gval: float | None = None) -> dict:
    """The Twin contract object: regions, edges and top tracts over 12 weeks."""
    tpl = templates()
    names = short_names()
    post = enkf.params(state)
    wk = np.asarray(fcast.weeks(upto), dtype=float)
    sc = tpl["sc"] if sc is None else sc
    gval = float(priors.HYPER["mu_G"]) if gval is None else float(gval)

    # D(t) = D(0) * decay(t), one scalar decay shared by every edge
    decay = fcast.d_of(1.0, post["k"], post["p"], wk)
    dreg = region_damage(dmg0)
    band = region_bands(dreg, state, wk)
    act = region_activity(sc, gval, ei, dmg0, decay)
    tei = ei_map(0.0)

    # Region positions come from the surface mesh so tract endpoints land on the cortex
    # the viewer draws. The model's own edge geometry still uses the MNI volume centroids
    # in templates.py, which agree with these to about 3 mm. See DECISIONS.md.
    xyz = region_xyz_safe()
    nets = [network_name(n) for n in tpl["names"]]
    heal = round(float(post["k"] / population_k()), 3)

    regions = []
    for i in range(sc.shape[0]):
        # The ensemble mean, not dreg * decay. Those are two different formulas: the
        # decay here is built from the point estimates of k and p and leaves out the
        # damage scale, while the band is built from every member and includes it. With
        # a scale above 1 that put the whole 10th to 90th interval above the line it was
        # supposed to be an interval around, so every region on the Data tab showed a
        # number outside its own band. Taking both from the ensemble is the fix.
        dmg_i = band["mean"][i]
        regions.append({
            "id": i,
            "name": names[i],
            "hemi": str(tpl["hemi"][i]),
            "x": float(xyz[i][0]), "y": float(xyz[i][1]), "z": float(xyz[i][2]),
            "ei": float(ei[i]),
            "template_ei": float(tei[i]),
            "damage": [round(float(v), 5) for v in dmg_i],
            "damage_lo": [round(float(v), 5) for v in band["lo"][i]],
            "damage_hi": [round(float(v), 5) for v in band["hi"][i]],
            "recovery": heal,
            "network": nets[i],
            "activity": [round(float(v), 4) for v in act[i]],
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


def level_of(state: dict):
    """The damage level the forecast runs on: per signal with loadings on, else scalar."""
    vec = state.get("d0_vec")
    return state["d0"] if vec is None else vec


def rebuild_forecast(pid: str) -> dict:
    """Recompute and store the forecast from the current ensemble and observations."""
    row = db.patient(pid)
    state = state_of(pid)
    widen = WIDEN if int(row["low_fidelity"] or 0) else 1.0
    fore = fcast.signals(state["ens"], level_of(state), obs_rows=db.observations(pid),
                         widen=widen, cov=state["coverage"])
    db.put("forecasts", {"id": db.new_id("fc"), "patient_id": pid, "week": int(row["week"]),
                         "payload": db.enc(fore), "time": db.now()})
    return fore
