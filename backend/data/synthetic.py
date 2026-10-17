"""Synthetic patients. Every record carries synthetic: true, nothing here is a person."""

import json
from pathlib import Path

import numpy as np

from ..config import cfg
from ..twin import dmf, priors, strain
from . import genotype as gt
from .templates import ei_map, templates

MECHANISMS = ["football tackle", "bicycle fall", "skateboard fall", "soccer header", "car braking", "ice hockey check"]
LOCATIONS = list(strain.HITS.keys())
NAMES = [
    "Avery Stone", "Rowan Patel", "Micah Lund", "Noa Berger", "Kai Okafor", "Sasha Reyes",
    "Devin Marsh", "Imani Clarke", "Teo Vargas", "Rhea Nakamura", "Luca Bianchi", "Nadia Haddad",
]


def cohort_effects(seed: int = 1) -> dict:
    """The one set of genotype and biomarker effects the whole cohort is generated with.

    Drawn once from the hyperpriors with a fixed seed so the population layer has a
    true value to recover. See DECISIONS.md for why the seed is pinned.
    """
    return priors.draw_effects(np.random.default_rng(seed))


def make_patient(seed: int, eff: dict | None = None) -> dict:
    """A full synthetic patient: genotype, biomarkers, injury, SC, FC, params, weekly truth."""
    rng = np.random.default_rng(seed)
    tpl = templates()

    # Genotype. Carrier rate for at least one e4 allele is about 25 percent.
    draw = rng.random()
    apoe = 2 if draw < 0.02 else (1 if draw < 0.25 else 0)
    bdnf_met = bool(rng.random() < 0.3)
    comt = str(rng.choice(["Val/Val", "Val/Met", "Met/Met"], p=[0.25, 0.5, 0.25]))
    sex = "F" if rng.random() < 0.5 else "M"
    age = int(rng.integers(16, 61))

    # Biomarkers. Both load on one latent severity so they correlate with each other.
    # zbio_i   ~ Normal(0, 1)
    # gfap_z   = 0.8*zbio + Normal(0, 0.6^2)
    # uchl1_z  = 0.7*zbio + Normal(0, 0.7^2)
    zbio = float(rng.normal(0, 1))
    gfap_z = float(0.8 * zbio + rng.normal(0, 0.6))
    uchl1_z = float(0.7 * zbio + rng.normal(0, 0.7))

    injury = {
        "mechanism": str(rng.choice(MECHANISMS)),
        "helmet": "A" if rng.random() < 0.5 else "B",
        "angle_deg": float(round(rng.uniform(0, 90), 1)),
        "location": str(rng.choice(LOCATIONS)),
        "date": week0_date(rng),
        "loc": bool(rng.random() < 0.35),
    }

    geno = {"apoe_e4": apoe, "bdnf_met": bdnf_met, "comt": comt}
    par = priors.draw_params(rng, geno, zbio, sex, eff if eff is not None else cohort_effects())

    # Personal SC: template times lognormal edge noise, symmetric.
    # sc_ij = tpl_ij * exp(Normal(0, 0.2^2)) , same draw for ij and ji
    noise = rng.normal(0, 0.2, tpl["sc"].shape)
    noise = 0.5 * (noise + noise.T)
    sc = tpl["sc"] * np.exp(noise)
    np.fill_diagonal(sc, 0.0)

    ei = ei_map(zbio)

    severity = float(np.clip(0.45 + 0.2 * zbio + 0.15 * rng.normal(), 0.05, 1.0))
    strains = strain.strain(injury["angle_deg"], injury["location"], injury["helmet"], severity)
    dmg0 = strain.damage0(strains, par["eps"], zbio)
    d0 = mean_damage(dmg0)

    fc_emp = dmf.fc_emp_of(sc, par["G"], ei=ei, seed=seed)
    truth = weekly_truth(d0, par["k"], par["p"], seed)

    return {
        "seed": int(seed),
        "name": NAMES[seed % len(NAMES)],
        "age": age,
        "sex": sex,
        "synthetic": True,
        "alleles": geno,
        "biomarkers": {"gfap_z": round(gfap_z, 2), "uchl1_z": round(uchl1_z, 2)},
        "zbio": round(zbio, 3),
        "severity": round(severity, 3),
        "injury": injury,
        "params_true": par,
        "d0_true": float(d0),
        "dmg0": dmg0,
        "sc": sc,
        "ei": ei,
        "fc_emp": fc_emp,
        "truth": truth,
    }


def mean_damage(dmg: np.ndarray) -> float:
    """SC weighted mean damage over edges.

    d = sum_ij w_ij D_ij / sum_ij w_ij , w = template SC upper triangle
    Weighting by the tract that is there, because a pair of regions with no connection
    between them should not dilute the average. See DECISIONS.md.
    """
    w = dmf.upper(templates()["sc"])
    return float(np.average(dmg, weights=w))


def weekly_truth(d0: float, k: float, p: float, seed: int, upto: int = 12) -> dict:
    """Weeks 0 to 12 of true observables with measurement noise, keyed by week."""
    from ..twin import forecast as fcast

    arr = fcast.truth(d0, k, p, upto=upto, seed=seed, noise=True)
    return {int(w): {o["key"]: float(arr[w, i]) for i, o in enumerate(fcast.OBS)} for w in range(upto + 1)}


def week0_date(rng: np.random.Generator) -> str:
    """An injury date a few weeks back, as an ISO day."""
    import datetime as dt

    base = dt.date(2026, 1, 5) + dt.timedelta(days=int(rng.integers(0, 240)))
    return base.isoformat()


def nifti(path: Path, shape: tuple, seed: int, tr: float | None = None) -> None:
    """Write a tiny but valid NIfTI, or a text placeholder when nibabel is missing."""
    rng = np.random.default_rng(seed)
    data = rng.normal(100, 10, shape).astype(np.float32)
    try:
        import nibabel as nib

        img = nib.Nifti1Image(data, np.diag([2.0, 2.0, 2.0, 1.0]))
        if tr is not None:
            img.header["pixdim"][4] = tr
            img.header.set_xyzt_units("mm", "sec")
        nib.save(img, str(path))
    except Exception:
        path.with_suffix(".txt").write_text(f"placeholder volume shape={shape} tr={tr}\n")


def write_bids(pat: dict, root: Path | None = None) -> dict:
    """Write a BIDS style folder for one synthetic patient and return the file list."""
    root = Path(root or cfg.data_dir / "synthetic")
    sub = f"sub-{pat['seed']:03d}"
    base = root / sub
    (base / "anat").mkdir(parents=True, exist_ok=True)
    (base / "dwi").mkdir(parents=True, exist_ok=True)
    (base / "func").mkdir(parents=True, exist_ok=True)
    (base / "labs").mkdir(parents=True, exist_ok=True)

    t1 = base / "anat" / f"{sub}_T1w.nii.gz"
    dwi = base / "dwi" / f"{sub}_dwi.nii.gz"
    func = base / "func" / f"{sub}_task-rest_bold.nii.gz"
    nifti(t1, (8, 8, 8), pat["seed"])
    nifti(dwi, (6, 6, 6, 10), pat["seed"] + 1)
    nifti(func, (6, 6, 6, 20), pat["seed"] + 2, tr=0.72)

    # bval and bvec for 10 volumes, one b0 then nine directions.
    rng = np.random.default_rng(pat["seed"] + 3)
    vecs = rng.normal(0, 1, (3, 9))
    vecs = vecs / np.linalg.norm(vecs, axis=0, keepdims=True)
    vecs = np.hstack([np.zeros((3, 1)), vecs])
    (base / "dwi" / f"{sub}_dwi.bval").write_text(" ".join(["0"] + ["1000"] * 9) + "\n")
    (base / "dwi" / f"{sub}_dwi.bvec").write_text(
        "\n".join(" ".join(f"{v:.4f}" for v in row) for row in vecs) + "\n"
    )
    (base / "func" / f"{sub}_task-rest_bold.json").write_text(
        json.dumps({"RepetitionTime": 0.72, "TaskName": "rest", "synthetic": True}, indent=2)
    )
    vcf = base / f"{sub}.vcf"
    gt.write_vcf(vcf, pat["alleles"]["apoe_e4"], pat["alleles"]["bdnf_met"], pat["alleles"]["comt"], sub)
    labs = base / "labs" / "biomarkers.csv"
    labs.write_text(
        "marker,value,unit,z,synthetic\n"
        f"GFAP,{max(0.0, 120 + 60 * pat['biomarkers']['gfap_z']):.1f},pg/mL,{pat['biomarkers']['gfap_z']},true\n"
        f"UCH-L1,{max(0.0, 290 + 140 * pat['biomarkers']['uchl1_z']):.1f},pg/mL,{pat['biomarkers']['uchl1_z']},true\n"
    )
    inj = base / "injury.json"
    inj.write_text(json.dumps({**pat["injury"], "synthetic": True}, indent=2))
    (base / f"{sub}_scans.json").write_text(json.dumps({"synthetic": True, "seed": pat["seed"]}, indent=2))

    return {
        "dir": str(base),
        "t1": str(t1),
        "dwi": str(dwi),
        "bval": str(base / "dwi" / f"{sub}_dwi.bval"),
        "bvec": str(base / "dwi" / f"{sub}_dwi.bvec"),
        "fmri": str(func),
        "fmri_json": str(base / "func" / f"{sub}_task-rest_bold.json"),
        "vcf": str(vcf),
        "labs": str(labs),
        "injury": str(inj),
    }
