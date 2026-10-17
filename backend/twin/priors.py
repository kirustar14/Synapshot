"""Priors on the recovery parameters, with genotype, sex and biomarker terms.

The APOE term is a hypothesis. The literature on APOE e4 and TBI recovery is mixed, some
cohorts show slower recovery in carriers and others show nothing, so the prior mean is
small and positive and the interval easily covers zero. The BDNF Val66Met term carries no
direction at all: it only widens the variance of log k, which says "carriers are less
predictable" rather than "carriers are worse".
"""

import math

import numpy as np

# log(k_i)   ~ Normal(mu_k + b_e4*e4_i + b_fe4*e4_i*fem_i, s_k^2 + s_bdnf^2*met_i)
# logit(p_i) ~ Normal(mu_p + c_e4*e4_i + c_bio*zbio_i, s_p^2)
# c_e4  ~ Normal(0.15, 0.2^2)
# b_e4  ~ Normal(0, 0.2^2)
# b_fe4 ~ Normal(0, 0.2^2)
# c_bio ~ Normal(0, 0.2^2)
# e4_i  = APOE e4 allele count, 0 1 or 2
# fem_i = 1 when sex is F
# met_i = 1 when the patient carries BDNF Met
# zbio_i = latent injury severity z score from GFAP and UCH-L1
# k_i = weekly recovery rate, p_i = residual damage fraction at infinite time

HYPER = {
    "mu_k": math.log(0.25),      # 0.25 per week, about a 2.8 week damage half life
    "mu_p": math.log(0.15 / 0.85),  # logit(0.15), 15 percent residual damage
    "s_k": 0.4,
    "s_p": 0.5,
    "s_bdnf": 0.3,
    "b_e4": 0.0,
    "b_fe4": 0.0,
    "c_e4": 0.15,
    "c_bio": 0.0,
    "sd_effect": 0.2,
    "mu_eps": math.log(0.15),    # eps ~ lognormal(log 0.15, 0.25^2), strain threshold
    "s_eps": 0.25,
    "mu_G": 1.8,                 # global coupling, DMF working point, see DECISIONS.md
    "s_G": 0.35,
    "G_lo": 0.6,
    "G_hi": 3.0,
}


def logit(x: float) -> float:
    """log(x / (1 - x))."""
    return math.log(x / (1.0 - x))


def expit(x: float | np.ndarray):
    """1 / (1 + exp(-x)), stable for large magnitudes."""
    return 1.0 / (1.0 + np.exp(-np.clip(x, -40, 40)))


def draw_effects(rng: np.random.Generator) -> dict:
    """Sample the four genotype and biomarker effect sizes from their hyperpriors."""
    sd = HYPER["sd_effect"]
    return {
        "b_e4": float(rng.normal(HYPER["b_e4"], sd)),
        "b_fe4": float(rng.normal(HYPER["b_fe4"], sd)),
        "c_e4": float(rng.normal(HYPER["c_e4"], sd)),
        "c_bio": float(rng.normal(HYPER["c_bio"], sd)),
    }


def moments(geno: dict, zbio: float, sex: str, eff: dict | None = None) -> dict:
    """Prior mean and sd of log k and logit p for one patient."""
    eff = eff or {key: HYPER[key] for key in ("b_e4", "b_fe4", "c_e4", "c_bio")}
    e4 = float(geno.get("apoe_e4", 0))
    met = 1.0 if geno.get("bdnf_met") else 0.0
    fem = 1.0 if sex == "F" else 0.0

    # mean of log k, note b_e4 is positive toward slower recovery so it enters negatively
    mu_logk = HYPER["mu_k"] - eff["b_e4"] * e4 - eff["b_fe4"] * e4 * fem
    sd_logk = math.sqrt(HYPER["s_k"] ** 2 + (HYPER["s_bdnf"] ** 2) * met)
    mu_logitp = HYPER["mu_p"] + eff["c_e4"] * e4 + eff["c_bio"] * zbio
    sd_logitp = HYPER["s_p"]
    return {
        "mu_logk": mu_logk,
        "sd_logk": sd_logk,
        "mu_logitp": mu_logitp,
        "sd_logitp": sd_logitp,
    }


def draw_params(rng: np.random.Generator, geno: dict, zbio: float, sex: str, eff: dict | None = None) -> dict:
    """Sample one patient's true G, k, p, eps from the priors."""
    mom = moments(geno, zbio, sex, eff)
    logk = rng.normal(mom["mu_logk"], mom["sd_logk"])
    logitp = rng.normal(mom["mu_logitp"], mom["sd_logitp"])
    eps = float(np.exp(rng.normal(HYPER["mu_eps"], HYPER["s_eps"])))
    g = float(np.clip(rng.normal(HYPER["mu_G"], HYPER["s_G"]), HYPER["G_lo"], HYPER["G_hi"]))
    return {
        "G": g,
        "k": float(np.exp(logk)),
        "p": float(expit(logitp)),
        "eps": eps,
        "logk": float(logk),
        "logitp": float(logitp),
    }


def initial_ensemble(rng: np.random.Generator, geno: dict, zbio: float, sex: str, members: int = 200) -> np.ndarray:
    """Prior ensemble of [log k, logit p, log d0_scale], shape (members, 3)."""
    mom = moments(geno, zbio, sex)
    logk = rng.normal(mom["mu_logk"], mom["sd_logk"], members)
    logitp = rng.normal(mom["mu_logitp"], mom["sd_logitp"], members)
    # log d0_scale ~ Normal(0, 0.2^2), a multiplicative correction on the strain damage map
    logd0 = rng.normal(0.0, 0.2, members)
    return np.stack([logk, logitp, logd0], axis=1)
