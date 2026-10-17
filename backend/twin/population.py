"""Hierarchical layer across the cohort: learn the priors every twin starts from.

Each patient contributes its own posterior summary of log k and logit p with that
posterior's width, so the per patient latent value is marginalized out analytically and
NUTS only has to sample the nine population parameters.
"""

import json

import numpy as np

from ..config import cfg
from . import priors

NAMES = ["mu_k", "mu_p", "s_k", "s_p", "s_bdnf", "b_e4", "b_fe4", "c_e4", "c_bio"]
EFFECTS = ["b_e4", "b_fe4", "c_e4", "c_bio"]
WARMUP = 500
DRAWS = 500

# logk_hat_i  ~ Normal(mu_k - b_e4*e4_i - b_fe4*e4_i*fem_i, s_k^2 + s_bdnf^2*met_i + se_k_i^2)
# logitp_hat_i ~ Normal(mu_p + c_e4*e4_i + c_bio*zbio_i, s_p^2 + se_p_i^2)
# the per patient latent log k and logit p are integrated out because both levels are
# Gaussian, which is why only the nine population parameters are sampled


def design(rows: list[dict]) -> dict:
    """Stack the cohort into arrays the model can use."""
    return {
        "logk": np.array([r["logk_hat"] for r in rows]),
        "se_k": np.array([max(r["se_logk"], 1e-3) for r in rows]),
        "logitp": np.array([r["logitp_hat"] for r in rows]),
        "se_p": np.array([max(r["se_logitp"], 1e-3) for r in rows]),
        "e4": np.array([float(r["e4"]) for r in rows]),
        "fem": np.array([1.0 if r["sex"] == "F" else 0.0 for r in rows]),
        "met": np.array([1.0 if r["met"] else 0.0 for r in rows]),
        "zbio": np.array([float(r["zbio"]) for r in rows]),
    }


def fit(rows: list[dict], seed: int = 0) -> dict:
    """Posterior summaries for the nine population parameters, NumPyro or the fallback."""
    dat = design(rows)
    got = _fit_numpyro(dat, seed)
    if got is None:
        got = _fit_normal(dat)
    return got


def _fit_numpyro(dat: dict, seed: int) -> dict | None:
    """NUTS on the marginalized hierarchical model, or None when numpyro is missing."""
    try:
        import jax
        import jax.numpy as jnp
        import numpyro
        import numpyro.distributions as dist
        from numpyro.infer import MCMC, NUTS
    except Exception:
        return None

    sd = priors.HYPER["sd_effect"]

    def model(d):
        mu_k = numpyro.sample("mu_k", dist.Normal(priors.HYPER["mu_k"], 0.5))
        mu_p = numpyro.sample("mu_p", dist.Normal(priors.HYPER["mu_p"], 0.5))
        s_k = numpyro.sample("s_k", dist.HalfNormal(0.5))
        s_p = numpyro.sample("s_p", dist.HalfNormal(0.5))
        s_bdnf = numpyro.sample("s_bdnf", dist.HalfNormal(0.3))
        b_e4 = numpyro.sample("b_e4", dist.Normal(0.0, sd))
        b_fe4 = numpyro.sample("b_fe4", dist.Normal(0.0, sd))
        c_e4 = numpyro.sample("c_e4", dist.Normal(priors.HYPER["c_e4"], sd))
        c_bio = numpyro.sample("c_bio", dist.Normal(0.0, sd))

        mk = mu_k - b_e4 * d["e4"] - b_fe4 * d["e4"] * d["fem"]
        vk = s_k**2 + (s_bdnf**2) * d["met"] + d["se_k"] ** 2
        numpyro.sample("logk_obs", dist.Normal(mk, jnp.sqrt(vk)), obs=d["logk"])

        mp = mu_p + c_e4 * d["e4"] + c_bio * d["zbio"]
        vp = s_p**2 + d["se_p"] ** 2
        numpyro.sample("logitp_obs", dist.Normal(mp, jnp.sqrt(vp)), obs=d["logitp"])

    try:
        numpyro.set_host_device_count(1)
        jd = {k: jnp.asarray(v) for k, v in dat.items()}
        mcmc = MCMC(NUTS(model), num_warmup=WARMUP, num_samples=DRAWS, num_chains=1, progress_bar=False)
        mcmc.run(jax.random.PRNGKey(seed), jd)
        post = {k: np.asarray(v) for k, v in mcmc.get_samples().items()}
    except Exception:
        return None
    return summarize(post, "numpyro_nuts")


def _fit_normal(dat: dict) -> dict:
    """Fallback: weighted least squares plus a normal approximation of each effect.

    beta_hat = (X^T W X)^-1 X^T W y , W = diag(1 / (s^2 + se_i^2))
    s is found by matching the weighted residual variance to 1, two passes
    """
    out = {}
    plans = [
        ("k", dat["logk"], np.stack([np.ones_like(dat["e4"]), -dat["e4"], -dat["e4"] * dat["fem"]], 1),
         dat["se_k"], ["mu_k", "b_e4", "b_fe4"], "s_k"),
        ("p", dat["logitp"], np.stack([np.ones_like(dat["e4"]), dat["e4"], dat["zbio"]], 1),
         dat["se_p"], ["mu_p", "c_e4", "c_bio"], "s_p"),
    ]
    post = {}
    for _, y, x, se, names, sname in plans:
        s2 = max(float(y.var() - (se**2).mean()), 1e-4)
        for _ in range(3):
            wgt = 1.0 / (s2 + se**2)
            xtw = x.T * wgt
            cov = np.linalg.pinv(xtw @ x)
            beta = cov @ (xtw @ y)
            resid = y - x @ beta
            s2 = max(float((resid**2).mean() - (se**2).mean()), 1e-4)
        sd = np.sqrt(np.clip(np.diag(cov), 0, None))
        for j, nm in enumerate(names):
            post[nm] = np.random.default_rng(j).normal(beta[j], sd[j], 2000)
        post[sname] = np.full(2000, np.sqrt(s2))
    post["s_bdnf"] = np.full(2000, priors.HYPER["s_bdnf"])
    out = summarize(post, "weighted_least_squares")
    return out


def summarize(post: dict, how: str) -> dict:
    """Mean and 90% interval per parameter."""
    out = {"how": how, "params": {}}
    for nm in NAMES:
        if nm not in post:
            continue
        draws = np.asarray(post[nm], dtype=float).ravel()
        out["params"][nm] = {
            "est": float(draws.mean()),
            "lo": float(np.percentile(draws, 5)),
            "hi": float(np.percentile(draws, 95)),
            "sd": float(draws.std()),
        }
    return out


def cohort_json(rows: list[dict], coverage: list[dict], eff_true: dict, fitted: dict) -> dict:
    """The Cohort contract object."""
    effects = []
    for nm in EFFECTS:
        got = fitted["params"].get(nm, {"est": 0.0, "lo": 0.0, "hi": 0.0})
        effects.append({
            "name": nm,
            "true": float(eff_true.get(nm, priors.HYPER.get(nm, 0.0))),
            "est": float(got["est"]),
            "lo": float(got["lo"]),
            "hi": float(got["hi"]),
        })
    return {
        "weeks": sorted({int(c["week"]) for c in coverage}),
        "coverage": [{"week": int(c["week"]), "cov": float(c["cov"])} for c in coverage],
        "k_true": [float(r["k_true"]) for r in rows],
        "k_est": [float(r["k_est"]) for r in rows],
        "effects": effects,
        "size": len(rows),
    }


def save(cohort: dict) -> str:
    """Write cohort.json and return the path."""
    path = cfg.data_dir / "cohort.json"
    path.write_text(json.dumps(cohort, indent=2))
    return str(path)


def load() -> dict | None:
    """Read cohort.json, or None when seeding has not run."""
    path = cfg.data_dir / "cohort.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None
