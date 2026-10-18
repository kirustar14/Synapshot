"""Clinician accounts: hashing, login, cookie sessions, logout and clinic scoping.

The rest of the suite runs with AUTH_ENABLED=0 (see conftest). These tests turn it on for
the duration of one request and then put it back, so the shared TestClient is reusable.
"""

import pytest

from backend import auth, db, demo
from backend.config import cfg


@pytest.fixture()
def locked():
    """Auth on for one test, restored afterwards even if the assertion fails."""
    was = cfg.auth_enabled
    cfg.auth_enabled = True
    try:
        yield
    finally:
        cfg.auth_enabled = was
        cfg.demo_login = True


def _reset(client):
    client.cookies.clear()


def test_password_hash_round_trip():
    """A hash verifies its own password and nothing else."""
    stored = auth.hash_password("correct horse battery")
    assert stored.startswith("scrypt$")
    assert auth.verify_password("correct horse battery", stored)
    assert not auth.verify_password("wrong", stored)
    assert not auth.verify_password("correct horse battery", "junk")


def test_login_rejects_a_bad_password(client, locked):
    """The same 401 comes back for a wrong password and an unknown address."""
    _reset(client)
    bad = client.post("/api/auth/login", json={"email": cfg.demo_email, "password": "nope"})
    assert bad.status_code == 401
    missing = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "nope"})
    assert missing.status_code == 401


def test_login_sets_a_session_cookie_and_me_returns_the_clinician(client, locked):
    """A real login, a cookie the browser cannot read, and the same clinician on /me."""
    _reset(client)
    got = client.post("/api/auth/login",
                      json={"email": cfg.demo_email, "password": cfg.demo_password})
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["email"] == cfg.demo_email
    assert "password_hash" not in body
    assert auth.COOKIE in client.cookies

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["id"] == body["id"]
    assert me.json()["auth"] is True


def test_the_api_is_closed_without_a_cookie(client, locked):
    """A clinician route is 401, while the patient token namespace stays open."""
    _reset(client)
    got = client.get("/api/patients")
    assert got.status_code == 401
    assert got.json()["detail"] == "sign in required"
    # The call script route is public by token; an unknown token must be a 404, not a 401.
    call = client.get("/api/call/not-a-token/script")
    assert call.status_code == 404


def test_two_clinics_see_two_worklists_and_cannot_read_each_other(client, locked):
    """UCLA and Cedar get different lists, and a cross clinic read is 404, not 403."""
    _reset(client)
    cedar = db.one("select id from patients where clinic_id='clinic_cedar'")
    ucla = db.one("select id from patients where clinic_id='clinic_ucla'")
    assert cedar is not None and ucla is not None

    assert client.post("/api/auth/login",
                       json={"email": "okafor@synapshot.health",
                             "password": cfg.demo_password}).status_code == 200
    got = client.get("/api/patients")
    assert got.status_code == 200
    ids = {row["id"] for row in got.json()}
    assert str(cedar["id"]) in ids
    assert str(ucla["id"]) not in ids
    assert client.get(f"/api/patients/{ucla['id']}").status_code == 404

    _reset(client)
    assert client.post("/api/auth/login",
                       json={"email": cfg.demo_email,
                             "password": cfg.demo_password}).status_code == 200
    other = client.get("/api/patients")
    assert other.status_code == 200
    ids = {row["id"] for row in other.json()}
    assert str(ucla["id"]) in ids
    assert str(cedar["id"]) not in ids


@pytest.mark.parametrize("suffix", [
    "provenance", "baseline", "latest-update", "timeline", "percentile",
    "suggested-drugs", "drugs/amitriptyline/overlap", "stream", "pipeline",
])
def test_workspace_reads_respect_clinic_access(client, locked, suffix):
    """New patient-workspace routes obey the dashboard's existing record boundary."""
    _reset(client)
    other = db.one("select id from patients where clinic_id='clinic_cedar'")
    assert other is not None
    assert client.post("/api/auth/login", json={
        "email": cfg.demo_email, "password": cfg.demo_password,
    }).status_code == 200
    assert client.get(f"/api/patients/{other['id']}/{suffix}").status_code == 404
    _reset(client)


def test_document_intake_assigns_the_patient_to_its_creator(client, locked, monkeypatch):
    """An ingested patient can immediately be opened by the clinician who uploaded it."""
    from backend.app import ingestrun

    _reset(client)
    signed_in = client.post("/api/auth/login", json={
        "email": cfg.demo_email, "password": cfg.demo_password,
    }).json()
    created = []

    def ingest(_files):
        pid = demo.new_patient("Document intake test", 30, "F")
        created.append(pid)
        yield {"kind": "done", "patient_id": pid}

    monkeypatch.setattr(ingestrun, "stream", ingest)
    response = client.post("/api/patients/ingest", files={
        "files": ("chart.txt", b"Patient chart", "text/plain"),
    })
    assert response.status_code == 200, response.text
    assert len(created) == 1
    pid = created[0]
    assert db.patient(pid)["clinic_id"] == signed_in["clinic_id"]
    assignment = db.one("select * from assignments where patient_id=? and clinician_id=?",
                        (pid, signed_in["id"]))
    assert assignment is not None and assignment["role"] == "primary"
    assert client.get(f"/api/patients/{pid}").status_code == 200
    _reset(client)


def test_creao_callback_uses_its_token_without_a_clinician_cookie(client, locked, monkeypatch):
    """The agent callback keeps working when clinician login is enforced."""
    from backend.agent import creao

    _reset(client)
    monkeypatch.setattr(creao, "token", lambda: "callback-token-test")
    monkeypatch.setattr(creao, "on_callback", lambda _body: True)
    assert client.post("/api/creao/callback?token=bad", json={}).status_code == 403
    response = client.post("/api/creao/callback?token=callback-token-test", json={})
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_logout_drops_the_session(client, locked):
    """After logout the old cookie is worth nothing."""
    _reset(client)
    assert client.post("/api/auth/login",
                       json={"email": cfg.demo_email,
                             "password": cfg.demo_password}).status_code == 200
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 200
    _reset(client)
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/patients").status_code == 401


def test_the_benchmark_is_admin_only(client, locked):
    """A doctor can read the dashboard, but only an admin can time the database."""
    assert client.post("/api/auth/login",
                       json={"email": "okafor@synapshot.health",
                             "password": cfg.demo_password}).status_code == 200
    assert client.get("/api/pulse?bench=1").status_code == 403

    _reset(client)
    assert client.post("/api/auth/login",
                       json={"email": cfg.demo_email,
                             "password": cfg.demo_password}).status_code == 200
    got = client.get("/api/pulse?bench=1")
    assert got.status_code == 200
    assert got.json()["bench"]["available"] is False
    assert "DATABASE_URL" in got.json()["bench"]["reason"]


def test_demo_login_can_be_switched_off(client, locked):
    """DEMO_LOGIN=0 is a real gate, not a decorative flag."""
    _reset(client)
    cfg.demo_login = False
    assert client.post("/api/auth/demo").status_code == 404
    cfg.demo_login = True
    got = client.post("/api/auth/demo")
    assert got.status_code == 200
    assert got.json()["id"] == "clin_reyes"
