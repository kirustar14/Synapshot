"""One dimensional emulator of the DMF over global damage, built once and cached.

Running the DMF at every week of every forecast of every ensemble member is far too
slow, so the whole network response is compressed to four summaries as a function of one
number, the mean damage d. See DECISIONS.md: this is a 1-D emulator standing in for a
proper simulation based inference posterior, and `sbi` is an optional upgrade behind
USE_SBI=1 which replaces the table inversion in `invert_d`.
"""

import json

import numpy as np

from ..config import cfg
from ..data.templates import templates
from . import dmf

LEVELS = 15
DUR_S = 30.0
REF_D = 0.2   # mean damage that counts as full injury for the observable loads
KEYS = ["fc_mean", "fc_std", "meta", "rate"]
_TAB: dict | None = None


def build(force: bool = False) -> dict:
    """Damage grid and the summary table z(d), from disk when it is already there.

    scaled SC at damage level d: C(d) = (1 - d) * C
    z(d) = [mean FC, FC std, metastability, mean firing rate]
    FC comes from the linear response solution and the two dynamic summaries from a 30 s
    run, with the inhibition held at its healthy value so damage can move the working point.
    """
    global _TAB
    if _TAB is not None and not force:
        return _TAB
    path = cfg.cache_dir() / f"surrogate_{LEVELS}_{int(DUR_S)}.json"
    if path.exists() and not force:
        try:
            got = json.loads(path.read_text())
            _TAB = {"d": np.asarray(got["d"]), "z": np.asarray(got["z"]), "keys": got["keys"]}
            return _TAB
        except Exception:
            pass

    sc = templates()["sc"]
    gmid = 1.8  # the emulator is built at the middle of the G prior, see DECISIONS.md
    jj = dmf.fic(sc, gmid)
    # Quadratic spacing: the summaries move fast for the first 20 percent of damage and
    # barely at all after that, so the grid is dense where the response lives.
    grid = np.linspace(0.0, 1.0, LEVELS) ** 2
    rows = []
    for d in grid:
        scd = (1.0 - float(d)) * sc
        fc = dmf.fc_lin(scd, gmid, j=jj)
        if not np.isfinite(fc).all():
            rows.append(rows[-1] if rows else [0.0, 0.0, 0.0, 0.0])
            continue
        up = dmf.upper(fc)
        sim = dmf.simulate(scd, gmid, dur_s=DUR_S, seed=21, j=jj)
        rows.append([float(up.mean()), float(up.std()), dmf.metastability(sim["bold"]), float(sim["rate"].mean())])
    tab = np.asarray(rows)
    # Force each summary to be monotone in d so the forecast cannot wobble on emulator noise.
    for c in range(tab.shape[1]):
        tab[:, c] = np.minimum.accumulate(tab[:, c]) if tab[-1, c] < tab[0, c] else np.maximum.accumulate(tab[:, c])
    _TAB = {"d": grid, "z": tab, "keys": KEYS}
    path.write_text(json.dumps({"d": grid.tolist(), "z": tab.tolist(), "keys": KEYS}))
    return _TAB


def z_of(d):
    """Interpolated summaries at damage d, scalar or array, shape (..., 4)."""
    tab = build()
    dd = np.asarray(d, dtype=float)
    cols = [np.interp(dd, tab["d"], tab["z"][:, c]) for c in range(tab["z"].shape[1])]
    return np.stack(cols, axis=-1)


def span() -> np.ndarray:
    """z(REF_D) - z(0) per summary, the scale that turns a summary shift into a load.

    REF_D is what "full injury" means for the observable loads in forecast.py. It is the
    top of the mean damage range this generator produces, not d = 1, which would mean
    every tract in the brain is gone. The emulator is also steep near d = 0, so scaling
    against d = 1 would push every patient into the flat tail. See DECISIONS.md.
    """
    out = z_of(REF_D) - z_of(0.0)
    return np.where(np.abs(out) < 1e-12, 1e-12, out)


def index_of(key: str) -> int:
    """Column index of a summary by name."""
    return KEYS.index(key)


def invert_d(z_obs: np.ndarray) -> dict:
    """Damage level most consistent with observed summaries, with an sd.

    d_hat = argmin_d sum_c ((z_c(d) - z_obs_c) / span_c)^2
    With USE_SBI=1 and sbi installed, a neural posterior over d is trained on the table
    instead and its mean and sd are returned.
    """
    tab = build()
    if cfg.use_sbi:
        got = _sbi_posterior(np.asarray(z_obs, dtype=float))
        if got is not None:
            return got
    fine = np.linspace(0.0, 1.0, 501)
    zz = z_of(fine)
    cost = (((zz - np.asarray(z_obs, dtype=float)) / span()) ** 2).sum(axis=-1)
    wgt = np.exp(-0.5 * (cost - cost.min()))
    wgt = wgt / wgt.sum()
    mean = float((fine * wgt).sum())
    sd = float(np.sqrt(((fine - mean) ** 2 * wgt).sum()))
    return {"d": float(fine[int(np.argmin(cost))]), "mean": mean, "sd": sd, "how": "table", "levels": int(len(tab["d"]))}


def _sbi_posterior(z_obs: np.ndarray) -> dict | None:
    """Neural posterior over d given the summaries, or None when sbi is not installed."""
    try:
        import torch
        from sbi.inference import NPE

        grid = np.random.default_rng(0).uniform(0.0, 1.0, 2000)
        zz = z_of(grid) / span()
        theta = torch.tensor(grid.reshape(-1, 1), dtype=torch.float32)
        obs = torch.tensor(zz, dtype=torch.float32)
        post = NPE().append_simulations(theta, obs).train(max_num_epochs=30)
        draws = post.sample((500,), x=torch.tensor(z_obs / span(), dtype=torch.float32)).numpy().ravel()
        return {"d": float(np.median(draws)), "mean": float(draws.mean()), "sd": float(draws.std()), "how": "sbi", "levels": 2000}
    except Exception:
        return None
