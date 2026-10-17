"""Validate input files per modality and say what each one changes in the twin."""

import json
from pathlib import Path

from ..config import cfg
from . import genotype as gt

KINDS = ["t1", "dwi", "fmri", "vcf", "labs", "injury"]

SETS = {
    "t1": "region geometry and the parcellation the twin is built on",
    "dwi": "personal structural connectivity, which sets every tract weight",
    "fmri": "empirical FC, which the global coupling G is fit to",
    "vcf": "APOE, BDNF and COMT calls, which shift the priors on k and p",
    "labs": "GFAP and UCH-L1 z scores, which shift the prior on p and the damage map",
    "injury": "impact direction and helmet, which set the initial damage map D0",
}


def dest(pid: str, kind: str, filename: str) -> Path:
    """Where an upload for this patient and modality is stored."""
    out = cfg.data_dir / "uploads" / pid
    out.mkdir(parents=True, exist_ok=True)
    return out / f"{kind}_{Path(filename).name}"


def check_nifti(path: Path, want_4d: bool = False) -> tuple[str, str]:
    """Open a NIfTI and report shape, or warn when nibabel is not installed."""
    try:
        import nibabel as nib

        img = nib.load(str(path))
        shape = tuple(int(v) for v in img.shape)
        if want_4d and len(shape) < 4:
            return "error", f"expected a 4D series, got shape {shape}"
        return "ok", f"shape {shape}"
    except ImportError:
        return "warn", "nibabel is not installed, header not read"
    except Exception as exc:
        return "error", f"could not read the volume: {exc}"


def check_t1(path: Path) -> tuple[str, str]:
    """T1: BIDS name and a readable 3D volume."""
    status, note = check_nifti(path)
    if "T1w" not in path.name:
        note += ", name is not BIDS T1w"
        status = "warn" if status == "ok" else status
    return status, note


def check_dwi(path: Path, bval: Path | None = None, bvec: Path | None = None) -> tuple[str, str]:
    """DWI: 4D volume plus bval and bvec whose shapes agree with the volume."""
    status, note = check_nifti(path, want_4d=True)
    vols = 0
    try:
        import nibabel as nib

        vols = int(nib.load(str(path)).shape[3])
    except Exception:
        vols = 0
    if bval and Path(bval).exists():
        vals = Path(bval).read_text().split()
        if vols and len(vals) != vols:
            return "error", f"bval has {len(vals)} entries for {vols} volumes"
        note += f", bval {len(vals)} entries"
    else:
        return "error", note + ", bval is missing"
    if bvec and Path(bvec).exists():
        lines = [ln.split() for ln in Path(bvec).read_text().strip().splitlines()]
        if len(lines) != 3 or (vols and any(len(ln) != vols for ln in lines)):
            return "error", f"bvec should be 3 by {vols}, got {len(lines)} by {len(lines[0]) if lines else 0}"
        note += ", bvec 3 rows"
    else:
        return "error", note + ", bvec is missing"
    return status, note


def check_fmri(path: Path, side: Path | None = None) -> tuple[str, str]:
    """fMRI: 4D volume with a TR and enough frames to estimate FC."""
    status, note = check_nifti(path, want_4d=True)
    tr, frames = None, 0
    try:
        import nibabel as nib

        img = nib.load(str(path))
        frames = int(img.shape[3]) if len(img.shape) > 3 else 0
        tr = float(img.header.get_zooms()[3]) if len(img.header.get_zooms()) > 3 else None
    except Exception:
        pass
    if side and Path(side).exists():
        meta = json.loads(Path(side).read_text() or "{}")
        tr = float(meta.get("RepetitionTime", tr or 0)) or tr
    if not tr:
        return "error", note + ", no RepetitionTime in the header or the sidecar json"
    note += f", TR {tr:.3f} s, {frames} frames"
    if frames < 20:
        return "warn", note + ", short run, FC will be noisy"
    return status, note


def check_vcf(path: Path) -> tuple[str, str]:
    """VCF: all four SNPs present."""
    try:
        got = gt.parse(path)
    except Exception as exc:
        return "error", f"could not parse the VCF: {exc}"
    if got["missing"]:
        return "warn", f"found {len(got['found'])} of 4 SNPs, missing {', '.join(got['missing'])}"
    return "ok", "all four SNPs found, nothing else read"


def check_labs(path: Path) -> tuple[str, str]:
    """Labs: a csv with a unit column stated for every marker."""
    try:
        lines = [ln for ln in Path(path).read_text().strip().splitlines() if ln.strip()]
    except Exception as exc:
        return "error", f"could not read the csv: {exc}"
    if len(lines) < 2:
        return "error", "no data rows"
    head = [h.strip().lower() for h in lines[0].split(",")]
    if "unit" not in head:
        return "error", "no unit column, units must be stated"
    if not any("gfap" in ln.lower() for ln in lines[1:]):
        return "warn", "no GFAP row found"
    return "ok", f"{len(lines) - 1} markers with units"


def check_injury(path: Path) -> tuple[str, str]:
    """Injury json: the fields the strain model needs."""
    try:
        got = json.loads(Path(path).read_text())
    except Exception as exc:
        return "error", f"could not read the json: {exc}"
    need = ["mechanism", "helmet", "angle_deg", "location", "date"]
    miss = [k for k in need if k not in got]
    if miss:
        return "error", f"missing {', '.join(miss)}"
    return "ok", f"{got['mechanism']}, helmet {got['helmet']}, {got['angle_deg']} degrees"


def validate(kind: str, path: Path, extra: dict | None = None) -> tuple[str, str]:
    """Status and note for one file of one modality."""
    extra = extra or {}
    path = Path(path)
    if not path.exists():
        return "missing", "file not found"
    if kind == "t1":
        return check_t1(path)
    if kind == "dwi":
        return check_dwi(path, extra.get("bval"), extra.get("bvec"))
    if kind == "fmri":
        return check_fmri(path, extra.get("fmri_json"))
    if kind == "vcf":
        return check_vcf(path)
    if kind == "labs":
        return check_labs(path)
    if kind == "injury":
        return check_injury(path)
    return "error", f"unknown kind {kind}"


def input_file(kind: str, path: str | Path, synthetic: bool, extra: dict | None = None) -> dict:
    """One InputFile row in the contract shape."""
    status, note = validate(kind, Path(path), extra)
    return {
        "kind": kind,
        "file": Path(path).name,
        "synthetic": bool(synthetic),
        "status": status,
        "sets": SETS[kind],
        "note": note,
    }


def synthetic_set(files: dict) -> list[dict]:
    """The full InputFile list for a synthetic patient's BIDS folder."""
    extra = {"bval": files.get("bval"), "bvec": files.get("bvec"), "fmri_json": files.get("fmri_json")}
    out = []
    for kind, key in (("t1", "t1"), ("dwi", "dwi"), ("fmri", "fmri"), ("vcf", "vcf"), ("labs", "labs"), ("injury", "injury")):
        out.append(input_file(kind, files[key], True, extra))
    return out


def template_set() -> list[dict]:
    """The InputFile list for a patient with no imaging, which runs on the template."""
    out = []
    for kind in KINDS:
        out.append({
            "kind": kind,
            "file": "",
            "synthetic": False,
            "status": "missing",
            "sets": SETS[kind],
            "note": "not uploaded, the twin falls back to the group template",
        })
    return out


def save(pid: str, kind: str, filename: str, data: bytes) -> dict:
    """Write an uploaded file to disk and validate it."""
    if kind not in KINDS:
        return {"kind": "t1", "file": filename, "synthetic": False, "status": "error", "sets": "", "note": f"unknown kind {kind}"}
    path = dest(pid, kind, filename)
    path.write_bytes(data)
    row = input_file(kind, path, False)
    if kind == "vcf" and row["status"] in ("ok", "warn"):
        # Live mode keeps the three calls and deletes the raw genome.
        gt.parse(path, discard=True)
        row["note"] += ", raw file deleted after parsing"
    return row
