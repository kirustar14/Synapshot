"""Receptor maps and the clinician-only intervention what-if.

Scope note, also in DECISIONS.md: this is a visualization of receptor weighted gain
changes in a whole brain model. It is not medication advice and not a treatment
recommendation. Medication stays out of the agent, out of the patient texts and out of
every summary. The response carries that sentence and the API test checks the forecast,
the filter, the alerts and every patient facing string never see any of it.
"""

import json

import numpy as np

from .. import db
from ..config import cfg
from ..data.templates import ei_map, templates
from . import dmf, priors, strain

NOTE = "Hypothetical what-if. Not a treatment recommendation."

# The five Hansen receptor and transporter maps the what-if offers. The neuromaps
# annotation keys were written from memory and are tried in order; any that is missing
# falls back to a fixed seed smooth random map labelled synthetic_template.
TARGETS = {
    "GABA-A": [("hansen22", "gabaa", "fMRI", "MNI152"), ("norgaard21", "flumazenil", "PET", "MNI152")],
    "NMDA": [("hansen22", "nmda", "PET", "MNI152"), ("galovic21", "ge179", "PET", "MNI152")],
    "D2": [("hansen22", "d2", "PET", "MNI152"), ("sandiego15", "flb457", "PET", "MNI152")],
    "5-HT2A": [("hansen22", "5ht2a", "PET", "MNI152"), ("beliveau17", "cimbi36", "PET", "MNI152")],
    "mu-opioid": [("hansen22", "mu", "PET", "MNI152"), ("kantonen20", "carfentanil", "PET", "MNI152")],
}
SIM_S = 20.0        # one short run per side of the comparison
GAIN_LO, GAIN_HI = -0.5, 0.5


def _zed(arr: np.ndarray) -> np.ndarray:
    """Z score, tolerating a constant map."""
    arr = np.asarray(arr, dtype=float)
    sd = float(np.nanstd(arr))
    return (arr - float(np.nanmean(arr))) / (sd if sd > 1e-9 else 1.0)


def _from_neuromaps() -> dict | None:
    """Z scored Schaefer-100 receptor maps from neuromaps, or None.

    The annotations are volumetric, so each is parcellated onto Schaefer-100 with the
    same atlas the rest of the model uses.
    """
    if cfg.offline:
        return None
    try:
        from neuromaps.datasets import fetch_annotation
        from nilearn import datasets as nid
        from nilearn.maskers import NiftiLabelsMasker

        atlas = nid.fetch_atlas_schaefer_2018(n_rois=100, yeo_networks=7, resolution_mm=2)
        masker = NiftiLabelsMasker(labels_img=atlas.maps, resampling_target="labels")
        out: dict = {}
        for name, tries in TARGETS.items():
            for source, desc, space, ref in tries:
                try:
                    got = fetch_annotation(source=source, desc=desc, space=ref, den=None)
                    path = got[0] if isinstance(got, (list, tuple)) else got
                    vals = np.asarray(masker.fit_transform(str(path))).ravel()
                    del space
                    if vals.size == 100 and np.isfinite(vals).any():
                        out[name] = _zed(vals)
                        break
                except Exception:
                    continue
            if name not in out:
                return None
        return out
    except Exception:
        return None


def _synthetic_maps() -> dict:
    """Five smooth random maps from a fixed seed, so the layer always has something."""
    from ..data.templates import _smooth_map

    xyz = templates()["xyz"]
    out = {}
    for i, name in enumerate(TARGETS):
        out[name] = _zed(_smooth_map(xyz, 4100 + i * 13, 0.0, 1.0))
    return out


_CACHE: dict | None = None


def receptors() -> dict:
    """The Receptors contract object, cached on disk and in memory."""
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    path = cfg.cache_dir() / "receptors.json"
    if path.exists():
        try:
            _CACHE = json.loads(path.read_text())
            return _CACHE
        except Exception:
            pass

    maps = _from_neuromaps()
    synthetic = maps is None
    if maps is None:
        maps = _synthetic_maps()
    _CACHE = {
        "names": list(TARGETS),
        "maps": {k: [round(float(v), 4) for v in maps[k]] for k in TARGETS},
        "synthetic_template": bool(synthetic),
        "note": "Group average maps, not this patient. Z scored across the 100 regions.",
    }
    try:
        path.write_text(json.dumps(_CACHE))
    except Exception:
        pass
    return _CACHE


def scaled(name: str) -> np.ndarray:
    """One receptor map min-max scaled to 0 to 1, the weight on the local gain."""
    got = receptors()
    if name not in got["maps"]:
        raise KeyError(name)
    arr = np.asarray(got["maps"][name], dtype=float)
    lo, hi = float(arr.min()), float(arr.max())
    return (arr - lo) / (hi - lo if hi - lo > 1e-9 else 1.0)


def run(pid: str, target: str, gain: float) -> dict:
    """Scale local gain by 1 + gain * receptor_z_scaled, run the DMF, report the change.

    Luppi style regional gain perturbation: the receptor map says where a drug acting on
    that receptor would bite hardest, and the perturbation scales each region's local
    recurrent weight by 1 + gain * weight_i. Both sides are simulated with this patient's
    structural connectivity and current damage, so the difference is the effect.
    """
    row = db.patient(pid)
    if row is None:
        raise KeyError(f"no patient {pid}")
    if target not in receptors()["maps"]:
        raise KeyError(target)

    from .attribution import damage_now
    from .shape import personal_sc

    gain = float(np.clip(gain, GAIN_LO, GAIN_HI))
    bio = db.dec(row["biomarkers"], {"gfap_z": 0.0, "uchl1_z": 0.0}) or {}
    zbio = float(0.5 * (float(bio.get("gfap_z", 0.0)) + float(bio.get("uchl1_z", 0.0))))
    params = db.dec(row["params"], {}) or {}
    gval = float(params.get("G") or priors.HYPER["mu_G"])

    dmg, _ = damage_now(pid)
    sc = personal_sc(pid) * (1.0 - strain.damage_matrix(np.clip(dmg, 0.0, 1.0)))
    base_ei = ei_map(zbio)
    pert_ei = base_ei * (1.0 + gain * scaled(target))

    base = _summaries(sc, gval, base_ei, seed=11)
    alt = _summaries(sc, gval, pert_ei, seed=11)
    effect = alt["rates"] - base["rates"]

    return {
        "target": target,
        "gain": round(gain, 4),
        "region_effect": [round(float(v), 5) for v in effect],
        "summary_delta": {
            "fc_strength": round(float(alt["fc_strength"] - base["fc_strength"]), 5),
            "rate": round(float(alt["rate"] - base["rate"]), 5),
            "metastability": round(float(alt["metastability"] - base["metastability"]), 5),
        },
        "baseline": {
            "fc_strength": round(float(base["fc_strength"]), 5),
            "rate": round(float(base["rate"]), 5),
            "metastability": round(float(base["metastability"]), 5),
        },
        "receptor": [round(float(v), 4) for v in scaled(target)],
        "synthetic_template": bool(receptors()["synthetic_template"]),
        "note": NOTE,
    }


def _summaries(sc: np.ndarray, gval: float, ei: np.ndarray, seed: int = 0) -> dict:
    """Mean FC strength, mean rate, metastability and per region rates for one setting."""
    jj = dmf.fic(sc, gval, ei)
    sim = dmf.simulate(sc, gval, ei=ei, dur_s=SIM_S, seed=seed, j=jj)
    fc = dmf.fc_lin(sc, gval, ei=ei, j=jj)
    strength = float(dmf.upper(fc).mean()) if np.isfinite(fc).all() else float(dmf.upper(dmf.fc_of(sim["bold"])).mean())
    return {
        "rates": sim["rate"].mean(axis=0),
        "rate": float(sim["rate"].mean()),
        "fc_strength": strength,
        "metastability": float(dmf.metastability(sim["bold"])),
    }
