"""The CREAO care pipeline: triage, then briefing and outreach, on three agents.

Mock flow, live flow against a faked API, what the app does with the triage result, and what is
never sent or shown.
"""

import json

import httpx
import pytest

from backend import db
from backend.agent import creao
from backend.config import cfg


@pytest.fixture()
def pid(seeded):
    db.run("delete from agent_runs")
    db.run("delete from alerts where type='agent_review'")
    return seeded[0]["id"]


@pytest.fixture()
def fast(monkeypatch):
    monkeypatch.setattr(creao, "MOCK_DELAY_S", 0.0)


def poll(client, pid, n=6):
    """Poll like the UI does until the pipeline stops moving."""
    out = None
    for _ in range(n):
        out = client.get(f"/api/patients/{pid}/pipeline").json()
        if out and out["status"] != "running":
            break
    return out


def test_mock_pipeline_runs_all_three_stages(client, pid, fast):
    """No key means templates: triage first, then briefing and outreach, all labelled mock."""
    first = client.post(f"/api/patients/{pid}/pipeline")
    assert first.status_code == 202
    assert [s["role"] for s in first.json()["stages"]] == ["triage", "briefing", "outreach"]
    done = poll(client, pid)
    assert done["status"] == "completed"
    assert all(s["mock"] for s in done["stages"]) and all(s["agent_id"] is None for s in done["stages"])
    assert done["level"] in ("routine", "watch", "escalate")
    assert done["briefing"].startswith("Template briefing, no CREAO agent was called")


def test_a_second_press_does_not_start_a_second_pipeline(client, pid, monkeypatch):
    """Every run spends credits, so a double click returns the pipeline already going."""
    monkeypatch.setattr(creao, "MOCK_DELAY_S", 999.0)
    a = client.post(f"/api/patients/{pid}/pipeline").json()
    b = client.post(f"/api/patients/{pid}/pipeline").json()
    assert a["id"] == b["id"]
    assert len(db.rows("select id from agent_runs where patient_id=? and kind='triage'", (pid,))) == 1


def test_unknown_patient_is_404(client):
    assert client.post("/api/patients/nope/pipeline").status_code == 404
    assert client.get("/api/patients/nope/pipeline").status_code == 404


def test_inputs_carry_no_name_and_no_contact_details(pid):
    """The agents get a pseudonym, never the name, id or phone."""
    row = db.patient(pid)
    blob = json.dumps(creao.stage_inputs("triage", creao.facts(pid, int(row["week"] or 0)), None))
    assert str(row["name"]) not in blob
    assert str(row["name"]).split()[0] not in blob
    assert pid not in blob
    assert "phone" not in blob.lower()


def fake_creao(monkeypatch, level="escalate", reasons=("Drift is high.",)):
    """Turn on live mode for all three roles against a faked CREAO API. Returns what was posted."""
    monkeypatch.setattr(cfg, "mock_creao", False)
    monkeypatch.setattr(cfg, "creao_key", "capi_secret_value")
    monkeypatch.setattr(cfg, "creao_agent", "agent-brief")
    monkeypatch.setattr(cfg, "creao_triage_agent", "agent-triage")
    monkeypatch.setattr(cfg, "creao_outreach_agent", "agent-outreach")
    posts, runs = [], {}

    def post(url, json=None, headers=None, timeout=None):
        n = f"RUN{len(posts)}"
        posts.append({"agent": json["appId"], "key": json["idempotencyKey"], "auth": headers["Authorization"],
                      "inputs": json["inputs"]})
        runs[n] = json["appId"]
        return httpx.Response(202, json={"id": n, "status": "pending"}, request=httpx.Request("POST", url))

    def get(url, headers=None, timeout=None):
        rid = url.rsplit("/", 1)[-1]
        agent = runs[rid]
        payload = {
            "agent-triage": {"level": level, "reasons": list(reasons)},
            "agent-brief": {"briefing": "Look at drift first. You are cleared to play.", "follow_ups": ["Ask about sleep."]},
            "agent-outreach": {"patient_message": "Thanks, see you next week.", "next_steps": ["Review the briefing."]},
        }[agent]
        text = "Done! Here you go:\n```json\n" + json_mod.dumps(payload) + "\n```"
        return httpx.Response(200, json={"status": "completed", "threadId": "T", "result": {"text": text}},
                              request=httpx.Request("GET", url))

    json_mod = json
    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(httpx, "get", get)
    return posts


def test_live_pipeline_hands_triage_to_the_next_agents(client, pid, monkeypatch):
    """Triage runs first, its result goes to the other two, and the key never leaves the server."""
    posts = fake_creao(monkeypatch)
    started = client.post(f"/api/patients/{pid}/pipeline").json()
    assert [p["agent"] for p in posts] == ["agent-triage"], "only triage starts first"
    assert started["status"] == "running"
    assert 8 <= len(posts[0]["key"]) <= 128

    done = poll(client, pid)
    assert [p["agent"] for p in posts] == ["agent-triage", "agent-brief", "agent-outreach"]
    sent = json.loads(posts[1]["inputs"]["briefing_request"])
    assert sent["triage"]["level"] == "escalate", "the briefing agent is told what triage decided"
    assert all(p["auth"] == "Bearer capi_secret_value" for p in posts)
    assert done["status"] == "completed" and done["level"] == "escalate"
    assert [s["agent_id"] for s in done["stages"]] == ["agent-triage", "agent-brief", "agent-outreach"]
    assert "cleared to" not in done["briefing"].lower(), "the safety filter must run on agent text"
    assert done["patient_message"] == "Thanks, see you next week."
    assert "capi_secret_value" not in json.dumps(done)


def test_escalate_raises_an_alert_but_never_calls_anyone(client, pid, monkeypatch):
    """The app acts on triage: escalate adds an alert on the list, with no call and no text."""
    fake_creao(monkeypatch)
    before = len(db.rows("select id from alerts where patient_id=?", (pid,)))
    client.post(f"/api/patients/{pid}/pipeline")
    done = poll(client, pid)
    assert done["escalated"] is True
    mine = db.rows("select * from alerts where patient_id=? and type='agent_review'", (pid,))
    assert len(mine) == 1 and mine[0]["called"] == 0
    assert len(db.rows("select id from alerts where patient_id=?", (pid,))) == before + 1


def test_routine_adds_nothing_and_skips_outreach(client, pid, monkeypatch):
    """A routine week removes nothing, raises nothing, and does not spend a run on outreach."""
    posts = fake_creao(monkeypatch, level="routine", reasons=("Nothing moved.",))
    client.post(f"/api/patients/{pid}/pipeline")
    done = poll(client, pid)
    assert [p["agent"] for p in posts] == ["agent-triage", "agent-brief"]
    assert done["stages"][2]["status"] == "skipped"
    assert done["escalated"] is False
    assert db.rows("select id from alerts where patient_id=? and type='agent_review'", (pid,)) == []


def test_a_role_without_an_agent_runs_as_a_labelled_template(client, pid, monkeypatch):
    """Only the briefing agent exists yet: it goes live, the others are templates, and it says so."""
    posts = fake_creao(monkeypatch)
    monkeypatch.setattr(cfg, "creao_triage_agent", "")
    monkeypatch.setattr(cfg, "creao_outreach_agent", "")
    monkeypatch.setattr(creao, "MOCK_DELAY_S", 0.0)
    client.post(f"/api/patients/{pid}/pipeline")
    done = poll(client, pid)
    assert [p["agent"] for p in posts] == ["agent-brief"]
    assert [s["mock"] for s in done["stages"]] == [True, False, True]


def test_a_failed_start_is_reported_without_the_key(client, pid, monkeypatch):
    fake_creao(monkeypatch)

    def boom(*a, **k):
        raise httpx.ConnectError("could not reach host with capi_secret_value")

    monkeypatch.setattr(httpx, "post", boom)
    out = client.post(f"/api/patients/{pid}/pipeline").json()
    assert out["status"] == "failed"
    assert "capi_secret_value" not in json.dumps(out)
    assert "capi_secret_value" not in (out["stages"][0]["error"] or "")


def test_webhook_needs_the_token_and_never_trusts_the_body(client, monkeypatch):
    monkeypatch.setattr(cfg, "creao_key", "capi_secret_value")
    assert client.post("/api/creao/callback?token=wrong", json={"runId": "RUN9"}).status_code == 403
    ok = client.post(f"/api/creao/callback?token={creao.token()}", json={"runId": "unknown", "status": "completed"})
    assert ok.status_code == 200 and ok.json() == {"ok": False}


def test_status_never_returns_the_key(client, monkeypatch):
    monkeypatch.setattr(cfg, "creao_key", "capi_secret_value")
    assert "capi_secret_value" not in json.dumps(client.get("/api/creao/status").json())


def test_reply_parsing_survives_chatter_fences_and_artifacts(monkeypatch):
    """The agent may wrap the JSON in chat, fence it, or save it as a file and chat about it."""
    chatty = 'Done! Here it is:\n```json\n{"briefing": "Look at drift.", "follow_ups": ["a"]}\n```\nAnything else?'
    assert creao._json_in(chatty, "briefing")["briefing"] == "Look at drift."
    assert creao._json_in("no json here at all", "briefing") is None

    def get(url, timeout=None, headers=None):
        return httpx.Response(200, json={"level": "watch"}, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", get)
    body = {"result": {"text": "Summary: saved to files/x.json", "artifacts": [{"title": "t.json", "url": "https://x/t.json"}]}}
    assert creao._from_artifacts(body, "level")["level"] == "watch"


def test_mock_stays_mock_without_credentials():
    assert creao.live("briefing") is False and creao.live("triage") is False


def test_a_refused_webhook_does_not_stop_the_run(monkeypatch):
    """CREAO may reject the tunnel URL as the webhook. The run must start anyway, and poll instead."""
    monkeypatch.setattr(cfg, "creao_key", "capi_secret_value")
    monkeypatch.setattr(cfg, "public_url", "https://example.trycloudflare.com")
    seen = []

    def post(url, json=None, headers=None, timeout=None):
        seen.append("webhookUrl" in json)
        if "webhookUrl" in json:
            return httpx.Response(400, json={"error": "INVALID_INPUT"}, request=httpx.Request("POST", url))
        return httpx.Response(202, json={"id": "R1", "status": "pending"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", post)
    assert creao._post_run("agent-x", {"a": 1}, "run_12345678")["id"] == "R1"
    assert seen == [True, False]


def test_an_agent_that_replies_in_the_wrong_shape_is_reported_not_dumped(monkeypatch):
    """Raw JSON without the expected key must not be shown as the briefing."""
    monkeypatch.setattr(cfg, "creao_key", "capi_secret_value")
    row = {"id": "r1", "kind": "briefing", "status": "running", "mock": 0, "creao_run_id": "RX",
           "created": "", "patient_id": "p", "week": 1, "inputs": "{}"}
    saved = {}
    monkeypatch.setattr(db, "patch", lambda t, i, f, key="id": saved.update(f))
    monkeypatch.setattr(creao, "_get_run", lambda rid: {"status": "completed",
                        "result": {"text": '{"patient_ref": "pt-1", "week": 6}'}})
    creao._refresh(row)
    assert saved["error"] == creao.WRONG_FORMAT
    assert db.dec(saved["result"], {}) == {}


def test_a_markdown_briefing_file_is_used_when_there_is_no_json(monkeypatch):
    monkeypatch.setattr(cfg, "creao_key", "capi_secret_value")

    def get(url, timeout=None, headers=None):
        return httpx.Response(200, text="Red flag: drift. Look at the alert first.", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", get)
    body = {"result": {"artifacts": [{"title": "Care Team Briefing.md", "url": "https://x/b.md"}]}}
    assert creao._markdown_artifact(body).startswith("Red flag: drift")


def test_the_agents_own_alerts_are_not_fed_back_into_triage(pid):
    """An agent_review alert from one pipeline must not look like a red flag to the next."""
    from backend import alerts as alertmod

    alertmod.create(pid, "agent_review", "Week 1. The triage agent escalated this week for review.", notify=False)
    got = creao.facts(pid, 1)
    assert "agent_review" not in got["red_flags"]
    assert all(a["type"] != "agent_review" for a in got["alerts"])


def test_raw_json_is_never_shown_as_a_briefing():
    """A stored result that is JSON text is unwrapped when it holds the answer, dropped when not."""
    assert creao._readable({"briefing": '{"briefing": "Look at drift.", "follow_ups": ["a"]}'}, "briefing")["briefing"] == "Look at drift."
    assert "briefing" not in creao._readable({"briefing": '{"briefing_request": "{...}", "week": 6}'}, "briefing")
    assert creao._readable({"briefing": "Plain text stays."}, "briefing")["briefing"] == "Plain text stays."
