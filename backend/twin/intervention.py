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


# Receptor and transporter maps, by target, with the real neuromaps annotations behind
# each one. Each entry is a list of (source, desc) tried in order; the second is a
# fallback from a different study of the same target.
#
# These were originally written from memory as a "hansen22" source with short names like
# "5ht2a". There is no such source in neuromaps: the Hansen 2022 paper is a synthesis of
# other people's PET studies, and neuromaps ships those studies individually, keyed by
# the radiotracer. The wrong keys failed silently and every map fell back to smooth
# noise, which would have made the whole drug viewer a plausible looking random number
# generator. These keys are checked against `available_annotations()`.
TARGETS = {
    # target: [(source, desc), fallback...], what the tracer binds
    "GABA-A":    [("norgaard2021", "flumazenil"), ("dukart2018", "flumazenil")],
    "NMDA":      [("galovic2021", "ge179")],
    "D1":        [("kaller2017", "sch23390")],
    "D2":        [("sandiego2015", "flb457"), ("alarkurtti2015", "raclopride")],
    "DAT":       [("dukart2018", "fpcit"), ("sasaki2012", "fepe2i")],
    "NET":       [("ding2010", "mrb"), ("hesse2017", "methylreboxetine")],
    "5-HT1A":    [("beliveau2017", "cumi101"), ("savli2012", "way100635")],
    "5-HT2A":    [("beliveau2017", "cimbi36"), ("savli2012", "altanserin")],
    "5-HTT":     [("beliveau2017", "dasb"), ("savli2012", "dasb")],
    "SV2A":      [("finnema2016", "ucbj")],
    "mGluR5":    [("smart2019", "abp688"), ("dubois2015", "abp688")],
    "mu-opioid": [("kantonen2020", "carfentanil"), ("turtonen2020", "carfentanil")],
}

# What each tracer actually is, for the Evidence drawer. A map labelled "D2" is really a
# picture of where one radioligand bound in a group of healthy volunteers, and a clinician
# looking at a drug effect should be able to see which one.
TRACER = {
    "GABA-A": "[11C]flumazenil, benzodiazepine site of the GABA-A receptor",
    "NMDA": "[18F]GE-179, open-channel NMDA receptor",
    "D1": "[11C]SCH23390, D1 receptor",
    "D2": "[11C]FLB457, high affinity D2/D3 receptor",
    "DAT": "[123I]FP-CIT, dopamine transporter",
    "NET": "[18F]MeNER, noradrenaline transporter",
    "5-HT1A": "[11C]CUMI-101, 5-HT1A receptor",
    "5-HT2A": "[11C]Cimbi-36, 5-HT2A receptor",
    "5-HTT": "[11C]DASB, serotonin transporter",
    "SV2A": "[11C]UCB-J, synaptic vesicle glycoprotein 2A",
    "mGluR5": "[11C]ABP688, metabotropic glutamate receptor 5",
    "mu-opioid": "[11C]carfentanil, mu-opioid receptor",
}

SIM_S = 20.0        # one short run per side of the comparison
HEMI_VERTS = 40962  # fsaverage6 per hemisphere, which is what the parcellation is on


def _zed(arr: np.ndarray) -> np.ndarray:
    """Z score, tolerating a constant map."""
    arr = np.asarray(arr, dtype=float)
    sd = float(np.nanstd(arr))
    return (arr - float(np.nanmean(arr))) / (sd if sd > 1e-9 else 1.0)


def _parcellate(values: np.ndarray, labels: np.ndarray, regions: int) -> np.ndarray | None:
    """Mean of a per-vertex map inside each parcel. None if any parcel is empty."""
    out = np.full(regions, np.nan)
    for i in range(regions):
        hit = values[labels == i]
        hit = hit[np.isfinite(hit)]
        if hit.size:
            out[i] = float(hit.mean())
    if not np.isfinite(out).all():
        return None
    return out


def _volume_map(source: str, desc: str, regions: int) -> np.ndarray | None:
    """One annotation parcellated from its MNI152 volume onto Schaefer-100.

    Only two of these studies ship a surface version; the rest are volumes and this is
    the only way to read them. The parcel order is the atlas's own label order, 1 to 100,
    which is the order `templates()["names"]` uses: the volumetric parcel centroids and
    `templates()["xyz"]` are the same numbers to the millimetre, which is the check that
    this is not silently permuted.
    """
    if cfg.offline:
        return None
    try:
        from neuromaps.datasets import fetch_annotation
        from nilearn import datasets as nid
        from nilearn.maskers import NiftiLabelsMasker
    except Exception:
        return None

    try:
        got = fetch_annotation(source=source, desc=desc, space="MNI152")
    except Exception:
        return None
    path = got
    if isinstance(got, dict):
        path = next((v for k, v in got.items() if k[2] == "MNI152"), None)
    if isinstance(path, (list, tuple)):
        path = path[0] if path else None
    if not path:
        return None

    try:
        atlas = nid.fetch_atlas_schaefer_2018(n_rois=regions, yeo_networks=7, resolution_mm=2)
        masker = NiftiLabelsMasker(labels_img=atlas.maps, resampling_target="labels",
                                   strategy="mean")
        vals = np.asarray(masker.fit_transform(str(path))).ravel()
    except Exception:
        return None
    if vals.size != regions or not np.isfinite(vals).any():
        return None
    return vals


def _surface_map(source: str, desc: str) -> np.ndarray | None:
    """One annotation, on fsaverage6 vertices, left hemisphere then right, or None.

    Preferred where it exists: the parcellation here is a surface parcellation, and
    neuromaps warns that several of these volumes should only be used for subcortical
    data. Only norgaard2021 and beliveau2017 publish a surface version, so most targets
    fall through to `_volume_map`.
    """
    try:
        import nibabel as nib
        from neuromaps.datasets import fetch_annotation
    except Exception:
        return None

    try:
        got = fetch_annotation(source=source, desc=desc, space="fsaverage", den="164k")
    except Exception:
        return None
    # With space and den pinned, fetch_annotation returns a list of the two hemisphere
    # files. Without them it returns a dict keyed by (source, desc, space, den).
    if isinstance(got, dict):
        pair = next((v for k, v in got.items() if k[2] == "fsaverage"), None)
    else:
        pair = got
    if not pair or len(pair) != 2:
        return None

    out = []
    for part in pair:
        try:
            img = nib.load(str(part))
            vals = np.asarray(img.agg_data(), dtype=float).ravel()
        except Exception:
            return None
        if vals.size == HEMI_VERTS:
            out.append(vals)
            continue
        small = _downsample(vals)
        if small is None:
            return None
        out.append(small)

    if len(out) != 2:
        return None
    return np.concatenate(out)


def _downsample(vals: np.ndarray) -> np.ndarray | None:
    """A 164k fsaverage map at fsaverage6's 40962 vertices.

    neuromaps resamples surfaces by shelling out to Connectome Workbench, which is a
    separate install and is not here. It does not need to be: FreeSurfer builds its
    fsaverage surfaces by recursive icosahedral subdivision, so the vertex ordering is
    nested and fsaverage6's 40962 vertices are exactly the first 40962 of fsaverage7's
    163842, in the same order. The same nesting is what made this work at fsaverage5's
    10242, and it holds at every level of the subdivision for the same reason. That was
    checked against both spheres neuromaps ships, and the largest angle between a vertex
    and its counterpart is 0.04 degrees, which is float noise.

    So this takes the value at each vertex rather than area-averaging the way
    wb_command's ADAP_BARY_AREA would. The difference matters for a sharp map; these are
    smooth PET maps that are then averaged over several hundred vertices per parcel, where
    a subsample of a smooth field is an unbiased estimate of its parcel mean.
    """
    if vals.size < HEMI_VERTS:
        return None
    # The fsaverage densities at or above fsaverage6. Anything smaller cannot be
    # subsampled up to it and is already rejected above; anything else is not an
    # fsaverage density at all, and subsampling an unknown ordering would be guessing.
    if vals.size not in (163842, HEMI_VERTS):
        return None
    return vals[:HEMI_VERTS]


def _from_neuromaps() -> tuple[dict, list[str]] | None:
    """Z scored Schaefer-100 receptor maps from neuromaps, and which tracer each used.

    Returns None only if nothing at all could be loaded. A target that fails is left out,
    so one unreachable study does not cost the other eleven.
    """
    if cfg.offline:
        return None
    try:
        from ..data import mesh as meshmod

        arrays = meshmod.arrays()
        labels = np.asarray(arrays["labels"], dtype=np.int64)
    except Exception:
        return None
    regions = int(templates()["xyz"].shape[0])
    if labels.size != 2 * HEMI_VERTS:
        return None

    out: dict = {}
    used: list[str] = []
    for name, tries in TARGETS.items():
        for source, desc in tries:
            parcel = None
            how = ""
            vals = _surface_map(source, desc)
            if vals is not None:
                parcel = _parcellate(vals, labels, regions)
                how = "fsaverage surface"
            if parcel is None:
                parcel = _volume_map(source, desc, regions)
                how = "MNI152 volume"
            if parcel is None:
                continue
            out[name] = _zed(parcel)
            used.append(f"{name}: {source} {desc}, {how}")
            break
    return (out, used) if out else None


def _synthetic_maps() -> dict:
    """Smooth random maps from a fixed seed, so the layer always has something."""
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
            cached = json.loads(path.read_text())
            if (set(cached.get("maps", {})) == set(TARGETS)
                    and all(key in cached for key in ("stand_in", "tracers", "sources"))):
                _CACHE = cached
                return _CACHE
        except Exception:
            pass

    got = _from_neuromaps()
    real, used = got if got else ({}, [])
    fake = _synthetic_maps()
    # Per target, not all or nothing: a study that will not download costs that one map.
    maps = {k: (real[k] if k in real else fake[k]) for k in TARGETS}
    stand_in = sorted(set(TARGETS) - set(real))
    _CACHE = {
        "names": list(TARGETS),
        "maps": {k: [round(float(v), 4) for v in maps[k]] for k in TARGETS},
        # True when nothing real loaded at all, which is what the old field meant.
        "synthetic_template": not real,
        # Which individual maps are stand-ins. A drug whose target is on this list is
        # being simulated against smooth noise and the screen has to say so.
        "stand_in": stand_in,
        "tracers": {k: TRACER.get(k, "") for k in real},
        "sources": used,
        "note": "Group average PET and SPECT maps from healthy volunteers, parcellated "
                "onto Schaefer-100 and z scored. Not this patient's receptors.",
    }
    try:
        path.write_text(json.dumps(_CACHE))
    except Exception:
        pass
    return _CACHE


# What used to live below here: `scaled`, `run` and `_summaries`, the Luppi style regional
# gain perturbation. It scaled each region's local recurrent weight by 1 + gain * receptor
# weight, ran the dynamic mean field model twice, and reported the difference as the effect
# of a drug. That is a treatment response prediction, and nothing in this system has the
# standing to make one, so it is gone along with the /intervention route and the Treatment
# tab's Simulate button. See DECISIONS.md.
#
# Everything above is kept because it is the receptor and transporter atlas itself, which
# the pathway viewer and the evidence drawer both still read. The atlas was never the
# problem; what was done with it was.
