"""Dynamic mean field model over 100 regions, Euler-Maruyama, plus a G fit to FC.

Constants are the usual Deco 2014 reduced Wong-Wang values written from memory. See
DECISIONS.md: they should be checked against cubnm before anyone trusts a number.
"""

import hashlib
import json

import numpy as np

from ..config import cfg

# Reduced Wong-Wang excitatory population, one variable S_i per region, with the
# feedback inhibition term J_i that Deco 2014 uses to hold the working point.
# I_i(t)   = J_N * (w * ei_i * S_i + G * sum_j C_ij S_j) + I0 - J_i * S_i
# r_i(t)   = (a*I_i - b) / (1 - exp(-d*(a*I_i - b)))
# dS_i     = (-S_i/tau_s + gamma*(1 - S_i)*r_i) dt + sigma*sqrt(dt)*eta_i
# J_i      = J_N*(w*ei_i + G*sum_j C_ij) - (I_tgt - I0)/S_tgt     analytic FIC
# I in nA, r in Hz, t in ms, S dimensionless gating variable in [0, 1]
A = 270.0        # n/C
B = 108.0        # Hz
D = 0.154        # s
GAMMA = 0.641 / 1000.0   # kinetic parameter per ms
TAU_S = 100.0    # ms
W = 0.9          # local recurrent weight
J_N = 0.2609     # nA
I0 = 0.3         # nA
SIGMA = 0.001    # nA, noise amplitude

DT = 2.0         # ms integration step, stable well inside tau_s = 100 ms
REC = 10.0       # ms recording step
TR = 720.0       # ms, BOLD sampling for anything that wants TR resolution
R_TGT = 1.2      # Hz, target spontaneous rate that FIC holds, see DECISIONS.md


_REF: float | None = None


def ref_scale() -> float:
    """Mean row sum of the healthy template SC. The fixed scale that G is defined against.

    Normalizing every matrix by its own row sum would cancel exactly the thing injury
    does to the network, so the divisor is the healthy template for everyone.
    """
    global _REF
    if _REF is None:
        from ..data.templates import templates

        out = np.array(templates()["sc"], dtype=float)
        out = 0.5 * (out + out.T)
        np.fill_diagonal(out, 0.0)
        _REF = float(out.sum(axis=1).mean()) or 1.0
    return _REF


def norm_sc(sc: np.ndarray) -> np.ndarray:
    """Symmetrize, clear the diagonal and divide by the template scale."""
    out = np.array(sc, dtype=float)
    out = 0.5 * (out + out.T)
    np.fill_diagonal(out, 0.0)
    return out / ref_scale()


def rate(cur: np.ndarray) -> np.ndarray:
    """Transfer function r = (a*I - b) / (1 - exp(-d*(a*I - b))), with the x->0 limit."""
    x = A * cur - B
    den = 1.0 - np.exp(-D * x)
    return np.where(np.abs(x) < 1e-6, 1.0 / D, x / np.where(np.abs(den) < 1e-12, 1e-12, den))


def work_point(r_tgt: float = R_TGT) -> dict:
    """Target current and gating value that give a spontaneous rate of r_tgt.

    x_tgt solves r(x) = r_tgt, with x = a*I - b
    I_tgt = (x_tgt + b) / a
    S_tgt = tau_s*gamma*r_tgt / (1 + tau_s*gamma*r_tgt)   from dS/dt = 0
    """
    from scipy.optimize import brentq

    def gap(x: float) -> float:
        den = 1.0 - np.exp(-D * x)
        return (x / den if abs(den) > 1e-12 else 1.0 / D) - r_tgt

    x = float(brentq(gap, -400.0, -1e-6))
    s_tgt = TAU_S * GAMMA * r_tgt / (1.0 + TAU_S * GAMMA * r_tgt)
    return {"x": x, "I_tgt": (x + B) / A, "S_tgt": s_tgt, "r_tgt": r_tgt}


def fic(sc: np.ndarray, g: float, ei: np.ndarray | None = None) -> np.ndarray:
    """Feedback inhibition weight per region that puts every region at the working point.

    J_i = J_N*(w*ei_i + G*rowsum_i) - (I_tgt - I0)/S_tgt , clipped at 0
    """
    c = norm_sc(sc)
    reg = c.shape[0]
    ei = np.ones(reg) if ei is None else np.asarray(ei, dtype=float)
    wp = work_point()
    off = (wp["I_tgt"] - I0) / wp["S_tgt"]
    return np.clip(J_N * (W * ei + g * c.sum(axis=1)) - off, 0.0, None)


def hrf(step_ms: float = REC, dur_ms: float = 20000.0) -> np.ndarray:
    """Double gamma hemodynamic kernel, peak near 5 s, undershoot near 15 s.

    h(t) = t^5 exp(-t/0.9) / c1 - 0.35 * t^15 exp(-t/0.9) / c2, t in seconds
    """
    t = np.arange(0.0, dur_ms, step_ms) / 1000.0
    pos = t**5 * np.exp(-t / 0.9)
    neg = t**15 * np.exp(-t / 0.9)
    h = pos / (pos.max() + 1e-12) - 0.35 * neg / (neg.max() + 1e-12)
    return h / (np.abs(h).sum() + 1e-12)


def to_bold(s: np.ndarray) -> np.ndarray:
    """Convolve the gating variable with the HRF, drop the lead-in, z score per region."""
    h = hrf()
    out = np.empty_like(s)
    end = s.shape[0]
    for i in range(s.shape[1]):
        out[:, i] = np.convolve(s[:, i] - s[:, i].mean(), h, mode="full")[:end]
    sd = out.std(axis=0, keepdims=True)
    return out / np.where(sd < 1e-12, 1e-12, sd)


def simulate(sc: np.ndarray, g: float, ei: np.ndarray | None = None, dur_s: float = 20.0, seed: int = 0, j: np.ndarray | None = None) -> dict:
    """Run the DMF and return gating, firing rate and BOLD, each recorded every 10 ms.

    Pass `j` to keep the inhibition that was tuned on the healthy brain while the
    damaged SC is simulated, which is what lets injury move the working point.
    """
    c = norm_sc(sc)
    reg = c.shape[0]
    ei = np.ones(reg) if ei is None else np.asarray(ei, dtype=float)
    jj = fic(sc, g, ei) if j is None else np.asarray(j, dtype=float)
    rng = np.random.default_rng(seed)
    steps = int(dur_s * 1000.0 / DT)
    keep = int(REC / DT)
    s = np.full(reg, work_point()["S_tgt"])
    sq = SIGMA * np.sqrt(DT)
    dec = -DT / TAU_S
    kin = DT * GAMMA
    loc = W * ei
    rows = steps // keep
    s_rec = np.empty((rows, reg))
    r_rec = np.empty((rows, reg))
    chunk = 5000  # noise is drawn in blocks, one call per step is the bottleneck
    eta = rng.standard_normal((min(chunk, steps), reg))
    for i in range(steps):
        if i and i % chunk == 0:
            eta = rng.standard_normal((min(chunk, steps - i), reg))
        cur = J_N * (loc * s + g * (c @ s)) + I0 - jj * s
        r = rate(cur)
        s += dec * s + kin * (1.0 - s) * r + sq * eta[i % chunk]
        np.clip(s, 0.0, 1.0, out=s)
        if i % keep == 0:
            row = i // keep
            if row < rows:
                s_rec[row] = s
                r_rec[row] = r
    drop = int(2000.0 / REC)  # discard the first 2 s of transient
    sarr, rarr = s_rec[drop:], r_rec[drop:]
    return {"s": sarr, "rate": rarr, "bold": to_bold(sarr), "G": float(g)}


def rates_at(sc: np.ndarray, g: float, ei: np.ndarray | None = None, j: np.ndarray | None = None) -> np.ndarray:
    """Per region firing rate at the healthy gating value, in Hz.

    I_i = J_N*(w*ei_i*S_tgt + G*sum_j C_ij*S_tgt) + I0 - J_i*S_tgt
    r_i = rate(I_i)
    Evaluated at S = S_tgt rather than integrated, so a damaged SC can be scored in one
    matrix product instead of a 30 s run. Pass `j` to hold the inhibition that was tuned
    on the healthy brain, which is what lets damage move the rate at all. With the healthy
    SC and its own J this returns r_tgt for every region by construction.
    """
    c = norm_sc(sc)
    reg = c.shape[0]
    ei = np.ones(reg) if ei is None else np.asarray(ei, dtype=float)
    jj = fic(sc, g, ei) if j is None else np.asarray(j, dtype=float)
    wp = work_point()
    s = wp["S_tgt"]
    cur = J_N * (W * ei * s + g * (c @ np.full(reg, s))) + I0 - jj * s
    return rate(cur)


def fc_of(bold: np.ndarray) -> np.ndarray:
    """Region by region Pearson FC of a time by region signal."""
    fc = np.corrcoef(bold.T)
    fc = np.nan_to_num(fc, nan=0.0)
    np.fill_diagonal(fc, 1.0)
    return fc


def upper(mat: np.ndarray) -> np.ndarray:
    """Upper triangle of a square matrix as a vector."""
    return mat[np.triu_indices(mat.shape[0], 1)]


def fc_corr(a: np.ndarray, b: np.ndarray) -> float:
    """Pearson correlation between the upper triangles of two FC matrices."""
    x, y = upper(a), upper(b)
    if x.std() < 1e-9 or y.std() < 1e-9:
        return 0.0
    return float(np.corrcoef(x, y)[0, 1])


def metastability(bold: np.ndarray) -> float:
    """Std over time of the Kuramoto order parameter of the BOLD analytic phase.

    R(t) = |mean_i exp(i*phi_i(t))| , metastability = std_t R(t)
    """
    from scipy.signal import hilbert

    ph = np.angle(hilbert(bold - bold.mean(axis=0), axis=0))
    r = np.abs(np.exp(1j * ph).mean(axis=1))
    return float(r.std())


def gain() -> float:
    """Slope of the gating equation at the working point, per ms per nA.

    gain = gamma*(1 - S_tgt)*r'(I_tgt)
    r'(I) = a * f'(x), f(x) = x/(1 - exp(-d*x)), x = a*I - b
    f'(x) = [(1 - e) - x*d*e] / (1 - e)^2 , e = exp(-d*x)
    """
    wp = work_point()
    x = wp["x"]
    e = np.exp(-D * x)
    fp = ((1.0 - e) - x * D * e) / (1.0 - e) ** 2
    return GAMMA * (1.0 - wp["S_tgt"]) * A * fp


def jac(sc: np.ndarray, g: float, ei: np.ndarray | None = None, j: np.ndarray | None = None) -> np.ndarray:
    """Jacobian of the gating dynamics at the working point, per ms.

    A = -(1/tau_s + gamma*r_tgt) I + gain * (J_N*(diag(w*ei) + G*C) - diag(J))
    """
    c = norm_sc(sc)
    reg = c.shape[0]
    ei = np.ones(reg) if ei is None else np.asarray(ei, dtype=float)
    jj = fic(sc, g, ei) if j is None else np.asarray(j, dtype=float)
    wp = work_point()
    gn = gain()
    out = gn * (J_N * (np.diag(W * ei) + g * c) - np.diag(jj))
    out -= np.eye(reg) * (1.0 / TAU_S + GAMMA * wp["r_tgt"])
    return out


def fc_lin(sc: np.ndarray, g: float, ei: np.ndarray | None = None, j: np.ndarray | None = None) -> np.ndarray:
    """Linear response FC at the working point, the infinite time limit of simulate().

    A Sigma + Sigma A^T + Q = 0 , Q = sigma^2 I
    FC_ij = Sigma_ij / sqrt(Sigma_ii Sigma_jj)
    """
    from scipy.linalg import solve_continuous_lyapunov

    a = jac(sc, g, ei, j)
    if np.max(np.linalg.eigvals(a).real) > -1e-9:
        return np.full(a.shape, np.nan)  # past the stability edge, caller treats as unusable
    cov = solve_continuous_lyapunov(a, -(SIGMA**2) * np.eye(a.shape[0]))
    sd = np.sqrt(np.clip(np.diag(cov), 1e-30, None))
    fc = cov / np.outer(sd, sd)
    np.fill_diagonal(fc, 1.0)
    return fc


def _key(sc: np.ndarray, fc: np.ndarray, grid: np.ndarray) -> str:
    """Stable cache key from the matrices and the grid."""
    h = hashlib.sha1()
    for arr in (np.round(sc, 5), np.round(fc, 5), np.round(grid, 5)):
        h.update(np.ascontiguousarray(arr, dtype=np.float64).tobytes())
    return h.hexdigest()[:16]


def fit_G(sc: np.ndarray, fc_emp: np.ndarray, lo: float = 0.8, hi: float = 3.4, points: int = 12, ei: np.ndarray | None = None) -> dict:
    """Grid search over G against FC, inverted on the monotone mean FC level.

    lvl(G) = mean over edges of upper(FC_mod(G)) , evaluated on the grid, monotone in G
    G*     = lvl^-1(mean upper(FC_emp)) by linear interpolation between grid points
    fc_fit = corr(upper(FC_mod(G*)), upper(FC_emp)) at the nearest grid point
    Two decisions live here, both in DECISIONS.md. The model FC is the linear response
    solution rather than an average of 20 s runs, and the level rather than the pattern
    correlation is what identifies G, because the correlation rises monotonically with G.
    """
    grid = np.linspace(lo, hi, points)
    path = cfg.cache_dir() / f"fitG_{_key(sc, fc_emp, grid)}.json"
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass

    lvl_emp = float(upper(fc_emp).mean())
    cors, lvls = [], []
    for g in grid:
        fc_mod = fc_lin(sc, float(g), ei=ei)
        if not np.isfinite(fc_mod).all():
            cors.append(0.0)
            lvls.append(lvls[-1] if lvls else 0.0)
            continue
        cors.append(fc_corr(fc_mod, fc_emp))
        lvls.append(float(upper(fc_mod).mean()))
    cors = np.asarray(cors)
    lvls = np.maximum.accumulate(np.asarray(lvls))  # enforce monotone before inverting
    best = float(np.interp(lvl_emp, lvls, grid))
    j = int(np.argmin(np.abs(grid - best)))
    out = {
        "G": float(np.clip(best, lo, hi)),
        "fit": float(cors[j]),
        "grid": [float(v) for v in grid],
        "cors": [float(v) for v in cors],
        "levels": [float(v) for v in lvls],
        "level_emp": lvl_emp,
    }
    path.write_text(json.dumps(out))
    return out


SCAN_NOISE = 0.10  # FC edge noise, set so fc_fit lands near 0.6 like a real FC fit does


def fc_emp_of(sc: np.ndarray, g: float, ei: np.ndarray | None = None, seed: int = 0, noise: float = SCAN_NOISE) -> np.ndarray:
    """Empirical style FC for a synthetic patient: model FC at the true G plus scan noise.

    FC_emp = FC_mod(G_true) + Normal(0, noise^2), symmetrized
    The same estimator as fit_G on purpose. A 300 s Monte Carlo run of the same model
    agrees with FC_mod in pattern at r about 0.93 but sits about 20 percent higher in
    mean level, and the level is what identifies G, so mixing the two estimators would
    bias G by about 0.4. See DECISIONS.md.
    """
    out = fc_lin(sc, g, ei=ei)
    if noise > 0:
        rng = np.random.default_rng(seed + 7)
        pert = rng.normal(0, noise, out.shape)
        out = out + 0.5 * (pert + pert.T)
    np.fill_diagonal(out, 1.0)
    return out
