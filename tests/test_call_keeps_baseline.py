"""A check-in adds a timepoint. It never replaces the patient.

What was reported: after running a call on the flagship patient, the brain had changed
but the original was gone, and the patient looked worse and thinner than before.

Reproducing it with `scripts/reproduce_call_wipe.py` showed nothing was actually deleted:
identity, documents, every check-in, every alert and all thirteen weeks of the damage
series all survived. What was true is narrower and still bad. There was exactly one copy
of the brain, `refresh_twin` overwrote it on every call, all hundred regions moved at
once, and the state the patient was built from could not be got back. Nothing to compare
against is what made a call look like a replacement.

So these hold the fix: the baseline is written once and never again, a call appends a
timepoint, and everything that was on screen before the call is still there after it.
"""

import json

import pytest

from backend import db
from backend.calls import run as callrun
from backend.calls import sessions
from backend.twin import build


@pytest.fixture
def patient(client):
    """A patient with a twin and no calls yet, of this module's own."""
    made = client.post("/api/patients", json={"name": "Baseline Check", "age": 31, "sex": "F"})
    assert made.status_code in (200, 201), made.text
    pid = str(made.json()["id"])
    client.post(f"/api/patients/{pid}/build-twin")
    return pid


def bundle(pid: str) -> dict:
    row = db.twin_inputs(pid)
    return (db.dec(row["payload"], {}) or {}) if row is not None else {}


def run_call(pid: str, degrade: float = 1.0) -> dict:
    return callrun.mock_call(sessions.create(pid)["token"], degrade=degrade)


def test_the_baseline_survives_a_call_byte_for_byte(patient):
    """The one that matters. The brain as built must be recoverable afterwards."""
    was = json.dumps(build.baseline_of(patient), sort_keys=True)
    assert was and was != "null", "no baseline was written at build time"

    assert run_call(patient)["ok"]

    now = json.dumps(build.baseline_of(patient), sort_keys=True)
    assert now == was, "the check-in rewrote the baseline"


def test_a_call_appends_exactly_one_timepoint(patient):
    """And a second call appends a second, without touching the first."""
    assert build.timepoints_of(patient) == []

    assert run_call(patient)["ok"]
    one = build.timepoints_of(patient)
    assert len(one) == 1
    first = json.dumps(one[0], sort_keys=True)

    assert run_call(patient)["ok"]
    two = build.timepoints_of(patient)
    assert len(two) == 2, "the second call did not append"
    assert json.dumps(two[0], sort_keys=True) == first, "the second call rewrote the first"


def test_a_timepoint_says_what_moved_and_by_how_much(patient):
    """Each one carries its own changed regions with a before and an after."""
    assert run_call(patient)["ok"]
    point = build.timepoints_of(patient)[-1]

    assert point["call_id"] and point["at"] and point["summary"]
    assert point["changed_count"] >= 1
    for r in point["changed_regions"]:
        assert "before" in r and "after" in r
        assert r["name"] and r["name"].lower() != "left cortex"
        assert r["before"] != r["after"]


def test_the_history_only_ever_grows(patient):
    """Check-ins, observations, alerts and events after a call are a superset."""
    before = {
        "checkins": [r["week"] for r in db.rows(
            "select week from checkins where patient_id=? order by week", (patient,))],
        "observations": [o["week"] for o in db.observations(patient)],
        "alerts": sorted(f"{a['type']}@{a['time']}" for a in db.alerts(patient)),
        "events": sorted(e["kind"] for e in db.rows(
            "select kind from events where patient_id=?", (patient,))),
    }

    assert run_call(patient)["ok"]

    after = {
        "checkins": [r["week"] for r in db.rows(
            "select week from checkins where patient_id=? order by week", (patient,))],
        "observations": [o["week"] for o in db.observations(patient)],
        "alerts": sorted(f"{a['type']}@{a['time']}" for a in db.alerts(patient)),
        "events": sorted(e["kind"] for e in db.rows(
            "select kind from events where patient_id=?", (patient,))),
    }

    for key, was in before.items():
        for item in was:
            assert item in after[key], f"{key} lost {item}"
    assert len(after["checkins"]) == len(before["checkins"]) + 1


def test_a_call_leaves_the_patient_who_they_are(patient):
    """Name, injury, genotype, bloods, chart and documents do not move."""
    keep = ["name", "age", "sex", "injury", "alleles", "biomarkers", "chart",
            "template_only", "d0", "seed"]
    row = db.patient(patient)
    was = {k: json.dumps(db.dec(row[k], row[k]), sort_keys=True, default=str) for k in keep}
    files = sorted(i.get("file") for i in bundle(patient).get("inputs", []))

    assert run_call(patient)["ok"]

    row = db.patient(patient)
    for k in keep:
        now = json.dumps(db.dec(row[k], row[k]), sort_keys=True, default=str)
        assert now == was[k], f"the call changed {k}"
    assert sorted(i.get("file") for i in bundle(patient).get("inputs", [])) == files


def test_the_damage_series_keeps_every_week(patient):
    """Thirteen weeks before, thirteen after. Losing weeks would be losing history."""
    twin = bundle(patient)["twin"]
    weeks = {len(r["damage"]) for r in twin["regions"]}

    assert run_call(patient)["ok"]

    after = bundle(patient)["twin"]
    assert {len(r["damage"]) for r in after["regions"]} == weeks
    assert len(after["regions"]) == len(twin["regions"])


def test_the_baseline_route_serves_both(client, patient):
    """The viewer's Baseline and Latest toggle reads one endpoint for both."""
    assert run_call(patient)["ok"]
    got = client.get(f"/api/patients/{patient}/baseline")
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["baseline"] and len(body["baseline"]["regions"]) == 100
    assert body["count"] == 1
    assert body["note"].strip()


def test_the_demo_patient_can_be_reset_and_re_run(client, patient):
    """Twice in a row, so the demo is repeatable rather than one shot."""
    for _ in range(2):
        reset = client.post(f"/api/dev/reset-demo-patient?pid={patient}")
        assert reset.status_code == 200, reset.text
        assert build.timepoints_of(patient) == [], "reset left a timepoint behind"
        assert int(db.patient(patient)["week"] or 0) == 0

        assert run_call(patient)["ok"]
        assert len(build.timepoints_of(patient)) == 1
        assert build.baseline_of(patient), "reset lost the baseline"
