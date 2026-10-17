"""The ensemble Kalman filter and the population layer, over the 50 patient cohort."""

import warnings

import numpy as np

from backend.twin import enkf, forecast as fcast, population, priors

COV_LO, COV_HI = 0.65, 0.90
CONTRACTION_MIN = 0.30


def by_week(rows: list[dict], key: str) -> dict:
    """Mean of one diagnostic per week across the cohort."""
    acc: dict[int, list[float]] = {}
    for r in rows:
        acc.setdefault(int(r["week"]), []).append(float(r[key]))
    return {w: float(np.mean(v)) for w, v in acc.items()}


def test_coverage_is_calibrated_by_week_8(cohort):
    """One-step-ahead coverage of the 80 percent band sits inside 0.65 to 0.9 at week 8."""
    cov = by_week(cohort["coverage"], "cov")
    assert 8 in cov, "the cohort run should reach week 8"
    assert COV_LO <= cov[8] <= COV_HI, f"week 8 coverage was {cov[8]:.3f}"


def test_contraction_of_log_k_by_week_6(cohort):
    """Posterior contraction of log k is above 0.3 by week 6."""
    rows = cohort["rows"]
    got = float(np.mean([r["contraction"] for r in rows]))
    assert got > CONTRACTION_MIN, f"contraction after 12 weeks was only {got:.3f}"

    # And specifically by week 6, re-running six weeks on a slice of the cohort.
    from backend.data import synthetic as syn

    eff = syn.cohort_effects()
    vals = []
    for i in range(20):
        pat = syn.make_patient(2000 + i, eff=eff)
        state = enkf.init(np.random.default_rng(3000 + i), pat["alleles"], pat["zbio"],
                          pat["sex"], pat["d0_true"])
        for week in range(0, 7):
            enkf.step(state, week, pat["truth"][week], seed=i)
        vals.append(state["contraction"]["k"])
    week6 = float(np.mean(vals))
    assert week6 > CONTRACTION_MIN, f"contraction at week 6 was only {week6:.3f}"


def test_k_estimates_track_the_truth(cohort):
    """Estimated recovery rates correlate with the true ones across the cohort."""
    rows = cohort["rows"]
    kt = np.array([r["k_true"] for r in rows])
    ke = np.array([r["k_est"] for r in rows])
    assert np.isfinite(ke).all()
    assert float(np.corrcoef(kt, ke)[0, 1]) > 0.4


def test_tier_b_is_dropped_when_the_flash_fails():
    """A failed flash test removes every tier B observable from the update."""
    have = {o["key"]: 1.0 for o in fcast.OBS}
    with_flash = enkf.use_keys(True, have)
    without = enkf.use_keys(False, have)
    tier_b = [i for i, o in enumerate(fcast.OBS) if o["tier"] == "B"]
    assert tier_b, "there should be tier B observables to drop"
    assert set(without) == set(with_flash) - set(tier_b)


def test_drift_z_is_signed_toward_worse():
    """A patient getting worse than forecast produces a positive drift z."""
    rng = np.random.default_rng(5)
    geno = {"apoe_e4": 0, "bdnf_met": False}
    state = enkf.init(rng, geno, 0.0, "M", 0.12)
    truth = fcast.truth(0.12, 0.25, 0.15, seed=1, noise=False)
    for week in range(0, 4):
        enkf.step(state, week, {o["key"]: float(truth[week, i]) for i, o in enumerate(fcast.OBS)}, seed=1)
    calm = state["drift_z"]

    worse = {}
    for i, o in enumerate(fcast.OBS):
        step = 4.0 * enkf.sem_of(o["key"]) * (1.0 if o["load"] > 0 else -1.0)
        worse[o["key"]] = float(truth[4, i] + step)
    enkf.step(state, 4, worse, seed=1)
    enkf.step(state, 5, worse, seed=1)
    assert state["drift_z"] > calm
    assert state["drift_z"] > 2.0, f"a four SEM worsening should read above 2, got {state['drift_z']:.2f}"


def test_population_recovers_the_effects(cohort):
    """The population layer gets the sign of c_bio right, and reports c_e4 honestly."""
    fitted = population.fit(cohort["rows"], seed=5)
    eff = cohort["eff"]
    got = population.cohort_json(cohort["rows"], [], eff, fitted)
    assert got["size"] == 50
    assert {e["name"] for e in got["effects"]} == set(population.EFFECTS)

    c_bio = next(e for e in got["effects"] if e["name"] == "c_bio")
    assert np.sign(c_bio["est"]) == np.sign(c_bio["true"]), (
        f"c_bio sign not recovered: true {c_bio['true']:.3f}, est {c_bio['est']:.3f}"
    )

    c_e4 = next(e for e in got["effects"] if e["name"] == "c_e4")
    if not c_e4["lo"] <= c_e4["true"] <= c_e4["hi"]:
        # A warning, not a failure, exactly as the brief asks.
        warnings.warn(
            f"true c_e4 {c_e4['true']:.3f} is outside its 90% interval "
            f"[{c_e4['lo']:.3f}, {c_e4['hi']:.3f}]. With 50 patients and a prior centred on "
            f"{priors.HYPER['c_e4']}, that happens some of the time.",
            stacklevel=1,
        )


def test_cohort_json_matches_the_contract(cohort):
    """The Cohort object has every field the frontend reads."""
    fitted = population.fit(cohort["rows"], seed=5)
    cov = [{"week": w, "cov": 0.8} for w in range(13)]
    got = population.cohort_json(cohort["rows"], cov, cohort["eff"], fitted)
    assert set(got) == {"weeks", "coverage", "k_true", "k_est", "effects", "size"}
    assert len(got["k_true"]) == len(got["k_est"]) == got["size"]
    for row in got["effects"]:
        assert set(row) == {"name", "true", "est", "lo", "hi"}
