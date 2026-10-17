"""The dynamic mean field model, the G fit, the emulator and the forecast."""

import numpy as np

from backend.data import synthetic as syn
from backend.data.templates import templates
from backend.twin import dmf, forecast as fcast, priors, strain, surrogate as sg

G_TOLERANCE = 0.15


def test_dmf_runs_and_is_finite():
    """A short run returns finite gating, rate and BOLD at a sensible working point."""
    sc = templates()["sc"]
    got = dmf.simulate(sc, 1.8, dur_s=4.0, seed=1)
    for key in ("s", "rate", "bold"):
        assert np.isfinite(got[key]).all(), f"{key} has non finite values"
        assert got[key].shape[1] == 100
    assert 0.0 < float(got["s"].mean()) < 1.0
    assert 0.2 < float(got["rate"].mean()) < 20.0, "firing rate is outside any plausible range"


def test_linear_response_is_stable_and_structured():
    """The analytic FC is stable, correlates with SC, and rises with coupling."""
    sc = templates()["sc"]
    fc = dmf.fc_lin(sc, 1.8)
    assert np.isfinite(fc).all()
    assert dmf.fc_corr(fc, sc) > 0.3, "FC should carry the structure of SC"
    levels = [float(dmf.upper(dmf.fc_lin(sc, g)).mean()) for g in (1.0, 2.0, 3.0)]
    assert levels[0] < levels[1] < levels[2], "mean FC should rise with G"


def test_fit_g_recovers_true_g():
    """fit_G recovers the true G within 15 percent on five synthetic patients."""
    sc = templates()["sc"]
    rng = np.random.default_rng(0)
    errs = []
    for gt in (1.2, 1.6, 2.0, 2.4, 2.8):
        noise = rng.normal(0, 0.2, sc.shape)
        scp = sc * np.exp(0.5 * (noise + noise.T))
        np.fill_diagonal(scp, 0.0)
        emp = dmf.fc_emp_of(scp, gt, seed=int(gt * 10))
        got = dmf.fit_G(scp, emp)
        errs.append(abs(got["G"] - gt) / gt)
    assert max(errs) < G_TOLERANCE, f"worst G error was {max(errs):.1%}"


def test_surrogate_is_monotone_in_damage():
    """Every emulator summary moves one way as damage rises, and z_of interpolates."""
    tab = sg.build()
    assert tab["z"].shape == (sg.LEVELS, 4)
    for col in range(4):
        series = tab["z"][:, col]
        assert np.all(np.diff(series) <= 1e-12), f"summary {sg.KEYS[col]} is not monotone"
    one = sg.z_of(0.3)
    many = sg.z_of(np.array([0.0, 0.3, 1.0]))
    assert one.shape == (4,) and many.shape == (3, 4)
    assert np.allclose(one, many[1])


def test_strain_respects_helmet_and_angle():
    """Helmet B passes less strain than A, and the angle changes the damage map."""
    a = strain.strain(0.0, "frontal", "A", 0.6)
    b = strain.strain(0.0, "frontal", "B", 0.6)
    assert float(b.mean()) < float(a.mean())
    turned = strain.strain(90.0, "frontal", "A", 0.6)
    assert float(np.abs(turned - a).mean()) > 1e-6, "rotating the impact should change strain"
    dmg = strain.damage0(a, 0.15, 0.0)
    assert dmg.min() >= 0.0 and dmg.max() <= 0.95


def test_forecast_decays_toward_the_residual():
    """Damage decays to p times its start, and the observables follow it."""
    wk = np.asarray(fcast.weeks(), dtype=float)
    d = fcast.d_of(0.12, 0.25, 0.15, wk)
    assert d[0] > d[-1]
    assert abs(d[-1] - 0.12 * 0.15) < 0.02, "week 12 should be close to the residual floor"
    y = fcast.truth(0.12, 0.25, 0.15, noise=False)
    assert y.shape == (13, 6)
    pursuit = y[:, fcast.KEYS.index("pursuit_gain")]
    symptoms = y[:, fcast.KEYS.index("symptom_total")]
    assert pursuit[-1] > pursuit[0], "pursuit gain should recover upward"
    assert symptoms[-1] < symptoms[0], "symptoms should fall"


def test_forecast_bands_bracket_the_mean():
    """The 80 percent band is ordered and widens for a low fidelity twin."""
    rng = np.random.default_rng(3)
    ens = priors.initial_ensemble(rng, {"apoe_e4": 1, "bdnf_met": False}, 0.3, "F", 200)
    narrow = fcast.spread(ens, 0.12, widen=1.0)
    wide = fcast.spread(ens, 0.12, widen=1.3)
    assert (narrow["lo"] <= narrow["mean"]).all() and (narrow["mean"] <= narrow["hi"]).all()
    assert ((wide["hi"] - wide["lo"]) >= (narrow["hi"] - narrow["lo"]) - 1e-9).all()


def test_synthetic_patient_is_complete_and_labelled():
    """A synthetic patient carries every field the twin needs, and says it is synthetic."""
    pat = syn.make_patient(11)
    assert pat["synthetic"] is True
    assert pat["alleles"]["apoe_e4"] in (0, 1, 2)
    assert pat["alleles"]["comt"] in ("Val/Val", "Val/Met", "Met/Met")
    assert 16 <= pat["age"] <= 60 and pat["sex"] in ("F", "M")
    assert 0.0 < pat["d0_true"] < 0.6
    assert pat["sc"].shape == (100, 100) and np.isfinite(pat["fc_emp"]).all()
    assert set(pat["truth"]) == set(range(13))
    assert set(pat["truth"][0]) == set(fcast.KEYS)


def test_priors_carry_the_genotype_terms():
    """APOE shifts the mean of log k and BDNF widens its variance, as specified."""
    plain = priors.moments({"apoe_e4": 0, "bdnf_met": False}, 0.0, "M", {"b_e4": 0.2, "b_fe4": 0.0, "c_e4": 0.15, "c_bio": 0.0})
    carrier = priors.moments({"apoe_e4": 2, "bdnf_met": False}, 0.0, "M", {"b_e4": 0.2, "b_fe4": 0.0, "c_e4": 0.15, "c_bio": 0.0})
    assert carrier["mu_logk"] < plain["mu_logk"], "e4 should slow recovery under this prior"
    assert carrier["mu_logitp"] > plain["mu_logitp"], "e4 should raise residual damage"
    met = priors.moments({"apoe_e4": 0, "bdnf_met": True}, 0.0, "M")
    assert met["sd_logk"] > plain["sd_logk"], "BDNF Met should widen the variance, not shift it"
