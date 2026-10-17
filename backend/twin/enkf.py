"""Ensemble Kalman filter that updates the twin after every weekly call.

State per member: theta = [log k, logit p, log d0_scale] plus one AR(1) discrepancy
term per observable, so the filter can absorb a standing bias in a measurement without
blaming it on the recovery parameters.
"""

import numpy as np

from ..features import sem as semmod
from . import forecast as fcast
from . import priors

MEMBERS = 200
RHO = 0.5        # AR(1) coefficient of the discrepancy term
DISC_SD = 0.3    # stationary sd of the discrepancy, in units of that metric's SEM
INFLATE = 1.02   # multiplicative covariance inflation each week


def init(rng: np.random.Generator, geno: dict, zbio: float, sex: str, d0: float, members: int = MEMBERS) -> dict:
    """Prior ensemble and empty diagnostics."""
    ens = priors.initial_ensemble(rng, geno, zbio, sex, members)
    return {
        "ens": ens,
        "disc": np.zeros((members, len(fcast.OBS))),
        "d0": float(d0),
        "sd_prior_logk": float(ens[:, 0].std()),
        "coverage": [],      # one entry per updated week, computed before the update
        "resid": [],         # standardized residuals per week, per observable
        "drift_hist": [],    # drift z per week, what the drift alert rule reads
        "contraction": {"k": 0.0},
        "drift_z": 0.0,
        "weeks": [],
    }


def advance(state: dict, rng: np.random.Generator) -> None:
    """Step the AR(1) discrepancy forward one week.

    b_t = rho * b_{t-1} + Normal(0, (DISC_SD*sem)^2 * (1 - rho^2))
    """
    sv = fcast.sems()
    inn = DISC_SD * sv * np.sqrt(1.0 - RHO**2)
    state["disc"] = RHO * state["disc"] + rng.normal(0.0, 1.0, state["disc"].shape) * inn


def predict(state: dict, week: int) -> dict:
    """Map every member to predicted observables at one week. y_pred = y_of(d(week)) + b."""
    th = state["ens"]
    k = np.exp(th[:, 0])
    p = 1.0 / (1.0 + np.exp(-np.clip(th[:, 1], -40, 40)))
    d0m = state["d0"] * np.exp(th[:, 2])
    d = fcast.d_of(d0m, k, p, np.array([float(week)]))[:, 0]
    return {"y": fcast.y_of(d) + state["disc"], "d": d}


def band(ypred: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """80% predictive band including measurement noise, per observable."""
    draw = ypred + rng.normal(0.0, fcast.sems(), ypred.shape)
    return np.percentile(draw, 10, axis=0), np.percentile(draw, 90, axis=0)


def perturb(rng: np.random.Generator, rvar: np.ndarray, mem: int) -> np.ndarray:
    """Observation perturbations, centred and rescaled to carry exactly variance rvar.

    Leaving the sample mean and variance of the perturbations uncorrected is a known
    way to lose ensemble spread accuracy at 200 members, so both are matched.
    """
    out = rng.standard_normal((mem, len(rvar)))
    out = out - out.mean(axis=0)
    sd = out.std(axis=0)
    return out / np.where(sd < 1e-12, 1e-12, sd) * np.sqrt(rvar)


def use_keys(flash_ok: bool, have: dict) -> list[int]:
    """Indices of observables to assimilate. Tier B goes out when the flash test failed."""
    out = []
    for i, o in enumerate(fcast.OBS):
        if o["key"] not in have:
            continue
        if o["tier"] == "B" and not flash_ok:
            continue
        out.append(i)
    return out


def step(state: dict, week: int, values: dict, flash_ok: bool = True, seed: int = 0) -> dict:
    """One weekly assimilation. Returns the diagnostics for that week.

    stochastic EnKF with perturbed observations:
    K      = C_xy (C_yy + R)^-1
    x_a[m] = x_f[m] + K (y_obs + eps[m] - y_f[m]) , eps[m] ~ Normal(0, R)
    R      = diag(sem^2) over the assimilated observables
    """
    rng = np.random.default_rng(seed + week)
    advance(state, rng)
    pre = predict(state, week)
    lo, hi = band(pre["y"], rng)

    idx = use_keys(flash_ok, values)
    sv = fcast.sems()
    names = [o["key"] for o in fcast.OBS]

    # Coverage and residuals are measured against the forecast, before the update.
    inside, resid = [], {}
    for i in idx:
        val = float(values[names[i]])
        inside.append(bool(lo[i] <= val <= hi[i]))
        sd = float(np.sqrt(pre["y"][:, i].var() + sv[i] ** 2))
        resid[names[i]] = float((val - pre["y"][:, i].mean()) / max(sd, 1e-9))
    cov = float(np.mean(inside)) if inside else float("nan")

    if idx:
        obs = np.array([float(values[names[i]]) for i in idx])
        rvar = sv[idx] ** 2
        # Inflation is applied to the discrepancy block only. k, p and the damage scale
        # are static parameters, and widening them 2 percent every week balances out the
        # information one call brings, which pins contraction near 0.2. See DECISIONS.md.
        dsc = state["disc"]
        state["disc"] = dsc.mean(axis=0) + INFLATE * (dsc - dsc.mean(axis=0))
        mem = state["ens"].shape[0]
        yf = predict(state, week)["y"][:, idx]
        xf = np.hstack([state["ens"], state["disc"]])
        dx = xf - xf.mean(axis=0)
        dy = yf - yf.mean(axis=0)
        cxy = dx.T @ dy / (mem - 1)
        cyy = dy.T @ dy / (mem - 1) + np.diag(rvar)
        gain = cxy @ np.linalg.pinv(cyy)
        xa = xf + (obs + perturb(rng, rvar, mem) - yf) @ gain.T
        state["ens"] = np.clip(xa[:, :3], [-6.0, -8.0, -2.0], [2.0, 8.0, 2.0])
        state["disc"] = xa[:, 3:]

    state["weeks"].append(int(week))
    state["coverage"].append({"week": int(week), "cov": cov})
    state["resid"].append({"week": int(week), **resid})
    sd_post = float(state["ens"][:, 0].std())
    state["contraction"] = {"k": float(1.0 - sd_post / max(state["sd_prior_logk"], 1e-9))}
    state["drift_z"] = drift(state)
    state["drift_hist"].append({"week": int(week), "z": state["drift_z"]})
    return {
        "week": int(week),
        "cov": cov,
        "resid": resid,
        "contraction": state["contraction"],
        "drift_z": state["drift_z"],
        "used": [names[i] for i in idx],
        "lo": {names[i]: float(lo[i]) for i in idx},
        "hi": {names[i]: float(hi[i]) for i in idx},
        "pred": {names[i]: float(pre["y"][:, i].mean()) for i in idx},
    }


def drift(state: dict) -> float:
    """Drift z: mean standardized residual over the last two weeks, signed toward worse.

    z = mean over the last two weeks and observables of (obs - pred)/sd * sign(load_s)
    A positive z means reality is worse than the twin expected.
    """
    rows = state["resid"][-2:]
    vals = []
    for row in rows:
        for o in fcast.OBS:
            if o["key"] in row:
                vals.append(row[o["key"]] * (1.0 if o["load"] > 0 else -1.0))
    return float(np.mean(vals)) if vals else 0.0


def params(state: dict) -> dict:
    """Posterior summaries of k, p and the damage scale."""
    th = state["ens"]
    p = 1.0 / (1.0 + np.exp(-np.clip(th[:, 1], -40, 40)))
    return {
        "k": float(np.exp(th[:, 0]).mean()),
        "k_lo": float(np.percentile(np.exp(th[:, 0]), 5)),
        "k_hi": float(np.percentile(np.exp(th[:, 0]), 95)),
        "logk_mean": float(th[:, 0].mean()),
        "logk_sd": float(th[:, 0].std()),
        "p": float(p.mean()),
        "logitp_mean": float(th[:, 1].mean()),
        "logitp_sd": float(th[:, 1].std()),
        "d0_scale": float(np.exp(th[:, 2]).mean()),
    }


def mean_coverage(state: dict, upto: int | None = None) -> float:
    """Mean one-step-ahead coverage over the weeks seen so far."""
    vals = [c["cov"] for c in state["coverage"] if (upto is None or c["week"] <= upto) and np.isfinite(c["cov"])]
    return float(np.mean(vals)) if vals else 0.0


def sem_of(key: str) -> float:
    """SEM passthrough so callers do not need to import the features package."""
    return semmod.sem(key)
