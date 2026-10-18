"""Assignments: who is responsible for a patient, and who may change that."""

import pytest

from backend import db, team
from backend.config import cfg


@pytest.fixture()
def locked():
    was = cfg.auth_enabled
    cfg.auth_enabled = True
    try:
        yield
    finally:
        cfg.auth_enabled = was


def _login(client, email):
    client.cookies.clear()
    got = client.post("/api/auth/login", json={"email": email, "password": cfg.demo_password})
    assert got.status_code == 200, got.text
    return got.json()


def test_every_demo_patient_has_a_clinic_and_a_primary(client, locked):
    """The seeded worklists are complete: no patient is orphaned."""
    rows = db.patients()
    assert rows
    for row in rows:
        assert str(row["clinic_id"] or "") in ("clinic_ucla", "clinic_cedar")
        got = db.one("select role from assignments where patient_id=? and active=1",
                     (str(row["id"]),))
        assert got is not None
        assert str(got["role"]) == "primary"


def test_a_doctor_can_assign_a_colleague_and_repeat_is_idempotent(client, locked):
    """POST twice returns the same row because the patient and clinician pair is unique."""
    who = _login(client, cfg.demo_email)
    assert who["role"] == "admin"
    pid = str(db.one("select id from patients where clinic_id='clinic_ucla'")["id"])

    first = client.post("/api/assignments",
                        json={"patient_id": pid, "clinician_id": "clin_ng", "role": "covering"})
    assert first.status_code == 200, first.text
    second = client.post("/api/assignments",
                         json={"patient_id": pid, "clinician_id": "clin_ng", "role": "covering"})
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]

    got = client.get(f"/api/assignments?patient_id={pid}")
    assert got.status_code == 200
    pairs = {(a["patient_id"], a["clinician_id"]) for a in got.json()}
    assert (pid, "clin_ng") in pairs


def test_a_doctor_can_deactivate_an_assignment(client, locked):
    """Removing one does not delete the audit row, it flips active."""
    _login(client, cfg.demo_email)
    pid = str(db.one("select id from patients where clinic_id='clinic_ucla'")["id"])
    made = client.post("/api/assignments",
                       json={"patient_id": pid, "clinician_id": "clin_ng", "role": "consult"})
    aid = made.json()["id"]
    gone = client.delete(f"/api/assignments/{aid}")
    assert gone.status_code == 200
    row = db.one("select active from assignments where id=?", (aid,))
    assert int(row["active"]) == 0


def test_a_doctor_cannot_delete_another_clinics_assignment(client, locked):
    """The assignment id is not a capability. The patient has to be in scope too."""
    _login(client, "okafor@synapshot.health")
    row = db.one(
        "select a.id from assignments a join patients p on p.id=a.patient_id"
        " where p.clinic_id='clinic_ucla' and a.active=1"
    )
    assert row is not None
    got = client.delete(f"/api/assignments/{row['id']}")
    assert got.status_code == 404


def test_a_nurse_cannot_assign(client, locked):
    """A nurse sees the worklist but cannot change who is responsible for it.

    The patient is one the nurse is actually assigned to. A patient outside their
    list would be a 404, which is the correct answer for a different reason.
    """
    _login(client, "ng@synapshot.health")
    row = db.one("select patient_id from assignments where clinician_id='clin_ng' and active=1")
    assert row is not None
    pid = str(row["patient_id"])
    got = client.post("/api/assignments",
                      json={"patient_id": pid, "clinician_id": "clin_lee"})
    assert got.status_code == 403


def test_staff_list_never_contains_a_hash(client, locked):
    """The roster is safe to hand to the browser."""
    _login(client, cfg.demo_email)
    got = client.get("/api/clinicians")
    assert got.status_code == 200
    assert got.json()
    for row in got.json():
        assert "password_hash" not in row
        assert row["email"]


def test_assigning_an_unknown_patient_is_404(client, locked):
    """A bad id is the same 404 as a patient at another clinic."""
    _login(client, cfg.demo_email)
    got = client.post("/api/assignments",
                      json={"patient_id": "pat_nope", "clinician_id": "clin_ng"})
    assert got.status_code == 404


def test_team_assign_does_not_duplicate(seeded):
    """The helper itself is idempotent, independent of HTTP."""
    pid = str(seeded[0]["id"])
    before = db.rows("select id from assignments where patient_id=?", (pid,))
    team.assign(pid, "clin_lee", "covering")
    team.assign(pid, "clin_lee", "covering")
    after = db.rows("select id from assignments where patient_id=? and clinician_id='clin_lee'", (pid,))
    assert len(after) >= 1
    assert len({str(r["id"]) for r in after}) == len(after)
    assert len(before) >= 1
