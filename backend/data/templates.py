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
        # nilearn returns 101 labels for 100 parcels: index 0 is "Background". Leaving it
        # in shifts every region's name and network by one against its centroid.
        labels = [lab for lab in labels if "background" not in lab.lower()]
        if len(labels) != REG:
            return None, None, None
        img = image.load_img(atlas.maps)
        vol = np.asarray(img.get_fdata())
        cents = ndimage.center_of_mass(vol > 0, labels=vol.astype(int), index=np.arange(1, REG + 1))
        aff = img.affine
        xyz = np.array([aff[:3, :3] @ np.array(c) + aff[:3, 3] for c in cents])
        hemi = ["L" if "LH" in lab else "R" for lab in labels]
        return labels, hemi, xyz
    except Exception:
        return None, None, None


def _try_enigma_conn(names: list[str] | None) -> tuple[np.ndarray | None, np.ndarray | None]:
    """Real HCP structural and functional connectivity for Schaefer-100, or two Nones.

    The matrices are only accepted when their own labels match the atlas labels region
    for region, because a silently permuted connectome is worse than a modelled one.
    """
    if cfg.offline:
        return None, None
    try:
        from enigmatoolbox.datasets import load_fc, load_sc

        sc, lab_sc, _, _ = load_sc("schaefer_100")
        fc, lab_fc, _, _ = load_fc("schaefer_100")
    except Exception:
        return None, None
    if sc.shape != (REG, REG) or fc.shape != (REG, REG):
        return None, None
    if names is not None:
        want = [str(n) for n in names]
        if [str(v) for v in lab_sc] != want or [str(v) for v in lab_fc] != want:
            return None, None
    sc = np.clip(np.asarray(sc, dtype=float), 0.0, None)   # a few log-transformed zeros go slightly negative
    np.fill_diagonal(sc, 0.0)
    return sc, np.asarray(fc, dtype=float)


def _fill_nan(vals: np.ndarray, xyz: np.ndarray) -> np.ndarray:
    """Replace missing region values with the nearest region that has one."""
    out = np.array(vals, dtype=float)
    bad = np.flatnonzero(~np.isfinite(out))
    good = np.flatnonzero(np.isfinite(out))
    if good.size == 0:
        return np.zeros_like(out)
    for i in bad:
        d = np.linalg.norm(xyz[good] - xyz[i], axis=1)
        out[i] = out[good[int(np.argmin(d))]]
    return out


def _try_maps(xyz: np.ndarray, names: list[str] | None) -> tuple[np.ndarray | None, np.ndarray | None, str | None]:
    """Regional E:I map from Allen Human Brain Atlas gene expression, or Nones.

    ei_raw = mean z of excitatory markers minus mean z of inhibitory markers
    excitatory: GRIN1, GRIA1, SLC17A7 (NMDA, AMPA, vesicular glutamate transporter)
    inhibitory: GAD1, GABRA1, SLC32A1 (GAD67, GABA-A alpha1, vesicular GABA transporter)
    The expression tables are in the Desikan parcellation, so the map is projected to the
    surface and back down to Schaefer-100 with the toolbox's own conversion.
    """
    if cfg.offline:
        return None, None, None
    try:
        from enigmatoolbox.datasets import fetch_ahba
        from enigmatoolbox.utils.parcellation import parcel_to_surface, surface_to_parcel

        tab = fetch_ahba()
        exc, inh = ["GRIN1", "GRIA1", "SLC17A7"], ["GAD1", "GABRA1", "SLC32A1"]
        if any(g not in tab.columns for g in exc + inh):
            return None, None, None

        def zed(arr) -> np.ndarray:
            arr = np.asarray(arr, dtype=float)
            return (arr - np.nanmean(arr)) / (np.nanstd(arr) + 1e-9)

        import warnings

        with np.errstate(invalid="ignore"), warnings.catch_warnings():
            # Regions with no donor coverage are all-NaN slices, and _fill_nan deals
            # with them a few lines down.
            warnings.simplefilter("ignore", RuntimeWarning)
            e = np.nanmean(np.stack([zed(tab[g].to_numpy()) for g in exc]), axis=0)
            i = np.nanmean(np.stack([zed(tab[g].to_numpy()) for g in inh]), axis=0)
        raw = zed(e) - zed(i)
        got = surface_to_parcel(parcel_to_surface(raw, "aparc_fsa5"), "schaefer_100_fsa5")
        got = np.asarray(got, dtype=float)
        if got.size == REG + 1:
            got = got[1:]            # index 0 is the medial wall, not a parcel
        if got.size != REG:
            return None, None, None
        got = _fill_nan(got, xyz)
        spread = got.std() or 1.0
        # E:I enters the model as a multiplier on local excitation, centred on 1.
        ei = 1.0 + 0.15 * (got - got.mean()) / spread
        del names
        return ei, None, "enigmatoolbox_ahba_ei"
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
    names, hemi, xyz = _try_nilearn()
    source["regions"] = "nilearn_schaefer100" if names is not None else "ellipsoid_fallback"
    if xyz is None:
        xyz = _ellipsoid_xyz()
    if names is None:
        names, hemi = _names_fallback()

    sc, fc, bold = _try_cubnm()
    src_conn = "cubnm_schaefer100" if sc is not None else None
    if sc is None:
        # Real HCP diffusion and resting state matrices, label checked against the atlas.
        sc, fc = _try_enigma_conn(names)
        src_conn = "enigma_hcp_schaefer100" if sc is not None else None
    source["sc"] = src_conn or "distance_decay_fallback"
    source["fc"] = src_conn or "synthetic_template"

    if sc is None:
        sc = _distance_decay(xyz, net_ids(names))
    if fc is None:
        fc = _fc_from_sc(sc)
    if bold is None:
        bold = np.zeros((0, REG))
        source["bold"] = "none"
    else:
        source["bold"] = source["sc"]

    gene, receptor, msrc = _try_maps(xyz, names)
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
