"""Schaefer-100 template connectivity, region geometry and group brain maps.

Every optional package is tried and never allowed to crash the import. The source of
each piece is reported in `templates()["source"]` so the API can be honest about it.
"""

import json

import numpy as np

from ..config import cfg

SEED = 7
REG = 100


def _ellipsoid_xyz() -> np.ndarray:
    """100 fallback centroids on a brain-shaped ellipsoid, left half then right half."""
    rng = np.random.default_rng(SEED)
    # Fibonacci sphere, then scaled to rough MNI half-brain extents and mirrored.
    half = REG // 2
    i = np.arange(half) + 0.5
    phi = np.arccos(1 - 2 * i / half)
    theta = np.pi * (1 + 5**0.5) * i
    ux = np.sin(phi) * np.cos(theta)
    uy = np.sin(phi) * np.sin(theta)
    uz = np.cos(phi)
    left = np.stack([-np.abs(ux) * 60 - 5, uy * 85, uz * 55], axis=1)
    left += rng.normal(0, 1.5, left.shape)
    right = left.copy()
    right[:, 0] *= -1
    return np.vstack([left, right])


def _names_fallback() -> tuple[list[str], list[str]]:
    """Fallback labels: 50 left then 50 right, seven-network style names."""
    nets = ["Vis", "SomMot", "DorsAttn", "SalVentAttn", "Limbic", "Cont", "Default"]
    names, hemi = [], []
    for h in ("LH", "RH"):
        for j in range(REG // 2):
            names.append(f"7Networks_{h}_{nets[j % len(nets)]}_{j // len(nets) + 1}")
            hemi.append(h[0])
    return names, hemi


def _distance_decay(xyz: np.ndarray, net: np.ndarray) -> np.ndarray:
    """Fallback SC: distance decay, a within-network boost, homotopic edges, 20% density.

    w_ij = exp(-d_ij / 25mm) * (1 + 1.6 * [net_i == net_j]) + 0.35 * [j == mirror(i)]
    d_ij = euclidean distance between centroids i and j in mm
    then every weight below the 80th percentile is set to 0, which is the sparsity a
    real tractogram has and what gives the FC a modular pattern rather than a blur
    """
    d = np.linalg.norm(xyz[:, None, :] - xyz[None, :, :], axis=2)
    same = (net[:, None] == net[None, :]).astype(float)
    w = np.exp(-d / 25.0) * (1.0 + 1.6 * same)
    half = REG // 2
    for i in range(half):
        w[i, i + half] += 0.35
        w[i + half, i] += 0.35
    np.fill_diagonal(w, 0.0)
    w = 0.5 * (w + w.T)
    th = np.quantile(w[np.triu_indices(REG, 1)], 0.8)
    w[w < th] = 0.0
    return w / w.max()


def _fc_from_sc(sc: np.ndarray) -> np.ndarray:
    """Fallback FC. Communicability style diffusion of SC, then correlation of its rows.

    C = expm-like series: C = sum_{m=1..3} (sc_norm)^m / m!
    fc = corrcoef(C)
    """
    s = sc / (np.linalg.norm(sc, 2) + 1e-9)
    c = s + s @ s / 2 + s @ s @ s / 6
    rng = np.random.default_rng(SEED + 1)
    c = c + rng.normal(0, 0.01, c.shape)
    fc = np.corrcoef(c)
    np.fill_diagonal(fc, 1.0)
    return fc


def _smooth_map(xyz: np.ndarray, seed: int, lo: float, hi: float) -> np.ndarray:
    """Spatially smooth random map in [lo, hi]: smooth white noise with a 30mm kernel."""
    rng = np.random.default_rng(seed)
    d = np.linalg.norm(xyz[:, None, :] - xyz[None, :, :], axis=2)
    kern = np.exp(-(d**2) / (2 * 30.0**2))
    raw = kern @ rng.normal(0, 1, REG)
    raw = (raw - raw.min()) / (raw.max() - raw.min() + 1e-9)
    return lo + raw * (hi - lo)


def _try_cubnm() -> tuple[np.ndarray | None, np.ndarray | None, np.ndarray | None]:
    """SC, FC, BOLD from cubnm for schaefer-100, or three Nones."""
    if cfg.offline:
        return None, None, None
    try:
        from cubnm import datasets

        sc = np.asarray(datasets.load_sc("strength", "schaefer-100"), dtype=float)
        fc = np.asarray(datasets.load_fc("schaefer-100"), dtype=float)
        bold = np.asarray(datasets.load_bold("schaefer-100"), dtype=float)
        if sc.ndim == 1:
            sc = sc.reshape(REG, REG)
        if fc.ndim == 1:
            # cubnm ships FC as the upper triangle vector in some versions.
            full = np.zeros((REG, REG))
            full[np.triu_indices(REG, 1)] = fc
            fc = full + full.T
            np.fill_diagonal(fc, 1.0)
        if sc.shape != (REG, REG) or fc.shape != (REG, REG):
            return None, None, None
        return sc, fc, bold
    except Exception:
        return None, None, None


def _try_nilearn() -> tuple[list[str] | None, list[str] | None, np.ndarray | None]:
    """Schaefer-100 names, hemispheres and centroids from nilearn, or three Nones."""
    if cfg.offline:
        return None, None, None
    try:
        from nilearn import datasets as nid
        from nilearn import image
        from scipy import ndimage

        atlas = nid.fetch_atlas_schaefer_2018(n_rois=REG, yeo_networks=7, resolution_mm=2)
        labels = [b.decode() if isinstance(b, bytes) else str(b) for b in atlas.labels]
        img = image.load_img(atlas.maps)
        vol = np.asarray(img.get_fdata())
        cents = ndimage.center_of_mass(vol > 0, labels=vol.astype(int), index=np.arange(1, REG + 1))
        aff = img.affine
        xyz = np.array([aff[:3, :3] @ np.array(c) + aff[:3, 3] for c in cents])
        hemi = ["L" if "LH" in lab else "R" for lab in labels]
        return labels, hemi, xyz
    except Exception:
        return None, None, None


def _try_maps(xyz: np.ndarray) -> tuple[np.ndarray | None, np.ndarray | None, str | None]:
    """Gene expression and receptor maps from ENIGMA Toolbox or neuromaps, or Nones."""
    if cfg.offline:
        return None, None, None
    try:
        from enigmatoolbox.datasets import fetch_ahba

        tab = fetch_ahba(csvfile=None)
        cols = [c for c in tab.columns if "label" not in str(c).lower()]
        sub = tab[cols].to_numpy(dtype=float)
        if sub.shape[0] < REG:
            return None, None, None
        gene = np.nanmean(sub[:REG, :], axis=1)
        gene = (gene - np.nanmin(gene)) / (np.nanmax(gene) - np.nanmin(gene) + 1e-9)
        return 0.8 + 0.4 * gene, None, "enigmatoolbox_ahba"
    except Exception:
        pass
    try:
        from neuromaps import datasets as nmd

        nmd.fetch_annotation(source="hesse2017", desc="methylreboxetine")
        return None, None, None
    except Exception:
        return None, None, None


NETS = ["Vis", "SomMot", "DorsAttn", "SalVentAttn", "Limbic", "Cont", "Default"]


def net_ids(names: list[str]) -> np.ndarray:
    """Network index 0 to 6 per region, read out of the Schaefer label text."""
    out = []
    for nm in names:
        hit = [j for j, net in enumerate(NETS) if net in nm]
        out.append(hit[0] if hit else len(NETS))
    return np.asarray(out)


_CACHE: dict | None = None


def templates() -> dict:
    """Template bundle: sc, fc, bold, names, hemi, xyz, gene, receptor, source."""
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    disk = cfg.cache_dir() / "templates.npz"
    if disk.exists():
        try:
            z = np.load(disk, allow_pickle=False)
            _CACHE = {
                "sc": z["sc"], "fc": z["fc"], "bold": z["bold"], "xyz": z["xyz"],
                "gene": z["gene"], "receptor": z["receptor"],
                "names": list(z["names"]), "hemi": list(z["hemi"]),
                "source": json.loads(str(z["source"])),
            }
            return _CACHE
        except Exception:
            pass

    source = {}
    sc, fc, bold = _try_cubnm()
    source["sc"] = "cubnm_schaefer100" if sc is not None else "distance_decay_fallback"
    source["fc"] = "cubnm_schaefer100" if fc is not None else "synthetic_template"

    names, hemi, xyz = _try_nilearn()
    source["regions"] = "nilearn_schaefer100" if names is not None else "ellipsoid_fallback"
    if xyz is None:
        xyz = _ellipsoid_xyz()
    if names is None:
        names, hemi = _names_fallback()

    if sc is None:
        sc = _distance_decay(xyz, net_ids(names))
    if fc is None:
        fc = _fc_from_sc(sc)
    if bold is None:
        bold = np.zeros((0, REG))
        source["bold"] = "none"
    else:
        source["bold"] = source["sc"]

    gene, receptor, msrc = _try_maps(xyz)
    if gene is None:
        gene = _smooth_map(xyz, SEED + 2, 0.8, 1.2)
        msrc = "synthetic_template"
    if receptor is None:
        receptor = _smooth_map(xyz, SEED + 3, 0.7, 1.3)
    source["maps"] = msrc

    sc = 0.5 * (sc + sc.T)
    np.fill_diagonal(sc, 0.0)
    if sc.max() > 0:
        sc = sc / sc.max()

    _CACHE = {
        "sc": sc,
        "fc": fc,
        "bold": bold,
        "names": names,
        "hemi": hemi,
        "xyz": xyz,
        "gene": gene,
        "receptor": receptor,
        "source": source,
    }
    try:
        np.savez(
            disk, sc=sc, fc=fc, bold=bold, xyz=xyz, gene=gene, receptor=receptor,
            names=np.array(names), hemi=np.array(hemi), source=json.dumps(source),
        )
    except Exception:
        pass
    return _CACHE


def ei_map(zbio: float = 0.0, scale: float = 0.15) -> np.ndarray:
    """Regional E:I scalar map. One scalar times the group gene expression map.

    template_ei_i = 1 + scale * (gene_i - mean gene) / sd gene
    ei_i          = template_ei_i * (1 + 0.05 * zbio)
    The patient factor is the only personal part, the shape is the group map.
    """
    gene = templates()["gene"]
    base = 1.0 + scale * (gene - gene.mean()) / (gene.std() + 1e-9)
    return base * (1.0 + 0.05 * float(zbio))


def short_names() -> list[str]:
    """Region labels trimmed of the 7Networks prefix, for display."""
    return [nm.replace("7Networks_", "") for nm in templates()["names"]]
