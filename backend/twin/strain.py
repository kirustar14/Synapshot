"""Peak tract-oriented strain per edge from the impact, and the initial damage map."""

import numpy as np

from ..data.templates import templates

# Impact directions in MNI-ish axes, unit vectors pointing from the blow into the head.
# x is left to right, y is back to front, z is down to up.
HITS = {
    "frontal": (0.0, -1.0, -0.2),
    "occipital": (0.0, 1.0, -0.2),
    "temporal_l": (1.0, 0.0, 0.0),
    "temporal_r": (-1.0, 0.0, 0.0),
    "parietal": (0.0, -0.2, -1.0),
    "crown": (0.0, 0.0, -1.0),
}
# Helmet B is the newer shell with a rotational damper, so it passes less strain.
HELMET = {"A": 1.0, "B": 0.78}
BASE = 0.07  # peak strain for a reference impact, dimensionless. Tuned so that the mean
#              damage of a typical impact lands where the emulator summaries actually
#              move, about 0.02 to 0.2, instead of in the flat tail. See DECISIONS.md.


def edge_dirs() -> tuple[np.ndarray, np.ndarray]:
    """Unit vector along every edge and the edge index pair arrays."""
    xyz = templates()["xyz"]
    reg = xyz.shape[0]
    ia, ib = np.triu_indices(reg, 1)
    vec = xyz[ib] - xyz[ia]
    nrm = np.linalg.norm(vec, axis=1, keepdims=True)
    return vec / np.where(nrm < 1e-9, 1e-9, nrm), np.stack([ia, ib])


def strain(angle_deg: float, location: str, helmet: str, severity: float) -> np.ndarray:
    """Peak strain per edge, as a vector over the upper triangle edges.

    dir = impact direction rotated by angle_deg about the z axis (obliquity)
    strain_ij = base * (1 + cos(theta_ij)) * helmet * (0.6 + 0.8*severity)
    theta_ij  = angle between the impact direction and the edge direction
    """
    dirs, _ = edge_dirs()
    hit = np.asarray(HITS.get(location, HITS["frontal"]), dtype=float)
    ang = np.radians(angle_deg)
    rot = np.array(
        [[np.cos(ang), -np.sin(ang), 0.0], [np.sin(ang), np.cos(ang), 0.0], [0.0, 0.0, 1.0]]
    )
    hit = rot @ hit
    hit = hit / (np.linalg.norm(hit) + 1e-9)
    cos = np.abs(dirs @ hit)  # tracts are undirected, only the alignment matters
    fac = HELMET.get(helmet, 1.0) * (0.6 + 0.8 * float(severity))
    return BASE * (1.0 + cos) * fac


def damage0(strains: np.ndarray, eps: float, zbio: float) -> np.ndarray:
    """Initial damage per edge from strain, the strain threshold and the biomarkers.

    D_ij(0) = sigmoid((strain_ij - eps) / 0.05) * (0.5 + 0.1*zbio), clipped to [0, 0.95]
    """
    sig = 1.0 / (1.0 + np.exp(-np.clip((strains - eps) / 0.05, -40, 40)))
    return np.clip(sig * (0.5 + 0.1 * float(zbio)), 0.0, 0.95)


def damage_matrix(dmg: np.ndarray) -> np.ndarray:
    """Expand an upper triangle damage vector to a symmetric region by region matrix."""
    reg = templates()["sc"].shape[0]
    out = np.zeros((reg, reg))
    ia, ib = np.triu_indices(reg, 1)
    out[ia, ib] = dmg
    return out + out.T


def top_tracts(dmg: np.ndarray, keep: int = 3) -> list[dict]:
    """The most damaged edges, named by their two regions."""
    from ..data.templates import short_names

    names = short_names()
    _, pairs = edge_dirs()
    order = np.argsort(-dmg)[:keep]
    out = []
    for e in order:
        a, b = int(pairs[0][e]), int(pairs[1][e])
        out.append({"edge": int(e), "a": a, "b": b, "name": f"{names[a]} to {names[b]}", "damage": float(dmg[e])})
    return out
