"""fsaverage6 cortical surface with Schaefer-100 labels per vertex. Built by `make mesh`.

The viewer needs a real cortex, not spheres on an ellipsoid, so this loads the fsaverage6
pial and inflated surfaces (40962 vertices a hemisphere, 81924 in total) and puts a
Schaefer-100 region index on every vertex.

Labels come from the CBIG annotation files first, which are the parcellation's own
surface definition and whose region order matches the nilearn labels in templates.py
exactly, region for region. The fallback projects the nilearn volume atlas onto the pial
surface. The last resort is a procedural folded ellipsoid so OFFLINE=1 still serves
something, flagged as `source: "procedural"` so the UI can say so.

Everything here is cached to data/mesh.json, so `make seed` never refetches.
"""

import json
import urllib.request
from pathlib import Path

import numpy as np

from ..config import ROOT, cfg
from .templates import NETS, templates

HEMI_VERTS = 40962
REG = 100
ROUND = 2            # millimetre positions to 2 decimals, which halves the JSON
TIMEOUT_S = 60

# The CBIG release of the parcellation, FreeSurfer 5.3 fsaverage6 labels. The path was
# written from memory and then verified: both files download and their 100 region names
# match templates()["names"] in order, so vertex label j-1 is region j-1 of the connectome.
CBIG_URL = (
    "https://raw.githubusercontent.com/ThomasYeoLab/CBIG/master/stable_projects/"
    "brain_parcellation/Schaefer2018_LocalGlobal/Parcellations/FreeSurfer5.3/"
    "fsaverage6/label/{hemi}.Schaefer2018_100Parcels_7Networks_order.annot"
)

# Plain English area per Schaefer name token. Approximate by design: these are network
# parcels, not anatomical ones, so the tag is the lobe the parcel mostly sits in. Written
# as a reading aid for the callouts and said to be approximate on screen. See DECISIONS.md.
LOBES = {
    "Vis": "occipital",
    "SomMot": "sensorimotor",
    "DorsAttn_Post": "parietal",
    "DorsAttn_FEF": "frontal",
    "DorsAttn_PrCv": "sensorimotor",
    "SalVentAttn_FrOperIns": "insula",
    "SalVentAttn_Med": "cingulate",
    "SalVentAttn_PFCl": "frontal",
    "SalVentAttn_ParOper": "parietal",
    "SalVentAttn_TempOccPar": "temporal",
    "Limbic_OFC": "orbitofrontal",
    "Limbic_TempPole": "temporal pole",
    "Cont_Cing": "cingulate",
    "Cont_PFCl": "frontal",
    "Cont_PFCmp": "frontal",
    "Cont_Par": "parietal",
    "Cont_pCun": "parietal",
    "Default_PFC": "frontal",
    "Default_PFCdPFCm": "frontal",
    "Default_PFCv": "orbitofrontal",
    "Default_Par": "parietal",
    "Default_Temp": "temporal",
    "Default_pCunPCC": "cingulate",
}


def path_json() -> Path:
    """Where the built mesh lives."""
    return cfg.data_dir / "mesh.json"


def path_export() -> Path:
    """The copy the frontend drops into its public folder."""
    return ROOT / "exports" / "mesh.json"


def token_of(name: str) -> str:
    """The Schaefer name token, hemisphere and index stripped off.

    7Networks_LH_Default_pCunPCC_2 -> Default_pCunPCC
    """
    parts = str(name).replace("7Networks_", "").split("_")
    return "_".join(parts[1:-1]) if len(parts) > 2 else parts[1]


def lobe_of(name: str) -> str:
    """Plain English area for one region name, falling back to its network."""
    tok = token_of(name)
    if tok in LOBES:
        return LOBES[tok]
    for key, val in LOBES.items():
        if tok.startswith(key.split("_")[0]):
            return val
    return "cortex"


def network_of(name: str) -> str:
    """The seven network label out of a region name, spelled the way the UI shows it."""
    full = {"Vis": "Visual", "SomMot": "SomMot", "DorsAttn": "DorsAttn",
            "SalVentAttn": "SalVentAttn", "Limbic": "Limbic", "Cont": "Cont",
            "Default": "Default"}
    for net in NETS:
        if net in str(name):
            return full[net]
    return "Other"


# ---------------------------------------------------------------- surfaces

def _surfaces() -> dict | None:
    """fsaverage6 pial and inflated for both hemispheres, or None."""
    if cfg.offline:
        return None
    try:
        from nilearn import datasets as nid
        from nilearn import surface

        fs = nid.fetch_surf_fsaverage("fsaverage6")
        out = {}
        for key in ("pial_left", "pial_right", "infl_left", "infl_right"):
            got = surface.load_surf_mesh(fs[key])
            out[key] = (np.asarray(got.coordinates, dtype=float),
                        np.asarray(got.faces, dtype=np.int64))
        if any(v[0].shape[0] != HEMI_VERTS for v in out.values()):
            return None
        return out
    except Exception:
        return None


def _join(surf: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """One mesh out of two hemispheres: pial, inflated, faces re-indexed.

    The two inflated hemispheres each sit on the origin and would occupy the same space,
    so each is slid sideways until its medial face is at x = 0 with a 2 mm gap. Inflating
    therefore pushes the cortex outward from the midline, which is what it looks like.
    """
    pial = np.vstack([surf["pial_left"][0], surf["pial_right"][0]])
    infl_l = surf["infl_left"][0].copy()
    infl_r = surf["infl_right"][0].copy()
    infl_l[:, 0] -= infl_l[:, 0].max() + 2.0
    infl_r[:, 0] -= infl_r[:, 0].min() - 2.0
    infl = np.vstack([infl_l, infl_r])

    faces = np.vstack([surf["pial_left"][1], surf["pial_right"][1] + HEMI_VERTS])

    # Both surfaces are centred on their own centroid, so inflating expands the cortex in
    # place instead of sliding the whole brain forward and down. The inflated surface is
    # genuinely larger than the pial, which is the point of it.
    return pial - pial.mean(axis=0), infl - infl.mean(axis=0), faces


# ---------------------------------------------------------------- labels

def _annot(hemi: str) -> Path | None:
    """The cached CBIG annotation file for one hemisphere, downloading it once."""
    out = cfg.cache_dir() / f"{hemi}.Schaefer2018_100Parcels_7Networks_fsa6.annot"
    if out.exists() and out.stat().st_size > 1000:
        return out
    if cfg.offline:
        return None
    try:
        req = urllib.request.Request(CBIG_URL.format(hemi=hemi),
                                     headers={"User-Agent": "unnamed-mesh/1"})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            data = resp.read()
        if len(data) < 1000:
            return None
        out.write_bytes(data)
        return out
    except Exception:
        return None


def _labels_from_annot(names: list[str]) -> np.ndarray | None:
    """Per vertex region index from the annotation files, or None.

    Returns -1 on the medial wall. The region names in the files are checked against the
    connectome's own labels, because a silently permuted parcellation would paint damage
    on the wrong part of the brain and still look plausible.
    """
    try:
        import nibabel.freesurfer as fsio
    except Exception:
        return None

    out = []
    got_names: list[str] = []
    for j, hemi in enumerate(("lh", "rh")):
        path = _annot(hemi)
        if path is None:
            return None
        try:
            lab, _, raw = fsio.read_annot(str(path))
        except Exception:
            return None
        if lab.shape[0] != HEMI_VERTS:
            return None
        text = [n.decode() if isinstance(n, bytes) else str(n) for n in raw]
        got_names += text[1:]                       # index 0 is the medial wall
        out.append(np.where(lab > 0, lab - 1 + j * (REG // 2), -1))

    if got_names != [str(n) for n in names]:
        return None
    return np.concatenate(out).astype(np.int64)


def _labels_from_volume(pial: np.ndarray, off: np.ndarray, surf: dict) -> np.ndarray | None:
    """Fallback: project the nilearn Schaefer-100 volume atlas onto the pial surface."""
    if cfg.offline:
        return None
    try:
        from nilearn import datasets as nid
        from nilearn import surface

        atlas = nid.fetch_atlas_schaefer_2018(n_rois=REG, yeo_networks=7, resolution_mm=2)
        out = []
        for key in ("pial_left", "pial_right"):
            got = surface.vol_to_surf(
                atlas.maps, (surf[key][0], surf[key][1]),
                interpolation="nearest_most_frequent", radius=3.0,
            )
            out.append(np.asarray(got, dtype=float).ravel())
        lab = np.concatenate(out)
        del pial, off
        return np.where(np.isfinite(lab) & (lab > 0), np.nan_to_num(lab) - 1, -1).astype(np.int64)
    except Exception:
        return None


def _fill_nearest(lab: np.ndarray, pos: np.ndarray) -> np.ndarray:
    """Give every unlabelled vertex the label of the nearest labelled one.

    The medial wall is genuinely not cortex, but leaving about 1700 holes in the surface
    makes the hologram look broken, so the wall takes its neighbour's label and the UI
    says the parcellation is approximate there. See DECISIONS.md.
    """
    out = np.array(lab, dtype=np.int64)
    bad = np.flatnonzero(out < 0)
    good = np.flatnonzero(out >= 0)
    if bad.size == 0 or good.size == 0:
        return out
    try:
        from scipy.spatial import cKDTree

        _, near = cKDTree(pos[good]).query(pos[bad])
        out[bad] = out[good[near]]
        return out
    except Exception:
        for i in bad:
            out[i] = out[good[int(np.argmin(np.linalg.norm(pos[good] - pos[i], axis=1)))]]
        return out


def _borders(faces: np.ndarray, lab: np.ndarray) -> np.ndarray:
    """1 on a vertex that shares a face with a vertex of a different region, else 0.

    Every triangle whose three vertices are not all one region marks all three, which is
    a one vertex wide ring on each side of the seam. That is what the shader draws as a
    thin glowing region outline.
    """
    tri = lab[faces]
    mixed = (tri[:, 0] != tri[:, 1]) | (tri[:, 1] != tri[:, 2]) | (tri[:, 0] != tri[:, 2])
    out = np.zeros(lab.shape[0], dtype=np.int64)
    out[np.unique(faces[mixed])] = 1
    return out


def _centroids(pos: np.ndarray, lab: np.ndarray) -> np.ndarray:
    """One point per region, on the surface.

    The mean of a region's pial vertices sits up to 6 mm inside a curved parcel, which
    leaves tract endpoints floating under the cortex and fails the 5 mm check. So the
    centroid is the region's own vertex nearest that mean, which lands exactly on the
    surface. See DECISIONS.md.
    """
    out = np.zeros((REG, 3))
    for i in range(REG):
        own = pos[lab == i]
        if own.shape[0] == 0:
            out[i] = pos.mean(axis=0)
            continue
        mid = own.mean(axis=0)
        out[i] = own[int(np.argmin(np.linalg.norm(own - mid, axis=1)))]
    return out


# ---------------------------------------------------------------- procedural fallback

def _procedural() -> dict:
    """A folded ellipsoid pair with about 20k vertices, when there is no real surface.

    Two lat-lon grids, radially displaced by a few sine terms so the surface has gyri and
    sulci, labelled by angular sector. It is a stand-in and says so.
    """
    rows, cols = 72, 142                       # 2 * 72 * 142 = 20448 vertices
    u = np.linspace(0.02 * np.pi, 0.98 * np.pi, rows)
    v = np.linspace(0, 2 * np.pi, cols, endpoint=False)
    uu, vv = np.meshgrid(u, v, indexing="ij")
    fold = (1.0 + 0.035 * np.sin(9 * uu) * np.cos(7 * vv)
            + 0.025 * np.sin(13 * vv) + 0.02 * np.cos(11 * uu))
    pos, infl, faces, lab = [], [], [], []
    for h, side in enumerate((-1.0, 1.0)):
        base = h * rows * cols
        x = 30.0 * np.sin(uu) * np.cos(vv) * fold + side * 32.0
        y = 85.0 * np.cos(uu) * fold
        z = 55.0 * np.sin(uu) * np.sin(vv) * fold
        pos.append(np.stack([x.ravel(), y.ravel(), z.ravel()], axis=1))
        xi = 36.0 * np.sin(uu) * np.cos(vv) + side * 40.0
        yi = 95.0 * np.cos(uu)
        zi = 62.0 * np.sin(uu) * np.sin(vv)
        infl.append(np.stack([xi.ravel(), yi.ravel(), zi.ravel()], axis=1))
        for r in range(rows - 1):
            for c in range(cols):
                a = base + r * cols + c
                b = base + r * cols + (c + 1) % cols
                d = base + (r + 1) * cols + c
                e = base + (r + 1) * cols + (c + 1) % cols
                faces.append((a, b, d))
                faces.append((b, e, d))
        sector = (np.floor(uu / np.pi * 10) * 5 + np.floor(vv / (2 * np.pi) * 5)).astype(int)
        lab.append(np.clip(sector.ravel(), 0, 49) + h * 50)
    return {
        "pos": np.vstack(pos), "infl": np.vstack(infl),
        "faces": np.asarray(faces, dtype=np.int64), "lab": np.concatenate(lab),
        "source": "procedural",
    }


# ---------------------------------------------------------------- build

def build(force: bool = False) -> dict:
    """Build the mesh payload and write data/mesh.json plus exports/mesh.json."""
    path = path_json()
    if path.exists() and not force:
        got = json.loads(path.read_text())
        _write_export(got)
        return got

    names = [str(n) for n in templates()["names"]]
    surf = _surfaces()
    if surf is None:
        got = _procedural()
        pos, infl, faces, lab = got["pos"], got["infl"], got["faces"], got["lab"]
        source = "procedural"
    else:
        pos, infl, faces = _join(surf)
        lab = _labels_from_annot(names)
        how = "annot"
        if lab is None:
            lab = _labels_from_volume(pos, np.zeros(3), surf)
            how = "volume"
        if lab is None:
            got = _procedural()
            pos, infl, faces, lab = got["pos"], got["infl"], got["faces"], got["lab"]
            source = "procedural"
        else:
            lab = _fill_nearest(lab, pos)
            source = "fsaverage6"
            del how

    cent = _centroids(pos, lab)
    out = {
        "space": "fsaverage6" if source == "fsaverage6" else "procedural",
        "source": source,
        "verts": int(pos.shape[0]),
        "pial": [round(float(v), ROUND) for v in pos.ravel()],
        "inflated": [round(float(v), ROUND) for v in infl.ravel()],
        "faces": [int(v) for v in faces.ravel()],
        "labels": [int(v) for v in lab],
        "border": [int(v) for v in _borders(faces, lab)],
        "region_names": [n.replace("7Networks_", "") for n in names],
        "networks": [network_of(n) for n in names],
        "lobes": [lobe_of(n) for n in names],
        "region_xyz": [round(float(v), ROUND) for v in cent.ravel()],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")))
    _write_export(out)
    return out


def _write_export(payload: dict) -> None:
    """Copy the payload to exports/mesh.json for the frontend public folder."""
    try:
        out = path_export()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, separators=(",", ":")))
    except Exception:
        pass


_CACHE: dict | None = None


def mesh() -> dict:
    """The mesh payload, built on first use and held in memory after that."""
    global _CACHE
    if _CACHE is None:
        _CACHE = build()
    return _CACHE


def arrays() -> dict:
    """The mesh as numpy arrays, for shape.py and the tests."""
    got = mesh()
    return {
        "pial": np.asarray(got["pial"], dtype=float).reshape(-1, 3),
        "inflated": np.asarray(got["inflated"], dtype=float).reshape(-1, 3),
        "faces": np.asarray(got["faces"], dtype=np.int64).reshape(-1, 3),
        "labels": np.asarray(got["labels"], dtype=np.int64),
        "border": np.asarray(got["border"], dtype=np.int64),
        "region_xyz": np.asarray(got["region_xyz"], dtype=float).reshape(-1, 3),
        "source": got["source"],
    }


def region_xyz() -> np.ndarray:
    """Region centroids on the surface, in mesh space. Twin.regions[].x,y,z use these."""
    return arrays()["region_xyz"]


def main() -> int:
    """Build the mesh and print what it got. Run with `make mesh`."""
    got = build(force=True)
    lab = np.asarray(got["labels"])
    print("")
    print(f"  mesh      {got['source']}, {got['verts']} vertices, {len(got['faces']) // 3} faces")
    print(f"  labels    {len(set(lab.tolist()))} of {REG} regions present")
    print(f"  borders   {sum(got['border'])} vertices on a region seam "
          f"({sum(got['border']) / len(got['border']):.1%})")
    print(f"  lobes     {', '.join(sorted(set(got['lobes'])))}")
    print(f"  written   {path_json()}")
    print(f"            {path_export()}")
    print("")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
