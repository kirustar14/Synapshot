"""The web call: tokens, schema validation, camera latency, the safety stop, and comms.

The point of these is that a mock web call goes through exactly the same ingest,
validation, calibration, feature and filter code a real phone would, so the only thing
left untested on a laptop is the phone itself.
"""

import numpy as np
import pytest

from backend import db
from backend.agent import voices
from backend.calls import script as callscript
from backend.calls import sessions
from backend.comms import notify, photon, sms
from backend.config import cfg
from backend.features import pipeline, webframes, websynth

TRUE_DELAY_S = 0.08
VALS = {
    "pursuit_gain": 0.78, "saccade_latency": 215.0, "antisaccade_err": 22.0,
    "speech_rate": 4.3, "recall_delayed": 9.0, "symptom_total": 18.0, "fluency_animals": 17,
}


def web_session(seed: int = 5, **kw) -> dict:
    """A generated web call put through the real assembler."""
    got = websynth.session(VALS, seed=seed, **kw)
    sess = webframes.assemble(got["chunks"], answers=got["answers"], words=got["words"],
                              extra={"ah_duration": got["ah_duration"],
                                     "ptk_rate": got["ptk_rate"]})
    return sess


# ---------------------------------------------------------------- schema validation

def test_schema_rejects_frames_that_go_backwards():
    """Timestamps that are not increasing are refused."""
    meta = webframes.Meta(w_px=390, h_px=844, dpr=3, ua="t", fps=30)
    rows = [frame_at(0.0), frame_at(100.0), frame_at(50.0)]
    with pytest.raises(ValueError, match="not increasing"):
        webframes.check_frames(rows, meta)


def test_schema_rejects_an_impossible_frame_rate():
    """More than 90 frames a second is not a phone camera."""
    meta = webframes.Meta(w_px=390, h_px=844, dpr=3, ua="t", fps=30)
    rows = [frame_at(i * 2.0) for i in range(100)]   # 500 fps
    with pytest.raises(ValueError, match="frames per second"):
        webframes.check_frames(rows, meta)


def test_schema_rejects_values_outside_their_range():
    """A ratio, a brightness or a head angle outside its range is refused."""
    import pydantic

    for bad in ({"bright": 4.0}, {"iris_px": -3.0}, {"ratio": {"h": 9.0, "v": 0.5}},
                {"head": {"yaw": 500.0, "pitch": 0.0, "roll": 0.0}},
                {"ear": {"l": 3.0, "r": 0.3}}):
        with pytest.raises(pydantic.ValidationError):
            webframes.FrameRec(**{**raw_frame(0.0), **bad})


def test_schema_rejects_a_bad_stimulus_side():
    """A side has to be L or R."""
    import pydantic

    with pytest.raises(pydantic.ValidationError):
        webframes.StimEvent(t=1.0, kind="saccade_jump", side="middle")


def test_schema_rejects_a_stimulus_log_out_of_order():
    """The page's own log must be in time order."""
    rows = [webframes.StimEvent(t=10.0, kind="task"), webframes.StimEvent(t=1.0, kind="task")]
    with pytest.raises(ValueError, match="not increasing"):
        webframes.check_stim(rows)


def raw_frame(t: float) -> dict:
    """A valid FrameRec as a plain dict."""
    return {
        "t": t, "face": True, "ratio": {"h": 0.5, "v": 0.5},
        "iris": {"lx": 0.4, "ly": 0.5, "rx": 0.6, "ry": 0.5}, "iris_px": 16.0,
        "head": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "ear": {"l": 0.3, "r": 0.3},
        "bright": 0.45, "blend": {"smile": 0.1, "brow_down": 0.1, "jaw_open": 0.05},
    }


def frame_at(t: float) -> webframes.FrameRec:
    """A valid FrameRec at one time."""
    return webframes.FrameRec(**raw_frame(t))


# ---------------------------------------------------------------- camera latency

def test_camera_latency_is_recovered_within_fifteen_ms():
    """A known 80 ms camera delay is estimated from the ten test flashes."""
    errs = []
    for seed in range(8):
        sess = web_session(seed=seed, cam_delay_s=TRUE_DELAY_S)
        cam = sess["camera"]
        assert cam["flash_ok"], cam["why"]
        assert cam["found"] >= webframes.MIN_FLASH
        errs.append(abs(cam["latency_s"] - TRUE_DELAY_S) * 1000.0)
    assert max(errs) <= 15.0, f"worst camera latency error was {max(errs):.1f} ms"


def test_saccade_latency_is_recovered_once_the_camera_lag_is_removed():
    """Subtracting the measured camera lag leaves the patient's own latency.

    The residual error is frame quantization at 30 fps plus the error in the camera lag
    estimate itself, which is why the gate is 20 ms and not 5.
    """
    errs = []
    for seed in range(8):
        sess = web_session(seed=seed, cam_delay_s=TRUE_DELAY_S)
        got = pipeline.run(sess, age=24, sex="M")
        lat = got["values"].get("saccade_latency")
        assert lat is not None, "the saccade latency was not measured at all"
        errs.append(abs(lat - VALS["saccade_latency"]))
    assert max(errs) <= 20.0, f"worst saccade latency error was {max(errs):.1f} ms"


def test_the_spread_gate_catches_unsteady_flash_timing():
    """A camera whose lag jumps around cannot be used for tier B."""
    sess = web_session(seed=3, cam_delay_s=TRUE_DELAY_S)
    frames = sess["frames"]
    # Keep the same flashes but scatter the times they are compared against, which is
    # what an unsteady camera looks like to the estimator.
    jittered = [t * 1000.0 + (120.0 if i % 2 else 0.0)
                for i, t in enumerate(sess["flashes"])]
    got = webframes.camera_latency(frames, jittered, 0.0)
    assert got["sd_ms"] > webframes.SD_GATE_MS or got["found"] < webframes.MIN_FLASH
    assert not got["flash_ok"]
    assert got["why"]


def test_a_failed_flash_test_drops_tier_b_only():
    """Fewer than eight flashes kills every tier B measure and keeps the tier A ones."""
    sess = web_session(seed=5, flash_ok=False)
    got = pipeline.run(sess, age=24, sex="M")
    assert not got["flash_ok"]
    tiers = {f["name"]: f["tier"] for f in got["features"]}
    assert not [n for n, t in tiers.items() if t == "B"], "a tier B measure survived"
    assert [n for n, t in tiers.items() if t == "A"], "every tier A measure was dropped too"
    for key in ("speech_rate", "recall_delayed", "symptom_total"):
        assert key in tiers, f"{key} is tier A and should have survived"


def test_the_pipeline_measures_the_web_session_back():
    """Every observable the generator was built from comes back out of the web path."""
    sess = web_session(seed=5, cam_delay_s=TRUE_DELAY_S)
    got = pipeline.run(sess, age=24, sex="M")
    vals = got["values"]
    assert abs(vals["pursuit_gain"] - VALS["pursuit_gain"]) < 0.1
    assert abs(vals["speech_rate"] - VALS["speech_rate"]) < 0.5
    assert abs(vals["recall_delayed"] - VALS["recall_delayed"]) < 1.5
    assert abs(vals["symptom_total"] - VALS["symptom_total"]) < 2.0
    assert got["channel"]["flash_ok"]
    assert got["channel"]["calib_err_deg"] < 3.0, "the nine dot fit should be usable"
    assert len(got["gaze"]) >= 4, "a trace per eye task"


def test_calibration_uses_the_dots_the_page_actually_drew():
    """The nine dot coordinates come out of the stimulus log, not an assumption."""
    sess = web_session(seed=5)
    assert len(sess["calib"]) == 9
    from backend.features import gaze as gz

    drawn = {(round(d["sx"], 3), round(d["sy"], 3)) for d in sess["calib"]}
    assert drawn == {(round(x, 3), round(y, 3)) for x, y in gz.DOTS}


def test_frames_never_carry_video():
    """A FrameRec has no image field, by construction."""
    fields = set(webframes.FrameRec.model_fields)
    for banned in ("image", "jpeg", "frame", "video", "pixels", "data"):
        assert banned not in fields


# ---------------------------------------------------------------- tokens and sessions

def test_a_token_is_one_session_and_unknown_tokens_are_404(client, seeded):
    """Each link is its own session, and a made up token is not found."""
    pid = seeded[0]["id"]
    a = client.post("/api/calls", json={"patient_id": pid, "send": False}).json()
    b = client.post("/api/calls", json={"patient_id": pid, "send": False}).json()
    assert a["token"] != b["token"]
    assert len(a["token"]) >= 40, "a token should be 32 random bytes urlsafe"
    assert a["url"].endswith(a["token"])
    assert client.get("/api/call/not-a-real-token/script").status_code == 404


def test_an_expired_token_is_gone(client, seeded):
    """A link past its day returns 410, not 404, so the page can say so."""
    import time

    pid = seeded[0]["id"]
    got = client.post("/api/calls", json={"patient_id": pid, "send": False}).json()
    sessions.patch(got["token"], {"expires": time.time() - 10})
    assert client.get(f"/api/call/{got['token']}/script").status_code == 410


def test_no_task_runs_before_consent(client, seeded):
    """Frames are refused until all three required consents are in."""
    pid = seeded[0]["id"]
    tok = client.post("/api/calls", json={"patient_id": pid, "send": False}).json()["token"]
    body = {"task": "calib", "meta": {"w_px": 390, "h_px": 844, "dpr": 3, "ua": "t", "fps": 30},
            "frames": [], "stim": []}
    assert client.post(f"/api/call/{tok}/frames", json=body).status_code == 403

    # Two of three is still not consent.
    client.post(f"/api/call/{tok}/consent",
                json={"calls": True, "ai": True, "recording": False, "genetic": False})
    assert client.post(f"/api/call/{tok}/frames", json=body).status_code == 403

    client.post(f"/api/call/{tok}/consent",
                json={"calls": True, "ai": True, "recording": True, "genetic": False})
    assert client.post(f"/api/call/{tok}/frames", json=body).status_code == 200


def test_the_rate_limit_fires(client, seeded):
    """One page cannot flood the ingest."""
    pid = seeded[0]["id"]
    tok = client.post("/api/calls", json={"patient_id": pid, "send": False}).json()["token"]
    client.post(f"/api/call/{tok}/consent",
                json={"calls": True, "ai": True, "recording": True, "genetic": False})
    body = {"task": "calib", "meta": {"w_px": 390, "h_px": 844, "dpr": 3, "ua": "t", "fps": 30},
            "frames": [], "stim": []}
    codes = {client.post(f"/api/call/{tok}/frames", json=body).status_code
             for _ in range(sessions.RATE_MAX + 20)}
    assert 429 in codes, "the rate limit never fired"


def test_malformed_frames_are_rejected_by_the_route(client, seeded):
    """The route refuses a chunk the schema does not accept."""
    pid = seeded[0]["id"]
    tok = client.post("/api/calls", json={"patient_id": pid, "send": False}).json()["token"]
    client.post(f"/api/call/{tok}/consent",
                json={"calls": True, "ai": True, "recording": True, "genetic": False})
    meta = {"w_px": 390, "h_px": 844, "dpr": 3, "ua": "t", "fps": 30}
    bad = client.post(f"/api/call/{tok}/frames",
                      json={"task": "calib", "meta": meta,
                            "frames": [raw_frame(10.0), raw_frame(1.0)], "stim": []})
    assert bad.status_code == 422


# ---------------------------------------------------------------- the safety stop

def test_a_red_flag_stops_the_call_and_accepts_nothing_after(client, seeded):
    """Any yes stops the session, raises the alert and texts. Nothing is dialled."""
    pid = [p for p in seeded if p["name"]][0]["id"]
    tok = client.post("/api/calls", json={"patient_id": pid, "send": False}).json()["token"]
    client.post(f"/api/call/{tok}/consent",
                json={"calls": True, "ai": True, "recording": True, "genetic": False})

    alerts_before = len([a for a in db.alerts(pid) if a["type"] == "red_flag"])
    msgs_before = len(db.messages(pid))

    answers = {q: False for q in
               ["worsening_headache", "repeated_vomiting", "seizure", "increasing_confusion",
                "new_weakness_or_numbness", "slurred_speech", "unusual_drowsiness"]}
    answers["seizure"] = True
    got = client.post(f"/api/call/{tok}/redflags", json={"answers": answers})
    assert got.status_code == 200
    body = got.json()
    assert body["stop"] is True
    assert "medical help" in body["say"].lower()

    assert len([a for a in db.alerts(pid) if a["type"] == "red_flag"]) == alerts_before + 1
    assert len(db.messages(pid)) > msgs_before, "no emergency text went out"
    assert db.rows("select * from events where patient_id=? and kind='clinic_call'",
                   (pid,)) == [], "nothing may dial out from the safety path"

    # The session is stopped, so nothing else is accepted.
    assert sessions.get(tok)["state"] == "stopped"
    meta = {"w_px": 390, "h_px": 844, "dpr": 3, "ua": "t", "fps": 30}
    after = client.post(f"/api/call/{tok}/frames",
                        json={"task": "calib", "meta": meta, "frames": [], "stim": []})
    assert after.status_code == 409, "frames were accepted after a red flag"
    assert client.get(f"/api/call/{tok}/status").json()["state"] == "stopped"


def test_all_clear_carries_on(client, seeded):
    """Seven noes let the call continue."""
    pid = seeded[1]["id"]
    tok = client.post("/api/calls", json={"patient_id": pid, "send": False}).json()["token"]
    client.post(f"/api/call/{tok}/consent",
                json={"calls": True, "ai": True, "recording": True, "genetic": False})
    answers = {q: False for q in
               ["worsening_headache", "repeated_vomiting", "seizure", "increasing_confusion",
                "new_weakness_or_numbness", "slurred_speech", "unusual_drowsiness"]}
    body = client.post(f"/api/call/{tok}/redflags", json={"answers": answers}).json()
    assert body["stop"] is False
    assert sessions.get(tok)["state"] != "stopped"


def test_the_short_version_rule_skips_the_same_blocks(client, seeded):
    """A high headache score shortens the call and names the steps to drop."""
    pid = seeded[1]["id"]
    tok = client.post("/api/calls", json={"patient_id": pid, "send": False}).json()["token"]
    client.post(f"/api/call/{tok}/consent",
                json={"calls": True, "ai": True, "recording": True, "genetic": False})
    got = client.post(f"/api/call/{tok}/symptoms",
                      json={"scores": {"headache": 9, "fatigue": 2}, "phase": "baseline"}).json()
    assert got["short"] is True
    assert set(got["skip"]) == set(callscript.SHORT_DROP)


# ---------------------------------------------------------------- the whole call

def test_a_full_mock_web_call_runs_end_to_end(seeded):
    """Session, ingest, pipeline, twin update, alert rules and summary, with no phone."""
    from backend.calls import run as callrun

    pid = seeded[1]["id"]
    before = len(db.checkins(pid))
    notes_before = len([m for m in db.messages(pid) if m["kind"] == "post_call"])
    state_before = str(db.patient(pid)["state"])

    start = sessions.create(pid)
    got = callrun.mock_call(start["token"])

    assert got["ok"], got.get("error")
    assert got["call_id"], "no check-in was stored"
    assert len(db.checkins(pid)) == before + 1

    row = sessions.get(start["token"])
    assert row["state"] == "done"
    assert row["summary"], "no patient summary was produced"

    chk = db.checkins(pid)[-1]
    feats = db.dec(chk["features"], [])
    assert len(feats) > 10, f"only {len(feats)} features came out"
    assert db.dec(chk["gaze"], []), "no gaze traces were stored"
    assert str(db.patient(pid)["state"]) != state_before, "the filter did not update"
    # Exactly one summary text per call. An alert can add its own text on top, which is a
    # different kind and a real second message, not a duplicate.
    notes = [m for m in db.messages(pid) if m["kind"] == "post_call"]
    assert len(notes) == notes_before + 1, "the summary text was written more than once"
    assert not sessions.chunks(start["token"]), "the raw chunks were not cleaned up"


def test_the_mock_call_leaves_no_audio_behind(seeded):
    """Audio is deleted once the features are out of it, unless KEEP_AUDIO is set."""
    from backend.calls import audio as callaudio

    assert not cfg.keep_audio, "the tests expect KEEP_AUDIO off"
    pid = seeded[1]["id"]
    start = sessions.create(pid)
    callaudio.save(start["token"], "speech_ah", b"x" * 2000, ".webm")
    callaudio.discard(start["token"])
    assert not (cfg.data_dir / "calls" / start["token"]).exists()


# ---------------------------------------------------------------- voices

def test_every_voice_line_passes_the_filter():
    """No generated line can contain a banned phrase."""
    from backend.agent import safety

    rows = voices.lines()
    assert len(rows) > 25, "every step, the consent text, the prompts and the emergency line"
    for row in rows:
        assert not safety.violations(row["text"]), f"{row['id']} contains a banned phrase"


def test_voices_refuses_a_banned_line(tmp_path):
    """Generation is refused rather than quietly substituted."""
    got = voices.generate("I am going to diagnose you now.", tmp_path / "x.mp3")
    assert not got["ok"]
    assert "refused" in got["error"]
    assert not (tmp_path / "x.mp3").exists()


def test_the_voice_hash_changes_with_the_text():
    """The manifest hash tracks the line, the voice and the model."""
    a = voices.hash_of("hello there")
    assert a == voices.hash_of("hello there")
    assert a != voices.hash_of("hello there.")


def test_every_step_has_audio_or_a_documented_fallback():
    """A line without an mp3 is reported as missing, so the page knows to speak it."""
    got = voices.payload()
    ids = {row["id"] for row in got["lines"]}
    for step in callscript.steps():
        assert step["id"] in ids, f"{step['id']} has no voice line entry"
    for row in got["lines"]:
        assert row["exists"] or not row["file"], \
            f"{row['id']} claims a file that is not on disk"
    assert "speech synthesis" in got["note"], "the fallback must be stated"


def test_the_script_covers_every_task_the_page_can_run():
    """Every step's task is one the contract names, and the order is the call's order."""
    allowed = {"none", "redflags", "quality", "calib", "symptoms", "encode", "pursuit_h",
               "pursuit_v", "saccade", "antisaccade", "fixation", "npc", "speech_ah",
               "speech_pataka", "speech_passage", "picture", "fluency", "recall", "wrap"}
    ids = callscript.ids()
    assert ids[0] == "redflags", "safety comes before anything is measured"
    assert ids[1:3] == ["quality", "calib"], "the gates come before the tasks"
    assert ids[-1] == "wrap"
    for step in callscript.steps():
        assert step["task"] in allowed, f"{step['id']} has an unknown task {step['task']}"
    assert 12.0 <= callscript.minutes() <= 16.0, f"the call is {callscript.minutes()} minutes"


def test_the_consent_text_says_the_video_stays_on_the_phone():
    """The one privacy fact that changed with the web call is stated plainly."""
    text = " ".join(callscript.consent_text()).lower()
    assert "never leaves your phone" in text
    assert "software, not a person" in text
    assert "optional and off by default" in text


# ---------------------------------------------------------------- comms

def test_notify_falls_back_to_mock_and_records_the_channel(seeded):
    """With no transport configured the row says mock, and says it once."""
    pid = seeded[0]["id"]
    assert not photon.available()
    assert not sms.available()
    before = len(db.messages(pid))
    got = notify.send(pid, "midweek")
    assert got["channel"] == "mock"
    rows = db.messages(pid)
    assert len(rows) == before + 1, "a fallback chain must not write the row more than once"
    assert rows[-1]["channel"] == "mock"
    assert rows[-1]["kind"] == "midweek"


def test_an_sms_is_never_labelled_imessage():
    """The two transports report different channels, by construction."""
    assert "imessage" not in str(sms.send.__doc__ or "").lower().split("labels")[0]
    # The only place a row can be called imessage is behind a real iMessage success.
    import inspect

    src = inspect.getsource(notify.send)
    assert 'channel="imessage"' in src
    assert '== "imessage"' in src, "the imessage label must be gated on a real success"


def test_every_message_kind_has_a_body(seeded):
    """Each kind produces a filtered, non empty, plain language text."""
    from backend.agent import safety

    pid = seeded[0]["id"]
    for kind in notify.KINDS:
        text = notify.body_for(pid, kind, link="https://example.test/call/abc", body="done")
        assert text and len(text) > 20, f"{kind} has no body"
        assert not safety.violations(text), f"{kind} contains a banned phrase"


def test_the_post_call_text_keeps_the_clinician_sentence(seeded):
    """The safety sentence is appended outside any model's reach, exactly once."""
    from backend.agent.summary import SAFETY_CLOSE

    pid = seeded[0]["id"]
    once = notify.body_for(pid, "post_call", body="Thanks, that is this week done.")
    assert SAFETY_CLOSE in once
    twice = notify.body_for(pid, "post_call", body=f"Already has it. {SAFETY_CLOSE}")
    assert twice.count(SAFETY_CLOSE) == 1, "the sentence was added twice"


def test_nothing_in_the_app_can_place_a_phone_call():
    """There is no outbound voice path left, in any module, under any switch.

    This guard exists because the opposite happened: ELEVENLABS_AGENT_ID,
    ELEVENLABS_PHONE_NUMBER_ID and CLINIC_NUMBER were all set, MOCK_ELEVEN was not, and
    every red flag and drift alert placed a real outbound call to a real person, over and
    over, as the seed and the tests fired alerts. The fix is not a safer switch. The
    switch is gone and so is the code behind it: the demo is a text with a link in it and
    an alert that lands in the clinician's workspace. This fails if anybody adds one back.
    """
    import importlib
    import re
    from pathlib import Path as _Path

    root = _Path(__file__).resolve().parent.parent / "backend"
    dialers = re.compile(
        r"Calls\.json|\.calls\.create|<Response>|twiml|outbound_call"
        r"|convai/[a-z_]*phone|phone_number_id",
        re.I,
    )
    hits = []
    for path in sorted(root.rglob("*.py")):
        for n, line in enumerate(path.read_text().splitlines(), 1):
            if dialers.search(line):
                hits.append(f"{path.relative_to(root)}:{n}: {line.strip()[:80]}")
    assert hits == [], "something can dial a phone:\n" + "\n".join(hits)

    for gone in ("backend.comms.clinic_call", "backend.rig_hub", "backend.agent.dialog"):
        with pytest.raises(ModuleNotFoundError):
            importlib.import_module(gone)


def test_an_alert_lands_in_the_workspace_instead_of_ringing(seeded):
    """A red flag alert pushes onto the patient's event stream and dials nothing."""
    from backend import alerts as alertmod
    from backend import live

    pid = seeded[3]["id"]
    live.RECENT.pop(pid, None)
    got = alertmod.red_flag(pid, {"seizure": True}, notify=False)

    assert db.rows("select * from events where patient_id=? and kind='clinic_call'",
                   (pid,)) == []
    pushed = [e for e in live.RECENT.get(pid, []) if e["kind"] == "alert"]
    assert pushed, "the alert never reached the clinician's screen"
    assert pushed[-1]["id"] == got["id"] and pushed[-1]["type"] == "red_flag"
    # And the flag can say which rule fired and what the threshold was.
    why = alertmod.explain(got["id"])
    assert why["ok"] and why["rule"] and why["threshold"]


def test_nothing_is_sent_outside_the_allow_list():
    """A number not on DEMO_PHONES is refused by both transports."""
    assert not cfg.may_text("+15550000000")
    assert not cfg.may_text("")
    for number in cfg.demo_phones:
        assert cfg.may_text(number)


def test_the_sidecar_reports_honestly():
    """The iMessage probe says what is actually installed, never a guess."""
    got = photon.docs()
    assert set(got) >= {"installed"}
    assert isinstance(got["installed"], bool)


# ---------------------------------------------------------------- secrets

def test_no_secret_appears_in_any_response(client, seeded):
    """A full pass over every route never echoes a credential."""
    import os

    secrets = [v for k, v in os.environ.items()
               if any(t in k for t in ("KEY", "SECRET", "TOKEN", "SID", "PASSWORD"))
               and v and len(v) >= 12 and k != "DB_PATH"]

    pid = seeded[0]["id"]
    start = client.post("/api/calls", json={"patient_id": pid, "send": False}).json()
    paths = [
        "/api/health", "/api/patients", f"/api/patients/{pid}",
        f"/api/patients/{pid}/forecast", f"/api/patients/{pid}/twin",
        f"/api/patients/{pid}/shape", f"/api/patients/{pid}/messages",
        f"/api/patients/{pid}/twin-inputs", "/api/receptors", "/api/alerts",
        "/api/cohort", "/api/voices", "/api/photon/status",
        f"/api/call/{start['token']}/status", f"/api/call/{start['token']}/script",
    ]
    blobs = []
    for path in paths:
        got = client.get(path)
        assert got.status_code < 500, f"{path} returned {got.status_code}"
        blobs.append(got.text)
    blobs.append(client.post(f"/api/patients/{pid}/intervention",
                             json={"target": "NMDA", "gain": 0.2}).text)

    body = "\n".join(blobs)
    for secret in secrets:
        assert secret not in body, "a credential was echoed in an API response"
    # The mesh is the one big payload, checked separately so the assert message is useful.
    mesh = client.get("/api/mesh").text
    for secret in secrets:
        assert secret not in mesh


def test_no_secret_appears_in_a_stored_event_or_message(seeded):
    """A full mock call leaves no credential in the database either."""
    import os

    from backend.calls import run as callrun

    secrets = [v for k, v in os.environ.items()
               if any(t in k for t in ("KEY", "SECRET", "TOKEN", "SID", "PASSWORD"))
               and v and len(v) >= 12 and k != "DB_PATH"]
    pid = seeded[1]["id"]
    start = sessions.create(pid)
    callrun.mock_call(start["token"])

    rows = db.rows("select payload from events") + db.rows("select body as payload from messages")
    body = "\n".join(str(r["payload"]) for r in rows)
    for secret in secrets:
        assert secret not in body, "a credential reached the database"


def test_the_token_is_not_logged_next_to_the_patient(seeded):
    """Session events record only the tail of a token, never the whole thing."""
    pid = seeded[0]["id"]
    start = sessions.create(pid)
    rows = db.rows("select payload from events where patient_id=?", (pid,))
    body = "\n".join(str(r["payload"]) for r in rows)
    assert start["token"] not in body


def test_a_call_token_is_masked_in_the_access_log(seeded):
    """The token travels in the URL path, so the access logger must not write it out.

    It is the only credential a patient has: with it you can read their script, post
    measurements as them and read their summary. uvicorn logs the whole path by default.
    """
    import logging

    from backend import logs

    token = sessions.create(seeded[0]["id"])["token"]
    for path in (f"/api/call/{token}/frames", f"/call/{token}",
                 f"/api/call/{token}/audio/speech_ah"):
        masked = logs.mask(f'"GET {path} HTTP/1.1" 200 OK')
        assert token not in masked, f"{path} leaked the token"
        assert token[-6:] in masked, "enough of the tail should survive to debug with"

    # And through a real log record, the way the filter actually runs.
    flt = logs.MaskTokens()
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0,
                               '%s - "%s %s HTTP/1.1" %d', ("127.0.0.1", "GET",
                               f"/api/call/{token}/status", 200), None)
    assert flt.filter(record)
    assert token not in (record.getMessage())


def test_masking_leaves_other_paths_alone():
    """Only call tokens are rewritten, so ordinary paths stay readable."""
    from backend import logs

    for path in ("/api/patients", "/api/mesh", "/api/alerts", "/voice/redflags.mp3",
                 "/api/patients/pat_abc123/twin"):
        assert logs.mask(path) == path


# ---------------------------------------------------------------- the one call path

def test_a_call_only_ever_happens_on_the_patients_own_phone(client, seeded):
    """There is one way a call starts: a session, a link, and the patient opening it."""
    pid = seeded[0]["id"]
    got = client.post("/api/demo/trigger-call", json={"patient_id": pid}).json()
    assert got["ok"] and got["mode"] == "web"
    assert got["url"].endswith(got["token"])
    assert "/call/" in got["url"], "the patient gets a link to a page, not a phone call"
    # The link is the whole demo, so a browser with no session has to be able to open it.
    assert client.get(f"/call/{got['token']}").status_code == 200


def test_the_brief_script_is_what_the_call_page_serves_by_default(client, seeded):
    """GET /script is the four minute version unless ?full=1 asks for the protocol."""
    pid = seeded[0]["id"]
    tok = client.post("/api/calls", json={"patient_id": pid, "send": False}).json()["token"]

    brief = client.get(f"/api/call/{tok}/script").json()
    assert [s["id"] for s in brief["steps"]] == callscript.BRIEF_IDS
    assert 3.5 <= sum(s["minutes"] for s in brief["steps"]) <= 4.5

    full = client.get(f"/api/call/{tok}/script", params={"full": 1}).json()
    assert len(full["steps"]) > len(brief["steps"])
    assert 12.0 <= sum(s["minutes"] for s in full["steps"]) <= 16.0

    # Both lengths get the same consent text and the same word list, because those are
    # not part of what the brief version trades away.
    assert brief["consent"] == full["consent"]
    assert brief["words"] == full["words"]


def test_the_brief_script_still_measures_a_usable_week():
    """A call that ran only the brief task set produces real observables, not zeros.

    The brief version drops eight tasks, so this is the test that says what survives:
    the features it can measure are measured, the ones it cannot are absent rather than
    filled in, and the pipeline does not fall over on the gaps.
    """
    got = websynth.session(VALS, seed=7)
    keep = {s["task"] for s in callscript.steps(full=False)}
    chunks = [c for c in got["chunks"] if c["task"] in keep or c["task"] == "quality"]
    assert chunks, "the brief script posts nothing at all"

    sess = webframes.assemble(
        chunks,
        answers={"symptoms": got["answers"]["symptoms"]},
        audio_tasks={},
        words=[w for w in got["words"] if w.get("task") in keep],
    )
    res = pipeline.run(sess, age=22, sex="female")
    vals = pipeline.observables(res["values"])
    assert vals, "the brief script measured nothing"
    assert "symptom_total" in vals
    # The tasks it skipped are simply not reported. Nothing invents a number for them.
    for absent in ("fluency_animals", "npc_cm"):
        assert absent not in vals, f"{absent} cannot be measured by the brief script"


def test_the_websynth_generator_matches_the_contract():
    """What the generator posts is what the schema accepts."""
    got = websynth.session(VALS, seed=1)
    frames = [c for c in got["chunks"] if c["kind"] == "frames"]
    stim = [c for c in got["chunks"] if c["kind"] == "stim"]
    assert frames and stim
    for chunk in frames:
        for row in chunk["payload"][:5]:
            webframes.FrameRec(**row)
    for chunk in stim:
        for row in chunk["payload"]:
            webframes.StimEvent(**row)
    kinds = {row["kind"] for chunk in stim for row in chunk["payload"]}
    assert {"task", "test_flash", "calib_dot", "saccade_jump", "antisaccade_jump"} <= kinds
