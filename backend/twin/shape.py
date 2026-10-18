"""Per person visual deformation of the cortical mesh.

This is what lets the viewer morph the template brain into this patient. Every number is
illustrative: the synthetic T1 is an 8 cubed placeholder volume, not a segmentation, so
the regional thickness scores are drawn from the patient's seed rather than measured. The
shape is driven by age, sex, regional volumes and the injury, and nothing else.

DNA does not change the shape of a brain and nothing here claims it does. The genotype
enters the recovery rate and the uncertainty, which is the healing layer, not the anatomy.
See DECISIONS.md.
"""

import numpy as np

from .. import db
from ..config import cfg
from ..data import mesh as meshmod
from ..data import synthetic as syn
from ..data.templates import templates
from . import forecast as fcast, priors, strain

AMP0 = 3.0          # mm of swelling at the impact site for a full severity injury
RADIUS_MM = 25.0    # the impact bump reaches this far across the surface
ATROPHY_MAX = 0.04  # the oldest patient blends 4 percent toward the inflated surface
THICK_GAIN = 0.4    # mm of displacement along the normal per unit thickness z score
WEEKS = fcast.WEEKS


def _normals(pos: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Area weighted vertex normals, the same thing computeVertexNormals gives."""
    tri = pos[faces]
    face_n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    out = np.zeros_like(pos)
    for col in range(3):
        np.add.at(out, faces[:, col], face_n)
    norm = np.linalg.norm(out, axis=1, keepdims=True)
    return out / np.where(norm < 1e-9, 1e-9, norm)


def _freesurfer_base(pid: str) -> np.ndarray | None:
    """The subject's own pial surface if one was uploaded, else None.

    Nothing in the UI writes here yet, so in practice every patient is synthetic. The
    path exists so a real FreeSurfer run can be dropped in without a code change: put
    lh.pial and rh.pial in data/uploads/<patient id>/surf/ and the vertex counts must
    match fsaverage6. See DECISIONS.md.
    """
    base = cfg.data_dir / "uploads" / pid / "surf"
    left, right = base / "lh.pial", base / "rh.pial"
    if not (left.exists() and right.exists()):
        return None
    try:
        import nibabel.freesurfer as fsio

        lv, _ = fsio.read_geometry(str(left))
        rv, _ = fsio.read_geometry(str(right))
        pos = np.vstack([np.asarray(lv, dtype=float), np.asarray(rv, dtype=float)])
        if pos.shape != meshmod.arrays()["pial"].shape:
            return None
        return pos - pos.mean(axis=0)
    except Exception:
        return None


def thick_z(seed: int, dreg: np.ndarray) -> np.ndarray:
    """Per region thickness z score: a draw plus a loss correlated with that region's damage.

    thick_z_i = Normal(0, 1) - 1.5 * (damage_i - mean damage)
    The second term is what makes the damaged side of the brain visibly thinner, so the
    personalization slider shows something tied to the injury rather than pure noise.
    """
    rng = np.random.default_rng(int(seed) + 991)
    base = rng.normal(0, 1, dreg.shape[0])
    return base - 1.5 * (dreg - float(dreg.mean()))


def impact_dir(location: str, angle_deg: float) -> np.ndarray:
    """Unit vector from the head centre toward the impact site on the surface.

    strain.HITS points from the blow into the head, so the site is the other way. The
    same rotation about z that strain.py applies for obliquity is applied here, so the
    marker and the tract damage come from one impact.
    """
    hit = np.asarray(strain.HITS.get(location, strain.HITS["frontal"]), dtype=float)
    ang = np.radians(float(angle_deg))
    rot = np.array([[np.cos(ang), -np.sin(ang), 0.0],
                    [np.sin(ang), np.cos(ang), 0.0],
                    [0.0, 0.0, 1.0]])
    out = -(rot @ hit)
    return out / (np.linalg.norm(out) + 1e-9)


def impact_of(pos: np.ndarray, location: str, angle_deg: float, severity: float) -> dict:
    """The impact vertex, its point, the radius and the weekly swelling.

    amp[t] = AMP0 * severity * exp(-0.5 * t), t in weeks, so the swelling settles over
    about three weeks the way acute oedema does.
    """
    want = impact_dir(location, angle_deg)
    unit = pos / np.where(np.linalg.norm(pos, axis=1, keepdims=True) < 1e-9, 1e-9,
                          np.linalg.norm(pos, axis=1, keepdims=True))
    vert = int(np.argmax(unit @ want))
    weeks = np.arange(WEEKS + 1, dtype=float)
    amp = AMP0 * float(severity) * np.exp(-0.5 * weeks)
    return {
        "vertex": vert,
        "point": [round(float(v), 2) for v in pos[vert]],
        "radius": RADIUS_MM,
        "amp": [round(float(v), 4) for v in amp],
    }


def deform(pos: np.ndarray, infl: np.ndarray, normals: np.ndarray, lab: np.ndarray,
           scale: np.ndarray, atrophy: float, tz: np.ndarray, bump: float,
           impact_pt: np.ndarray) -> np.ndarray:
    """This patient's surface. The same formula the vertex shader runs, kept in step.

    pos = mix(pial, inflated, atrophy)
    pos = pos * scale
    pos = pos + normal * thick_z[region] * THICK_GAIN
    pos = pos + normal * bump * exp(-dist^2 / (2 * radius^2))
    """
    out = pos + (infl - pos) * float(atrophy)
    out = out * np.asarray(scale, dtype=float)[None, :]
    out = out + normals * (tz[lab] * THICK_GAIN)[:, None]
    dist = np.linalg.norm(pos - np.asarray(impact_pt, dtype=float)[None, :], axis=1)
    fall = np.exp(-(dist**2) / (2.0 * RADIUS_MM**2))
    return out + normals * (float(bump) * fall)[:, None]


def region_damage0(pid: str) -> np.ndarray:
    """Per region damage at week 0 for one patient, from the stored injury and biomarkers."""
    from . import build

    row = db.patient(pid)
    bio = db.dec(row["biomarkers"], {"gfap_z": 0.0, "uchl1_z": 0.0}) or {}
    injury = db.dec(row["injury"], {}) or {}
    zbio = float(0.5 * (float(bio.get("gfap_z", 0.0)) + float(bio.get("uchl1_z", 0.0))))
    eps = float(np.exp(priors.HYPER["mu_eps"]))
    severity = float(np.clip(0.45 + 0.2 * zbio, 0.05, 1.0))
    strains = strain.strain(float(injury.get("angle_deg", 0.0)), str(injury.get("location", "frontal")),
                            str(injury.get("helmet", "A")), severity)
    return build.region_damage(strain.damage0(strains, eps, zbio))


def shape_of(pid: str) -> dict:
    """The Shape contract object for one patient."""
    row = db.patient(pid)
    if row is None:
        raise KeyError(f"no patient {pid}")
    seed = int(row["seed"] or 0)
    age = int(row["age"] or 30)
    sex = str(row["sex"] or "M")
    bio = db.dec(row["biomarkers"], {"gfap_z": 0.0, "uchl1_z": 0.0}) or {}
    injury = db.dec(row["injury"], {}) or {}
    zbio = float(0.5 * (float(bio.get("gfap_z", 0.0)) + float(bio.get("uchl1_z", 0.0))))
    severity = float(np.clip(0.45 + 0.2 * zbio, 0.05, 1.0))

    arr = meshmod.arrays()
    own = _freesurfer_base(pid)
    pial = own if own is not None else arr["pial"]
    source = "freesurfer" if own is not None else "synthetic"
    infl, faces, lab = arr["inflated"], arr["faces"], arr["labels"]
    normals = _normals(pial, faces)

    # s = 1 + 0.03 * sex_sign + Normal(0, 0.02^2), then a small per axis wobble so no two
    # brains are the same shape. Male is +1, female is -1.
    rng = np.random.default_rng(seed + 313)
    sex_sign = 1.0 if sex == "M" else -1.0
    s = 1.0 + 0.03 * sex_sign + float(rng.normal(0, 0.02))
    scale = np.array([s, s, s]) * (1.0 + rng.normal(0, 0.012, 3))
    atrophy = float(np.clip((age - 30) / 60.0, 0.0, 1.0) * ATROPHY_MAX)

    dreg = region_damage0(pid)
    tz = thick_z(seed, dreg)
    impact = impact_of(pial, str(injury.get("location", "frontal")),
                       float(injury.get("angle_deg", 0.0)), severity)

    moved = deform(pial, infl, normals, lab, scale, atrophy, tz,
                   impact["amp"][0], np.asarray(impact["point"], dtype=float))
    diff = np.linalg.norm(moved - pial, axis=1)

    return {
        "scale": [round(float(v), 4) for v in scale],
        "atrophy": round(atrophy, 4),
        "thick_z": [round(float(v), 3) for v in tz],
        "impact": impact,
        "template_diff": [round(float(v), 2) for v in diff],
        "source": source,
        "mesh_source": arr["source"],
        "age": age,
        "sex": sex,
        "severity": round(severity, 3),
        "note": "Illustrative deformation. Age, sex, regional volumes and the injury set the "
                "shape. The genotype sets the recovery forecast, not the anatomy.",
    }


def personal_sc(pid: str) -> np.ndarray:
    """This patient's structural connectivity, for the template against personal layer."""
    row = db.patient(pid)
    if row is None or int(row["template_only"] or 0):
        return templates()["sc"]
    return syn.make_patient(int(row["seed"] or 0))["sc"]
