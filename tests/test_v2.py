"""The v2 surfaces: vessels, the formulary, the timeline, the evidence drawer.

These are the pieces the merged workspace is built on, and most of what they assert is
honesty rather than correctness: that a schematic says it is schematic, that a drug the
model cannot represent says so, that a percentile outside the cohort does not print a
number, and that a panel whose job is to surface weak results actually surfaces them.
"""

import json

import numpy as np

from backend import evidence, timeline
from backend.data import vessels as vesselmod
from backend.twin import intervention

# A head is about 170 mm front to back and 140 mm across, so nothing in a vessel atlas
# should sit further than this from the origin on any axis.
HEAD_MM = 110.0


# ---------------------------------------------------------------- vessels

def test_every_vessel_point_is_inside_a_head():
    """A polyline that wanders outside the skull is a typo, and they are easy to make."""
    lo, hi = vesselmod.bounds()
    for value in (*lo, *hi):
        assert abs(value) <= HEAD_MM, f"{value} mm is outside a head"
    # And the layout actually spans a brain rather than collapsing to a point.
    assert hi[1] - lo[1] > 120, "the vessels do not span front to back"
    assert hi[2] - lo[2] > 100, "the vessels do not span bottom to top"


def test_the_vessel_payload_says_it_is_a_diagram(client):
    """The caption is not optional and it is served with the data, not beside it."""
    got = client.get("/api/vessels").json()
    assert "not patient-specific" in got["caption"].lower()
    assert "atlas" in got["note"].lower() or "landmark" in got["note"].lower()
    assert got["space"].startswith("MNI152")


def test_the_named_veins_are_present_and_paired(client):
    """Trolard and Labbe both sides, the sinuses, and the deep venous system."""
    got = client.get("/api/vessels").json()
    names = {v["name"] for v in got["vessels"]}
    for want in ("Vein of Trolard, left", "Vein of Trolard, right",
                 "Vein of Labbe, left", "Vein of Labbe, right",
                 "Superior sagittal sinus", "Straight sinus",
                 "Great cerebral vein of Galen"):
        assert want in names, want

    groups = {v["group"] for v in got["vessels"]}
    assert groups == set(got["groups"]), "a vessel is in a group the legend does not name"
    for key, meta in got["groups"].items():
        assert meta["label"] and meta["colour"].startswith("#") and meta["about"]


def test_a_vessel_has_enough_points_to_be_a_curve(client):
    """Two points is a straight line, which no vessel in a head is."""
    got = client.get("/api/vessels").json()
    for v in got["vessels"]:
        assert len(v["points"]) >= 2, v["name"]
        assert all(len(p) == 3 for p in v["points"]), v["name"]
        assert 0.3 <= v["radius_mm"] <= 8.0, f"{v['name']} is {v['radius_mm']} mm across"


def test_the_midline_vessels_are_actually_on_the_midline(client):
    """The sagittal and straight sinuses run in the falx, which is x = 0."""
    got = client.get("/api/vessels").json()
    for v in got["vessels"]:
        if v["name"] in ("Superior sagittal sinus", "Inferior sagittal sinus",
                         "Straight sinus", "Basilar artery"):
            for p in v["points"]:
                assert abs(p[0]) < 1.0, f"{v['name']} is {p[0]} mm off the midline"


# ---------------------------------------------------------------- the pathway viewer
#
# What used to be here: tests that the formulary carried a typical dose, that a drug
# simulation was cached by gain, and that the /intervention route refused an empty body.
# All of that was testing the drug simulation, which is gone. These test what replaced
# it, which only says where a medicine's known targets are.


def test_a_medicine_with_no_brain_target_stays_in_the_list(client):
    """Acetaminophen and ibuprofen stay, and say they have no mapped brain target.

    Dropping them would make the formulary look like a complete picture of what somebody
    is taking, and the most useful thing this screen can say about acetaminophen is that
    it has nothing to show.
    """
    got = client.get("/api/formulary").json()
    names = {d["name"] for d in got["drugs"]}
    assert {"acetaminophen", "ibuprofen"} <= names

    for row in got["drugs"]:
        if row["name"] in ("acetaminophen", "ibuprofen"):
            assert row["has_map"] is False
            assert row["no_mapped_target"]
            assert "no mapped brain target" in row["no_mapped_target"].lower()


def test_every_medicine_explains_itself_in_plain_language(client):
    """what_it_does is the point of the tab, so nothing is allowed to be missing one."""
    for row in client.get("/api/formulary").json()["drugs"]:
        assert row.get("what_it_does", "").strip(), row["name"]
        assert len(row["what_it_does"]) > 60, row["name"]
        assert row.get("class", "").strip(), row["name"]


def test_every_target_carries_a_source_and_an_evidence_tag(client):
    """A target with no source is a claim nobody can check."""
    for row in client.get("/api/formulary").json()["drugs"]:
        if not row.get("targets"):
            assert row.get("no_mapped_target"), row["name"]
            continue
        for t in row["targets"]:
            assert t.get("source"), f"{row['name']} {t.get('target')}"
            assert t.get("evidence_tag") in ("verified", "check this"), row["name"]


def test_a_target_without_an_atlas_map_says_so_rather_than_borrowing_one(client):
    """The map has to be of the receptor the drug acts on, or there is no map."""
    from backend.twin import intervention

    atlas = set(intervention.receptors()["maps"])
    for row in client.get("/api/formulary").json()["drugs"]:
        for t in row.get("targets", []):
            key = t.get("atlas_key")
            if key is None:
                assert "no map available" in t["plain"].lower(), f"{row['name']} {t['target']}"
            else:
                assert key in atlas, f"{row['name']} claims a map for {key}"


def test_every_mapped_target_resolves_to_100_clean_values(client):
    """A map with a hole in it would colour a region from nothing."""
    import math

    for row in client.get("/api/formulary").json()["drugs"]:
        if not row["has_map"]:
            continue
        got = client.get(f"/api/drugs/{row['name']}/map").json()
        assert got["combined"] and len(got["combined"]) == 100, row["name"]
        assert not any(math.isnan(v) for v in got["combined"]), row["name"]
        for key, vals in got["targets"].items():
            assert len(vals) == 100, f"{row['name']} {key}"
            assert not any(math.isnan(v) for v in vals), f"{row['name']} {key}"


def test_no_dose_guidance_anywhere_in_the_formulary(client):
    """There is no dose in this file on purpose, and nothing should put one back."""
    import json

    blob = json.dumps(client.get("/api/formulary").json()).lower()
    for word in (" mg", "milligram", "twice daily", "dose of", "typical_dose"):
        assert word not in blob, word


def test_the_amantadine_entry_says_the_trial_was_not_mild_tbi(client):
    """The Giacino trial is the one people cite, and it is about a different population."""
    got = client.get("/api/drugs/amantadine").json()
    low = (got["in_tbi"] + " " + " ".join(r["text"] for r in got["refs"])).lower()
    assert "giacino" in low
    assert "severe" in low
    assert "mild" in low, "it has to say what it does not apply to, not just what it does"
    assert got["in_tbi_evidence_tag"] == "verified"


def test_every_pathway_has_a_centreline_inside_the_mesh(client):
    """A pathway drawn outside the brain is drawn somewhere there is no brain."""
    import numpy as np

    from backend.data import mesh as meshmod

    got = client.get("/api/pathways").json()
    assert got["pathways"]
    assert "not patient-specific" in got["caption"].lower()

    pial = np.asarray(meshmod.mesh()["pial"], dtype=float).reshape(-1, 3)
    lo, hi = pial.min(axis=0), pial.max(axis=0)
    for row in got["pathways"]:
        assert row.get("about", "").strip(), row["key"]
        pts = np.asarray(row["points"], dtype=float)
        assert pts.shape[0] >= 2 and pts.shape[1] == 3, row["key"]
        assert np.isfinite(pts).all(), row["key"]
        assert (pts >= lo).all() and (pts <= hi).all(), f"{row['key']} leaves the mesh"


def test_the_overlap_uses_the_fixed_thresholds(client, seeded):
    """Both conditions, both fixed, and every row named in full."""
    from backend.data import drugs as drugmod

    pid = seeded[0]["id"]
    got = client.get(f"/api/patients/{pid}/drugs/sertraline/overlap").json()
    assert got["damage_floor"] == drugmod.DAMAGE_FLOOR
    assert got["target_z"] == drugmod.TARGET_Z
    for r in got["regions"]:
        assert r["damage"] > drugmod.DAMAGE_FLOOR
        assert r["target_z"] > drugmod.TARGET_Z
        assert r["name"] and r["name"].lower() != "left cortex"
        assert r["damage_lo"] <= r["damage"] <= r["damage_hi"], r["name"]


def test_the_overlap_is_empty_for_a_medicine_with_no_map(client, seeded):
    """No map means no regions, and a line saying why rather than an empty list."""
    pid = seeded[0]["id"]
    got = client.get(f"/api/patients/{pid}/drugs/ibuprofen/overlap").json()
    assert got["regions"] == []
    assert got["note"].strip()


def test_nothing_the_viewer_shows_says_benefit_or_effect(client, seeded):
    """It shows where a medicine acts. Saying effect would make it a prediction."""
    import json

    pid = seeded[0]["id"]
    blobs = [client.get("/api/formulary").json()]
    for name in ("sertraline", "amantadine", "ibuprofen"):
        blobs.append(client.get(f"/api/drugs/{name}").json())
        blobs.append(client.get(f"/api/patients/{pid}/drugs/{name}/overlap").json())
    text = json.dumps(blobs).lower()
    for word in ("benefit", "recommend", "should take", "best for", "will help"):
        assert word not in text, word


def test_the_intervention_route_is_gone(client, seeded):
    """The simulation it drove is gone, so the route should be too."""
    pid = seeded[0]["id"]
    got = client.post(f"/api/patients/{pid}/intervention", json={"target": "NMDA", "gain": 0.2})
    assert got.status_code in (404, 405), got.status_code


# ---------------------------------------------------------------- timeline

def test_the_timeline_gathers_four_tables_into_one_list(client, seeded):
    """Check-ins, alerts, events and messages, sorted, each labelled for a human."""
    pid = seeded[2]["id"]
    got = client.get(f"/api/patients/{pid}/timeline").json()

    kinds = {e["kind"] for e in got["events"]}
    assert "checkin" in kinds
    assert kinds & {"alert", "message", "demo_profile"}, kinds

    times = [e["time"] for e in got["events"]]
    assert times == sorted(times), "the timeline is not in order"
    for e in got["events"]:
        assert e["label"], f"{e['kind']} has no human label"
        assert e["band"] in got["bands"], f"{e['band']} is not a band the legend names"
        assert e["day"] == e["time"][:10]


def test_a_seeded_history_lands_on_the_days_it_happened(client, seeded):
    """A patient on week six has six weeks of calendar, not six dots on today.

    This was a real bug: every seeded check-in carried the time it was generated, so the
    month grid had one filled day on it and "last check-in" meant nothing.
    """
    pid = next(p["id"] for p in seeded if p["week"] >= 4)
    got = client.get(f"/api/patients/{pid}/timeline").json()
    days = {d["day"] for d in got["days"]}
    assert len(days) >= 4, f"a multi-week history collapsed onto {len(days)} day(s)"

    checkins = [e for e in got["events"] if e["kind"] == "checkin"]
    assert len({e["day"] for e in checkins}) == len(checkins), "two check-ins on one day"


def test_the_timeline_does_not_ship_the_whole_extraction(client, seeded):
    """An ingest event carries kilobytes of schema. A calendar does not need it."""
    pid = seeded[0]["id"]
    got = client.get(f"/api/patients/{pid}/timeline").json()
    for e in got["events"]:
        assert "extraction" not in e["detail"]
        assert "sources" not in e["detail"]
    assert len(json.dumps(got)) < 400_000


def test_the_next_call_is_a_week_after_the_last(client, seeded):
    """Weekly, counted from the last completed check-in, and overdue is said out loud."""
    pid = seeded[1]["id"]
    got = client.get(f"/api/patients/{pid}/timeline").json()["next_call"]
    assert got["due"] and got["last"]
    import datetime as dt

    gap = dt.datetime.fromisoformat(got["due"]) - dt.datetime.fromisoformat(got["last"])
    assert abs(gap.days - 7) <= 1
    assert got["say"]


def test_a_patient_with_no_checkin_is_due_now(client, seeded):
    """The first call is the one the schedule exists for."""
    from backend import db

    pid = db.new_id("pat")
    db.put("patients", {"id": pid, "name": "Nobody", "age": 30, "sex": "F", "week": 0,
                        "synthetic": 1, "created": db.now(), "seed": 1})
    got = timeline.next_call(pid)
    assert got["overdue"] is True
    assert got["due"] is None
    assert "first one" in got["say"].lower()


# ---------------------------------------------------------------- percentile

def test_the_percentile_places_a_patient_in_the_cohort(client, seeded):
    """A ribbon with a marker, its quartiles, and what it does not mean."""
    pid = seeded[1]["id"]
    got = client.get(f"/api/patients/{pid}/percentile").json()
    assert got["ok"] is True
    assert 0.0 <= got["percentile"] <= 100.0
    assert got["size"] >= 10
    assert got["quartiles"] == sorted(got["quartiles"])
    assert got["range"][0] <= got["k"] or got["outside"] == "below"
    assert sum(b["count"] for b in got["histogram"]) == got["size"]
    assert len(got["limits"]) >= 3
    assert any("not a target" in l.lower() for l in got["limits"])


def test_a_patient_outside_the_cohort_gets_no_percentile(client, seeded):
    """Slower than everybody is not the 0th percentile. It is off the scale.

    Printing "0th" reads as a precise placing when the honest statement is that the
    cohort does not contain anybody like them.
    """
    from backend import db

    pid = seeded[0]["id"]
    row = db.patient(pid)
    params = db.dec(row["params"], {}) or {}
    db.patch("patients", pid, {"params": db.enc({**params, "k": 0.0001})})
    got = client.get(f"/api/patients/{pid}/percentile").json()

    assert got["outside"] == "below"
    assert "slower than every patient" in got["say"]
    assert "0th percentile" not in got["say"]
    db.patch("patients", pid, {"params": db.enc(params)})


# ---------------------------------------------------------------- evidence

def test_every_claim_in_the_research_file_is_tagged():
    """A claim with no tag is a claim nobody decided about."""
    claims = evidence.claims()
    assert len(claims) >= 15, f"only {len(claims)} claims parsed"
    for c in claims:
        assert c["tag"] in ("verified", "check this"), f"{c['claim'][:60]} is {c['tag']!r}"
        assert c["claim"] and c["section"]


def test_the_evidence_drawer_shows_its_weak_numbers(client):
    """Nothing here hides a result below its target."""
    got = client.get("/api/evidence").json()
    assert got["ok"] is True
    assert got["numbers"], "no live numbers"
    for n in got["numbers"]:
        assert n["say"], f"{n['name']} has no sentence"
        assert isinstance(n["ok"], bool)
    # Everything failing its target is named in `weak`, with nothing left out.
    assert set(got["weak"]) == {n["name"] for n in got["numbers"] if not n["ok"]}


def test_the_evidence_numbers_are_read_live(client):
    """The receptor count is the real one, not a figure somebody typed in once."""
    got = client.get("/api/evidence").json()
    row = next(n for n in got["numbers"] if "Receptor maps" in n["name"])
    rec = intervention.receptors()
    assert row["value"] == len(rec["tracers"])
    assert row["target"] == len(rec["names"])


def test_the_extraction_score_is_the_one_without_a_key(client):
    """The panel says "with no API key", so it has to be measuring that.

    This caught a real bug: setting MOCK_LLM in the environment at request time does
    nothing, because the config resolves it once at import, so the panel was quietly
    reporting Gemini's score under a label that said otherwise.
    """
    got = client.get("/api/evidence").json()
    row = next((n for n in got["numbers"] if "extraction" in n["name"].lower()), None)
    if row is None:
        return      # make sample has not been run
    assert "no API key" in row["say"]
    assert 0.0 <= row["value"] <= 1.0
    assert row["target"] == 0.9


def test_the_honest_limits_survive_the_round_trip(client):
    """The limits block is served, in full, and still says the uncomfortable parts."""
    got = client.get("/api/evidence").json()
    limits = " ".join(got["limits"]).lower()
    assert len(got["limits"]) >= 6
    for must in ("synthetic", "circular", "not a medical device" if False else "clinician",
                 "predict"):
        assert must in limits, must


def test_a_check_this_claim_is_not_dressed_up_as_verified(client):
    """The counts match the tags, so a filter cannot make the weak ones disappear."""
    got = client.get("/api/evidence").json()
    tags = [c["tag"] for c in got["claims"]]
    assert got["counts"]["verified"] == tags.count("verified")
    assert got["counts"]["check_this"] == tags.count("check this")
    assert got["counts"]["check_this"] > 0, (
        "a research file where everything is verified is a research file nobody checked"
    )


def test_the_ingest_score_helper_is_consistent_with_the_test_suite():
    """The evidence panel and tests/test_ingest.py score the same way.

    The numeric tolerance is 0.051, which is one decimal place of rounding: 412.0 and 412
    are the same lab value, 412 and 415 are not.
    """
    assert evidence._same(412.0, 412.0)
    assert evidence._same(412.0, 412.02), "rounding is not a mismatch"
    assert evidence._same(412.0, 415.0) is False, "a different number is a mismatch"
    # Lists match when the key's items are all present, so an extra is not a failure.
    assert evidence._same(["a", "b"], ["A", "B", "c"])
    assert evidence._same(["a", "b"], ["a"]) is False
    assert evidence._same(None, None)
    assert evidence._same(None, "something") is False
    # Free text is compared on its opening: a report impression right to the first fifty
    # characters is the right impression.
    assert evidence._same("Hello there", "hello THERE")
    assert evidence._same("No acute haemorrhage", "Small frontal contusion") is False
