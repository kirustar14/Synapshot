"""The cortical surface, the per person shape, the damage bands and the what-if.

These pass against either mesh source. The real fsaverage5 surface needs the network on
the first run, and the tests force OFFLINE=1, so on a clean checkout without a prebuilt
data/mesh.json the procedural fallback is what gets checked. Every assertion below is
true of both, which is the point: the viewer must work either way.
"""

import numpy as np

from backend import db
from backend.data import mesh as meshmod
from backend.twin import build, intervention, loadings, shape

REG = 100


def test_mesh_labels_every_region_is_present():
    """All 100 regions appear on the surface, and no vertex is left unlabelled."""
    got = meshmod.arrays()
    lab = got["labels"]
    assert lab.min() >= 0, "every vertex gets a label, the medial wall takes its neighbour's"
    assert lab.max() == REG - 1
    assert len(set(lab.tolist())) == REG


def test_mesh_arrays_line_up():
    """Positions, the inflated surface, labels and borders are all the same length."""
    got = meshmod.arrays()
    verts = got["pial"].shape[0]
    assert verts > 15000, "the viewer is built for about 20k vertices"
    assert got["inflated"].shape == got["pial"].shape
    assert got["labels"].shape[0] == verts
    assert got["border"].shape[0] == verts
    assert got["faces"].max() < verts, "no face indexes past the end of the vertex arrays"
    assert got["faces"].min() >= 0


def test_mesh_is_centred_on_the_origin():
    """Both surfaces are centred, so the viewer can orbit without an offset."""
    got = meshmod.arrays()
    assert np.allclose(got["pial"].mean(axis=0), 0.0, atol=0.5)
    assert np.allclose(got["inflated"].mean(axis=0), 0.0, atol=0.5)


def test_region_centroids_sit_on_the_surface():
    """Every centroid is within 5 mm of a vertex of its own region.

    A plain mean of a curved parcel's vertices sits up to 6 mm inside it, which leaves
    tract endpoints floating under the cortex, so the centroid is the region's own vertex
    nearest that mean.
    """
    got = meshmod.arrays()
    pos, lab, cent = got["pial"], got["labels"], got["region_xyz"]
    assert cent.shape == (REG, 3)
    worst = 0.0
    for i in range(REG):
        own = pos[lab == i]
        assert own.shape[0] > 0, f"region {i} has no vertices"
        worst = max(worst, float(np.linalg.norm(own - cent[i], axis=1).min()))
    assert worst <= 5.0, f"worst centroid is {worst:.2f} mm off the surface"


def test_border_flags_exist_and_are_a_minority():
    """Region seams are marked, and most of the surface is not a seam."""
    got = meshmod.arrays()
    border = got["border"]
    share = float(border.mean())
    assert set(border.tolist()) <= {0, 1}
    assert share > 0.01, "no borders were found at all"
    assert share < 0.5, f"{share:.0%} of vertices are on a seam, which is not a minority"


def test_every_region_has_a_lobe_and_a_network():
    """Each region carries a plain English area tag and its seven network label."""
    got = meshmod.mesh()
    assert len(got["lobes"]) == REG
    assert len(got["networks"]) == REG
    assert len(got["region_names"]) == REG
    assert all(isinstance(v, str) and v for v in got["lobes"])
    assert all(isinstance(v, str) and v for v in got["networks"])
    # The tags are approximate by design, but they must come from the documented set.
    allowed = {"frontal", "parietal", "temporal", "occipital", "cingulate", "insula",
               "sensorimotor", "orbitofrontal", "temporal pole", "cortex"}
    assert set(got["lobes"]) <= allowed


def test_shape_has_thirteen_swelling_values(seeded):
    """The impact bump is given for every week of the forecast, 0 to 12."""
    pid = seeded[0]["id"]
    got = shape.shape_of(pid)
    assert len(got["impact"]["amp"]) == 13
    assert got["impact"]["amp"][0] >= got["impact"]["amp"][-1], "swelling settles, it does not grow"
    assert got["impact"]["radius"] == 25.0
    assert len(got["scale"]) == 3
    assert 0.0 <= got["atrophy"] <= 0.05
    assert len(got["thick_z"]) == REG
    assert got["source"] in ("synthetic", "freesurfer")


def test_shape_impact_lands_on_the_surface(seeded):
    """The impact vertex is a real vertex and its point is that vertex."""
    pid = seeded[0]["id"]
    got = shape.shape_of(pid)
    pos = meshmod.arrays()["pial"]
    idx = got["impact"]["vertex"]
    assert 0 <= idx < pos.shape[0]
    assert np.allclose(pos[idx], np.asarray(got["impact"]["point"]), atol=0.05)


def test_template_diff_is_per_vertex_and_small(seeded):
    """The personalization displacement covers every vertex and stays millimetre sized."""
    pid = seeded[0]["id"]
    got = shape.shape_of(pid)
    diff = np.asarray(got["template_diff"])
    assert diff.shape[0] == meshmod.arrays()["pial"].shape[0]
    assert np.isfinite(diff).all()
    assert diff.min() >= 0.0
    assert diff.max() < 25.0, "a person's brain is not 25 mm away from the template"


def test_damage_bands_bracket_the_mean(seeded):
    """damage_lo <= damage <= damage_hi for every region and every week."""
    for row in seeded:
        twin = build.build_twin(row["id"])["twin"]
        for reg in twin["regions"]:
            lo = np.asarray(reg["damage_lo"])
            mid = np.asarray(reg["damage"])
            hi = np.asarray(reg["damage_hi"])
            assert lo.shape == mid.shape == hi.shape
            assert (lo <= mid + 1e-9).all(), f"region {reg['id']} has a low band above its mean"
            assert (mid <= hi + 1e-9).all(), f"region {reg['id']} has a high band below its mean"


def test_regions_carry_recovery_and_network(seeded):
    """Every region reports its healing ratio and its network."""
    twin = build.build_twin(seeded[0]["id"])["twin"]
    nets = {"Visual", "SomMot", "DorsAttn", "SalVentAttn", "Limbic", "Cont", "Default", "Other"}
    for reg in twin["regions"]:
        assert reg["network"] in nets
        assert np.isfinite(reg["recovery"])
        assert reg["recovery"] > 0.0
    # One global recovery rate in this model, so the value is the same everywhere. The
    # healing layer is uniform and the UI says so.
    assert len({r["recovery"] for r in twin["regions"]}) == 1


def test_activity_is_healthy_at_zero_and_recovers(seeded):
    """Activity is a deviation from the healthy rate, so it climbs back toward zero."""
    twin = build.build_twin(seeded[0]["id"])["twin"]
    act = np.array([r["activity"] for r in twin["regions"]])
    assert act.shape[1] == 13
    assert np.isfinite(act).all()
    assert abs(act[:, -1].mean()) < abs(act[:, 0].mean()), "activity should recover over 12 weeks"


def test_receptors_are_five_maps_of_a_hundred():
    """Five receptor maps, one value per region, labelled if they are a stand-in."""
    got = intervention.receptors()
    assert set(got["names"]) == {"GABA-A", "NMDA", "D2", "5-HT2A", "mu-opioid"}
    for name in got["names"]:
        arr = np.asarray(got["maps"][name])
        assert arr.shape == (REG,)
        assert np.isfinite(arr).all()
    assert isinstance(got["synthetic_template"], bool)


def test_intervention_is_finite_for_every_target(seeded):
    """All five targets return a finite per region effect and the disclaimer."""
    pid = seeded[0]["id"]
    for target in intervention.receptors()["names"]:
        got = intervention.run(pid, target, 0.3)
        eff = np.asarray(got["region_effect"])
        assert eff.shape == (REG,)
        assert np.isfinite(eff).all()
        for key in ("fc_strength", "rate", "metastability"):
            assert np.isfinite(got["summary_delta"][key])
        assert got["note"] == intervention.NOTE
        assert "not a treatment recommendation" in got["note"].lower()


def test_intervention_gain_is_clamped(seeded):
    """A wild gain is clamped rather than run."""
    pid = seeded[0]["id"]
    assert intervention.run(pid, "NMDA", 99.0)["gain"] == intervention.GAIN_HI
    assert intervention.run(pid, "NMDA", -99.0)["gain"] == intervention.GAIN_LO


def test_intervention_never_touches_the_forecast(seeded):
    """Running a what-if leaves the stored forecast, the filter and the alerts alone."""
    pid = seeded[0]["id"]
    before = db.dec(db.latest_forecast(pid)["payload"], {})
    state_before = str(db.patient(pid)["state"])
    alerts_before = len(db.alerts(pid))

    intervention.run(pid, "GABA-A", 0.5)

    after = db.dec(db.latest_forecast(pid)["payload"], {})
    assert after == before, "the what-if changed the forecast"
    assert str(db.patient(pid)["state"]) == state_before, "the what-if moved the filter"
    assert len(db.alerts(pid)) == alerts_before, "the what-if raised an alert"


def test_no_summary_mentions_an_intervention(seeded):
    """No patient facing or clinician string carries a receptor or a drug word."""
    from backend.agent import summary

    pid = seeded[0]["id"]
    intervention.run(pid, "D2", 0.4)
    row = db.patient(pid)
    both = summary.for_checkin(pid, int(row["week"] or 0))
    banned = ["gaba", "nmda", "receptor", "dopamine", "serotonin", "opioid", "d2",
              "5-ht2a", "intervention", "what-if", "gain"]
    for which, text in both.items():
        low = str(text).lower()
        for word in banned:
            assert word not in low, f"the {which} summary mentions {word}"


def test_loadings_are_off_by_default_and_well_formed():
    """The flag is off, and when it is on every row is a proper weighting."""
    assert not loadings.enabled(), "regional loadings must default to off"
    mat = loadings.matrix()
    assert mat.shape == (6, REG)
    assert (mat >= 0).all(), "a loading cannot be negative"
    assert np.allclose(mat.sum(axis=1), 1.0), "each signal's weights must sum to 1"
    # A uniform damage field has to give every signal the same level, which is what keeps
    # the forecast calibrated when the flag is turned on.
    flat = np.full(REG, 0.17)
    assert np.allclose(loadings.d_per_signal(flat), 0.17)


def test_loadings_separate_the_signals():
    """Different signals weight different networks, so their damage levels can differ."""
    mat = loadings.matrix()
    rows = {key: mat[i] for i, key in enumerate(loadings.keys())}
    assert not np.allclose(rows["pursuit_gain"], rows["recall_delayed"]), \
        "eye and memory signals should not read the same regions"
    # Speech is left weighted, so its left hemisphere share is above half.
    left = rows["speech_rate"][:50].sum()
    assert left > 0.55, f"speech loads {left:.2f} on the left, expected a left bias"
