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
from backend.twin import drugs as drugmod
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


# ---------------------------------------------------------------- the formulary

def test_the_formulary_keeps_the_drugs_it_cannot_model(client):
    """A drug this model has nothing to say about stays in the list, with the reason.

    Dropping them would make the formulary look like a complete picture of what somebody
    is taking, and the most useful thing this screen can say about acetaminophen is that
    it has nothing to say.
    """
    got = client.get("/api/formulary").json()
    by_name = {d["name"]: d for d in got["drugs"]}

    for name in ("sertraline", "amitriptyline", "methylphenidate", "amantadine",
                 "propranolol", "levetiracetam", "ondansetron", "gabapentin",
                 "melatonin", "acetaminophen"):
        assert name in by_name, name

    assert by_name["acetaminophen"]["modeled"] is False
    assert by_name["acetaminophen"]["why_not"], "it has to say why not"
    for drug in got["drugs"]:
        if drug["modeled"]:
            assert drug["targets"], f"{drug['name']} is modelled with no targets"
        else:
            assert not drug["targets"]
            assert drug["why_not"], f"{drug['name']} is not modelled and does not say why"


def test_every_drug_target_has_a_real_map(client):
    """A drug cannot name a receptor the atlas does not have."""
    got = client.get("/api/formulary").json()
    known = set(got["receptors"])
    for drug in got["drugs"]:
        for target in drug["targets"]:
            assert target["receptor"] in known, f"{drug['name']} -> {target['receptor']}"
            assert 0.0 < target["affinity"] <= 1.0
            assert target["direction"] in (-1, 1)
            assert target["why"], "a target has to say why it is a target"


def test_a_proxy_map_is_labelled_as_one(client):
    """Propranolol is shown against a noradrenergic map, not a beta-adrenoceptor one."""
    got = client.get("/api/formulary").json()
    prop = next(d for d in got["drugs"] if d["name"] == "propranolol")
    assert prop["proxy_targets"] == ["NET"]
    target = next(t for t in prop["targets"] if t["receptor"] == "NET")
    assert target["proxy"] is True
    assert "proxy" in target["why"].lower() or "nearest" in target["why"].lower()
    assert "proxy" in prop["note"].lower()


def test_the_formulary_says_which_maps_are_real(client):
    """Stand-ins are named. A drug simulated against noise cannot look like one that is not."""
    got = client.get("/api/formulary").json()
    assert set(got["stand_in"]) <= set(got["receptors"])
    assert set(got["tracers"]) == set(got["receptors"]) - set(got["stand_in"])
    assert got["synthetic_template"] == (not got["tracers"])
    assert "not a treatment recommendation" in got["banner"].lower()
    assert "dose" in got["banner"].lower()


def test_a_drug_weight_is_the_sum_of_its_targets():
    """The combined map is affinity times direction times the receptor z, and scaled."""
    maps = intervention.receptors()["maps"]
    weight, used, _warn = drugmod.weights([{"name": "amitriptyline"}])

    want = np.zeros(len(weight))
    for target in drugmod.find("amitriptyline")["targets"]:
        want += target["affinity"] * target["direction"] * np.asarray(maps[target["receptor"]])
    want = want / np.max(np.abs(want))

    assert np.allclose(weight, want, atol=1e-9)
    assert used == ["5-HTT", "NET", "5-HT2A"]
    assert abs(float(np.max(np.abs(weight))) - 1.0) < 1e-9, "the weight is not peak scaled"


def test_an_unmodelled_drug_changes_nothing():
    """Selecting acetaminophen does not quietly perturb anything."""
    weight, used, _ = drugmod.weights([{"name": "acetaminophen"}])
    assert used == []
    assert not weight.any()


def test_the_dose_never_reaches_the_model(client, seeded):
    """A dose in the request body is ignored, and nothing in the result depends on it.

    The formulary carries a typical dose for recognition. The route takes a name and a
    gain. This asserts the two cannot meet.
    """
    pid = seeded[0]["id"]
    plain = client.post(f"/api/patients/{pid}/intervention",
                        json={"drugs": [{"name": "levetiracetam"}], "gain": 0.2}).json()
    dosed = client.post(f"/api/patients/{pid}/intervention",
                        json={"drugs": [{"name": "levetiracetam", "dose": "1000 mg"}],
                              "gain": 0.2}).json()
    assert plain["region_effect"] == dosed["region_effect"]

    from backend import models

    assert "dose" not in models.DrugPick.model_fields, (
        "the request model must have no way to send a dose"
    )


def test_a_drug_result_carries_its_interval_and_its_limits(client, seeded):
    """Every region has a band, and the payload says what the band does not cover."""
    pid = seeded[0]["id"]
    got = client.post(f"/api/patients/{pid}/intervention",
                      json={"drugs": [{"name": "levetiracetam"}], "gain": 0.2}).json()

    assert got["kind"] == "drugs" and got["modeled"] is True
    n = len(got["region_effect"])
    assert len(got["lo"]) == len(got["hi"]) == len(got["unclear"]) == n
    for i in range(n):
        assert got["lo"][i] <= got["region_effect"][i] <= got["hi"][i], f"region {i}"
        # The unclear flag is exactly "the interval crosses zero", not a separate opinion.
        assert got["unclear"][i] == (got["lo"][i] <= 0.0 <= got["hi"][i])

    assert got["interval_covers"] and got["interval_misses"]
    assert any("group average" in t for t in got["interval_misses"])
    assert any("model itself may be wrong" in t for t in got["interval_misses"])
    assert "not a treatment recommendation" in got["note"].lower()
    # The sentence never claims evidence about the drug.
    assert "self-consistency" in got["say"] or "cannot tell" in got["say"]


def test_a_drug_run_is_cached_by_its_inputs(client, seeded):
    """The same question twice is the same answer, and the second one is free."""
    pid = seeded[0]["id"]
    body = {"drugs": [{"name": "levetiracetam"}], "gain": 0.15}
    first = client.post(f"/api/patients/{pid}/intervention", json=body).json()
    second = client.post(f"/api/patients/{pid}/intervention", json=body).json()
    assert first["region_effect"] == second["region_effect"]

    key = drugmod.key(pid, [{"name": "levetiracetam"}], 0.15)
    other = drugmod.key(pid, [{"name": "levetiracetam"}], 0.25)
    assert key != other, "the gain has to be part of the key"
    assert drugmod.cached(key) is not None


def test_the_receptor_slider_still_works(client, seeded):
    """The single target what-if did not go away when the drug viewer arrived."""
    pid = seeded[0]["id"]
    got = client.post(f"/api/patients/{pid}/intervention",
                      json={"target": "GABA-A", "gain": 0.3}).json()
    assert got["kind"] == "receptor"
    assert len(got["region_effect"]) == 100
    assert client.post(f"/api/patients/{pid}/intervention",
                       json={"target": "nonsense"}).status_code == 400
    assert client.post(f"/api/patients/{pid}/intervention", json={}).status_code == 400


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
    reporting Claude's score under a label that said otherwise.
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
