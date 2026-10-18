"""Outbound messaging: one channel, honest delivery, and no quiet fallback.

The rule these all circle: a provider accepting a message is not a phone receiving one.
Everything here exists because the modal said "iMessage could not deliver" and nothing
had arrived, and there was no way to tell from the screen which of six things was wrong.
"""

import json

from backend import db
from backend.comms import notify, photon


def test_sms_is_not_in_the_fallback_chain(seeded, monkeypatch):
    """A failed iMessage stays a failed iMessage. It does not become a text.

    Falling back to SMS makes "did the iMessage work" unanswerable from the screen,
    which is the one question this demo is about.
    """
    pid = seeded[0]["id"]
    calls = []

    def boom(*a, **k):
        calls.append(a)
        raise AssertionError("notify must never reach the SMS transport")

    from backend.comms import sms

    monkeypatch.setattr(sms, "send", boom)
    monkeypatch.setattr(photon, "send", lambda *a, **k: {
        "ok": False, "channel": "none", "error": "nope", "why": "because"})

    got = notify.send(pid, "call_link", link="https://example.test/call/abc")
    assert got["channel"] == "mock"
    assert calls == [], "sms.send was called"
    # And the module no longer even imports it into the send path.
    assert "from . import photon\n" in (notify.__file__ and open(notify.__file__).read())


def test_a_failed_send_keeps_the_reason(seeded, monkeypatch):
    """The real error is stored on the row, so the modal can show it."""
    pid = seeded[0]["id"]
    monkeypatch.setattr(photon, "available", lambda: True)
    monkeypatch.setattr(photon, "send", lambda *a, **k: {
        "ok": False,
        "channel": "none",
        "error": "AuthenticationError: [spectrum-imessage] Target not allowed for this project",
        "why": "The Photon project will not send to that number.",
        "tried": [{"how": "cloud", "error": "x"}, {"how": "local", "error": "y"}],
    })

    got = notify.send(pid, "call_link", link="https://example.test/call/abc")
    assert got["status"] == "failed"
    assert "Target not allowed" in got["imessage_error"]
    assert got["why"]
    assert len(got["tried"]) == 2

    row = db.one("select * from messages where id=?", (got["message_id"],))
    assert row["status"] == "failed"
    assert row["detail"], "the row has to carry the reason or the modal cannot show it"


def test_a_sent_message_is_never_born_delivered(seeded, monkeypatch):
    """Accepted is `sent`. Only the provider can make it `delivered`."""
    pid = seeded[0]["id"]
    monkeypatch.setattr(photon, "available", lambda: True)
    monkeypatch.setattr(photon, "send", lambda *a, **k: {
        "ok": True, "channel": "imessage", "how": "cloud",
        "id": "msg-123", "space": "dm-9", "status": "sent"})

    got = notify.send(pid, "call_link", link="https://example.test/call/abc")
    assert got["status"] == "sent"
    assert got["channel"] == "imessage"

    row = db.one("select * from messages where id=?", (got["message_id"],))
    assert row["status"] == "sent", "a fresh send must not claim delivery"
    assert row["provider_id"] == "msg-123"
    assert row["space_id"] == "dm-9", "without the space the delivery poll cannot ask"


def test_delivered_only_after_the_provider_says_so(seeded, monkeypatch):
    """confirm() is the only thing that promotes a message, and only on a real yes."""
    pid = seeded[0]["id"]
    monkeypatch.setattr(photon, "available", lambda: True)
    monkeypatch.setattr(photon, "send", lambda *a, **k: {
        "ok": True, "channel": "imessage", "how": "cloud",
        "id": "msg-7", "space": "dm-7", "status": "sent"})
    mid = notify.send(pid, "call_link", link="https://example.test/call/abc")["message_id"]

    # The provider has nothing to say yet: the message stays sent.
    monkeypatch.setattr(photon, "delivery", lambda *a, **k: {"ok": True, "status": "sent"})
    assert notify.confirm(mid)["status"] == "sent"
    assert db.one("select * from messages where id=?", (mid,))["status"] == "sent"

    # The provider cannot answer at all: still sent, not failed and not delivered.
    monkeypatch.setattr(photon, "delivery", lambda *a, **k: {"ok": False, "status": "unknown"})
    got = notify.confirm(mid)
    assert got["status"] == "sent"
    assert "could not say" in got.get("note", "")

    # The provider confirms. Now and only now.
    monkeypatch.setattr(photon, "delivery", lambda *a, **k: {
        "ok": True, "status": "delivered", "delivered": True})
    assert notify.confirm(mid)["status"] == "delivered"
    assert db.one("select * from messages where id=?", (mid,))["status"] == "delivered"


def test_confirming_a_settled_message_does_not_ask_again(seeded, monkeypatch):
    """A delivered or failed message is final, so the poll stops."""
    pid = seeded[0]["id"]
    mid = db.message(pid, "out", "hello", channel="imessage", kind="call_link",
                     status="delivered", provider_id="m1", space_id="s1")
    asked = []
    monkeypatch.setattr(photon, "delivery", lambda *a, **k: asked.append(a) or {"status": "sent"})
    assert notify.confirm(mid)["status"] == "delivered"
    assert asked == [], "a settled message must not be re-polled"


def test_the_status_route_reports_what_is_on_the_row(client, seeded, monkeypatch):
    """GET /api/messages/{id}/status is what the modal polls."""
    pid = seeded[0]["id"]
    mid = db.message(pid, "out", "hello", channel="imessage", kind="call_link",
                     status="sent", provider_id="m2", space_id="s2")

    monkeypatch.setattr(photon, "available", lambda: True)
    monkeypatch.setattr(photon, "delivery", lambda *a, **k: {"ok": True, "status": "sent"})
    got = client.get(f"/api/messages/{mid}/status").json()
    assert got["status"] == "sent" and got["channel"] == "imessage"

    monkeypatch.setattr(photon, "delivery", lambda *a, **k: {
        "ok": True, "status": "delivered", "delivered": True})
    assert client.get(f"/api/messages/{mid}/status").json()["status"] == "delivered"
    assert client.get("/api/messages/msg_nope/status").status_code == 404


def test_the_call_route_returns_enough_to_explain_itself(client, seeded, monkeypatch):
    """Starting a call with send=true tells the modal everything it needs."""
    pid = seeded[0]["id"]
    monkeypatch.setattr(photon, "available", lambda: True)
    monkeypatch.setattr(photon, "send", lambda *a, **k: {
        "ok": False, "channel": "none",
        "error": "AuthenticationError: Target not allowed for this project",
        "why": "The Photon project will not send to that number.",
        "tried": [{"how": "cloud", "error": "a", "why": "b"}]})

    got = client.post("/api/calls", json={"patient_id": pid, "send": True}).json()
    assert got["url"] and got["token"], "the link has to come back even when the text fails"
    assert got["status"] == "failed"
    assert got["why"], "a failure with no reason is what started all this"
    assert got["tried"]


def test_a_number_off_the_allow_list_is_never_messaged(monkeypatch):
    """The allow list is checked before the transport is even reached."""
    from backend.config import cfg

    monkeypatch.setattr(photon, "available", lambda: True)
    monkeypatch.setattr(cfg, "demo_phones", ["+19259677432"])
    ran = []
    monkeypatch.setattr(photon, "_run", lambda *a, **k: ran.append(a) or {"ok": True})

    got = photon.send("+15550001111", "hello")
    assert got["ok"] is False
    assert "DEMO_PHONES" in got["error"]
    assert ran == [], "the sidecar must not even be started for a number off the list"


def test_the_sidecar_speaks_the_shape_python_expects():
    """The probe contract, checked against the real file rather than assumed."""
    from pathlib import Path

    raw = Path(photon.SIDECAR).read_text()
    # Comments stripped, because the file explains the old broken shape in prose and a
    # plain substring check matches the explanation as happily as the code.
    src = "\n".join(l for l in raw.splitlines() if not l.lstrip().startswith("//"))

    # The two call-shape bugs that stopped messages reaching a person. Both are easy to
    # reintroduce from memory, because both of the wrong forms look right.
    assert "im.user(to)" in src, "the handle has to be resolved to a user before a space"
    assert "dm.send(" in src, "the message is sent on the space"
    assert "app.send(" not in src, "app.send(space, text(...)) is the shape that silently fails"
    assert "space.create(to)" not in src, "space.create takes a user, not a raw number"
    # And the status path exists at all.
    assert "--status" in raw and "isDelivered" in raw


def test_the_probe_refuses_a_number_off_the_allow_list():
    """scripts/photon_probe.mjs enforces the same list the backend does."""
    from pathlib import Path

    from backend.config import ROOT

    src = (ROOT / "scripts" / "photon_probe.mjs").read_text()
    assert "DEMO_PHONES" in src
    assert "allowed(" in src
    # Nothing in the probe prints a secret.
    assert "projectSecret ? \"set\"" in src
    assert "redacted" in src


def test_make_send_test_exists():
    """The probe is reachable by the name the docs give it."""
    from backend.config import ROOT

    src = (ROOT / "Makefile").read_text()
    assert "send-test:" in src
    assert "photon_probe.mjs" in src
    assert "twilio" not in src.lower(), "the Makefile should not mention Twilio at all"
