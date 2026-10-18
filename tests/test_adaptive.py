"""The decision model contract and the adaptive test controller.

No network here. The Veri path is exercised by the fallback tests: with a key missing or a
deployment unset the answer must say heuristic or script, never pretend a model ran.
"""

from backend import db
from backend.agent import adaptive
from backend.config import cfg


def _session(client, pid):
    got = client.post("/api/calls", json={"patient_id": pid, "send": False})
    assert got.status_code == 200, got.text
    return got.json()["token"]


def test_the_validator_accepts_only_the_contract():
    """A right shaped object passes, a wrong length vector or a bad block does not."""
    good = {"p": {"drift": [0.6, 0.3, 0.1], "worst_domain": [0.4, 0.2, 0.2, 0.1, 0.1]},
            "next": "ocular"}
    got = adaptive._valid(good)
    assert got is not None
    assert abs(sum(got["p"]["drift"]) - 1.0) < 1e-6
    assert got["next"] == "ocular"

    assert adaptive._valid({**good, "next": "calib"}) is None
    assert adaptive._valid({"p": {"drift": [1.0], "worst_domain": good["p"]["worst_domain"]},
                            "next": "ocular"}) is None
    assert adaptive._valid({"p": good["p"], "next": "ocular"}) is not None


def test_heuristic_stops_when_every_block_has_run():
    """The only correct answer with nothing left is stop."""
    state = {"remaining": [], "residuals": {}, "quality_ok": True}
    got = adaptive.heuristic(state)
    assert got["next"] == "stop"
    assert "every block" in got["reason"]


def test_heuristic_prefers_a_moved_signal_per_minute(seeded):
    """A block whose only signal is far from its band outranks a quiet expensive block."""
    pid = str(seeded[0]["id"])
    state = adaptive.state_of(pid, done=["symptoms", "memory"])
    state["residuals"] = {"pursuit_gain": 4.0, "saccade_latency": 4.0,
                          "antisaccade_err": 4.0, "bcea": 0.0,
                          "speech_rate": 0.0, "recall_delayed": 0.0, "symptom_total": 0.0}
    got = adaptive.heuristic(state)
    assert got["next"] == "ocular"
    assert got["scores"]["ocular"] > got["scores"]["speech"]


def test_state_carries_the_evidence_and_the_remaining_blocks(seeded):
    """The object the model reads has the week, the residuals and an explicit remainder."""
    pid = str(seeded[0]["id"])
    state = adaptive.state_of(pid, done=["ocular"])
    for key in ("patient_id", "week", "drift_z", "symptom_total", "residuals", "done", "remaining"):
        assert key in state
    assert "ocular" not in state["remaining"]
    assert set(state["remaining"]) <= set(adaptive.ORDER)


def test_without_a_key_the_answer_names_the_heuristic(client, seeded):
    """The default local path is honest about what answered."""
    was_mode, was_key = cfg.adaptive_mode, cfg.veri_api_key
    cfg.adaptive_mode = "heuristic"
    cfg.veri_api_key = ""
    try:
        pid = str(seeded[0]["id"])
        token = _session(client, pid)
        got = client.post(f"/api/call/{token}/next-block", json={"done": []})
        assert got.status_code == 200, got.text
        body = got.json()
        assert body["source"] == "heuristic"
        assert body["next"] in adaptive.ORDER
        assert body["minutes_saved"] > 0
        assert body["probabilities"] == {}
    finally:
        cfg.adaptive_mode, cfg.veri_api_key = was_mode, was_key


def test_asking_for_the_model_with_no_deployment_falls_back_to_script(client, seeded):
    """ADAPTIVE_MODE=veri with no key must not be reported as the model."""
    was_mode, was_key = cfg.adaptive_mode, cfg.veri_api_key
    cfg.adaptive_mode = "veri"
    cfg.veri_api_key = ""
    try:
        pid = str(seeded[0]["id"])
        token = _session(client, pid)
        got = client.post(f"/api/call/{token}/next-block", json={"done": ["symptoms"]})
        assert got.status_code == 200
        assert got.json()["source"] == "script"
    finally:
        cfg.adaptive_mode, cfg.veri_api_key = was_mode, was_key


def test_all_blocks_done_is_stop(client, seeded):
    """A finished session has nothing left to choose."""
    pid = str(seeded[0]["id"])
    token = _session(client, pid)
    got = client.post(f"/api/call/{token}/next-block", json={"done": list(adaptive.ORDER)})
    assert got.status_code == 200
    assert got.json()["next"] == "stop"
    assert got.json()["minutes_saved"] == 0


def test_the_endpoint_is_public_by_token(client, seeded):
    """The patient page has no clinician cookie, so this route must not demand one."""
    was = cfg.auth_enabled
    cfg.auth_enabled = True
    try:
        client.cookies.clear()
        pid = str(db.one("select id from patients")["id"])
        # Creating a session is clinician work; do it with auth off, then close it again.
        cfg.auth_enabled = False
        token = _session(client, pid)
        cfg.auth_enabled = True
        got = client.post(f"/api/call/{token}/next-block", json={"done": []})
        assert got.status_code == 200
        assert got.json()["source"] in ("heuristic", "script")
    finally:
        cfg.auth_enabled = was
        client.cookies.clear()
