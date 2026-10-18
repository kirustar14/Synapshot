"""Medicines matched to the symptoms a patient actually reported.

The thing being avoided here is a ranked list of best drugs. The model cannot know which
medicine is better for a person and a list that implied it would read as prescribing
advice. What this is instead is a count: how many of this patient's elevated symptoms
each medicine is ordinarily used for, highest first, with the symptoms named.
"""

import json

import pytest

from backend import db
from backend.data import suggest

# Words that would turn a reference list into advice.
BANNED = ("recommend", "best", "should take", "advise", "prescribe", "will help", "benefit")


@pytest.fixture
def scored(client):
    """A patient of this module's own with symptom scores I control."""
    made = client.post("/api/patients", json={"name": "Symptom Match", "age": 28, "sex": "F"})
    assert made.status_code in (200, 201), made.text
    return str(made.json()["id"])


def set_scores(pid: str, scores: dict) -> None:
    """Write one finished call session carrying these per symptom scores."""
    from backend.calls import sessions

    sessions.setup()
    # The primary key on call_sessions is the token, not an id.
    db.put("call_sessions", {
        "token": db.new_id("tok"), "patient_id": pid,
        "week": 1, "state": "done", "created": db.now(),
        "symptoms": db.enc({"symptoms": scores}),
    })


def test_headache_and_nausea_put_those_medicines_first(client, scored):
    """The ordering is by how many elevated symptoms a medicine is used for."""
    set_scores(scored, {"headache": 8.0, "nausea": 7.0, "fatigue": 0.0,
                        "dizziness": 0.0, "light_sensitivity": 0.0})
    got = client.get(f"/api/patients/{scored}/suggested-drugs").json()

    assert got["drugs"], got
    names = [d["name"] for d in got["drugs"]]
    # Every medicine listed is one used for headache or for nausea, and nothing else.
    for row in got["drugs"]:
        assert row["matched_symptoms"]
        for sym in row["matched_symptoms"]:
            assert sym in ("headache", "nausea"), row
    assert "ondansetron" in names, "the nausea medicine is missing"
    assert {"acetaminophen", "ibuprofen"} & set(names), "the headache medicines are missing"

    counts = [d["match_count"] for d in got["drugs"]]
    assert counts == sorted(counts, reverse=True), "not ordered by how many symptoms matched"


def test_a_quiet_week_lists_nothing_and_says_why(client, scored):
    """No elevated symptom is an empty list with one line, not an empty screen."""
    set_scores(scored, {"headache": 1.0, "nausea": 0.0, "fatigue": 2.0})
    got = client.get(f"/api/patients/{scored}/suggested-drugs").json()
    assert got["drugs"] == []
    assert got["message"].strip()
    assert str(int(got["threshold"])) in got["message"]


def test_a_patient_with_no_check_in_says_so(client, scored):
    """Nothing to match against is a different sentence from nothing matched."""
    got = client.get(f"/api/patients/{scored}/suggested-drugs").json()
    assert got["drugs"] == []
    assert "no check-in" in got["message"].lower()


def test_nothing_in_the_output_reads_as_advice(client, scored):
    """The whole payload, including the reasons and the tooltip."""
    set_scores(scored, {"headache": 9.0, "nausea": 8.0, "fatigue": 7.0})
    blob = json.dumps(client.get(f"/api/patients/{scored}/suggested-drugs").json()).lower()
    for word in BANNED:
        assert word not in blob, word
    assert "for clinician review" in blob


def test_every_row_carries_a_source_and_an_evidence_tag(client, scored):
    """A match with no source behind it is a claim nobody can check."""
    set_scores(scored, {"headache": 8.0, "fatigue": 6.0})
    got = client.get(f"/api/patients/{scored}/suggested-drugs").json()
    for row in got["drugs"]:
        assert row["source"], row["name"]
        assert row["source"] in got["sources"], f"{row['name']} cites an unknown source"
        assert row["evidence_tag"] in ("verified", "check this"), row["name"]


def test_a_medicine_already_on_the_chart_is_marked_current(client, seeded):
    """So a clinician can see what is already being taken without cross referencing."""
    pid = str(seeded[0]["id"])
    row = db.patient(pid)
    chart = db.dec(row["chart"], {}) or {}
    chart["medications"] = [{"name": "ibuprofen", "dose": "", "status": "current"}]
    db.patch("patients", pid, {"chart": db.enc(chart)})
    set_scores(pid, {"headache": 9.0})

    got = client.get(f"/api/patients/{pid}/suggested-drugs").json()
    hit = next((d for d in got["drugs"] if d["name"] == "ibuprofen"), None)
    assert hit is not None, [d["name"] for d in got["drugs"]]
    assert hit["current"] is True


def test_the_aliases_fold_one_complaint_into_one_entry(client, scored):
    """Pressure and neck pain travel with headache, so the medicine is listed once."""
    set_scores(scored, {"headache": 8.0, "pressure": 8.0, "neck_pain": 8.0})
    got = client.get(f"/api/patients/{scored}/suggested-drugs").json()
    names = [d["name"] for d in got["drugs"]]
    assert len(names) == len(set(names)), "a medicine is listed more than once"
    for row in got["drugs"]:
        assert row["matched_symptoms"].count("headache") == 1, row


def test_every_medicine_named_in_the_map_exists_in_the_formulary():
    """A map pointing at a medicine that is not in the formulary is a dead link."""
    from backend.data import drugs as drugmod

    for key, entry in suggest.table()["symptoms"].items():
        for row in entry.get("drugs", []):
            assert drugmod.drug(row["name"]) is not None, f"{key} names {row['name']}"
            assert row.get("why", "").strip(), f"{key} {row['name']} has no reason"
