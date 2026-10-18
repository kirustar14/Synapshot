"""The red flag screen, the banned phrase filter and the alert it raises."""

from backend import alerts, db, demo
from backend.agent import llm, safety, summary
from backend.calls import script

BANNED = ["diagnos", "cleared to", "return to play", "medication dose"]


def test_every_red_flag_question_is_present():
    """All seven questions from the brief are asked."""
    keys = {q["key"] for q in safety.questions()}
    assert keys == {
        "worsening_headache", "repeated_vomiting", "seizure", "increasing_confusion",
        "new_weakness_or_numbness", "slurred_speech", "unusual_drowsiness",
    }
    assert all(q["ask"].endswith("?") for q in safety.questions())


def test_any_yes_stops_the_call_and_returns_the_emergency_script():
    """One yes on any question stops everything and says to get help now."""
    for q in safety.questions():
        got = safety.screen({q["key"]: True})
        assert got["stop"] is True, f"{q['key']} did not stop the call"
        assert got["flags"] == [q["key"]]
        low = got["say"].lower()
        assert "emergency" in low and "now" in low
    assert safety.screen({q["key"]: False for q in safety.questions()})["stop"] is False


def test_red_flag_creates_an_alert(seeded):
    """A positive screen writes a red_flag alert against the patient."""
    pid = seeded[0]["id"]
    before = len([a for a in db.alerts(pid) if a["type"] == "red_flag"])
    got = alerts.red_flag(pid, {"seizure": True, "repeated_vomiting": True}, notify=False)
    after = [a for a in db.alerts(pid) if a["type"] == "red_flag"]
    assert len(after) == before + 1
    assert got["type"] == "red_flag"
    assert "seizure" in got["trigger"] and "repeated vomiting" in got["trigger"]
    assert "red_flag" in alerts.flags(pid)


def test_no_patient_facing_string_contains_a_banned_phrase():
    """Every line of the full script, the short script and both summaries is clean."""
    lines = script.lines() + [s["say"] for s in script.steps(full=False)]
    lines += [safety.EMERGENCY, safety.SAFE_REDIRECT, safety.clean("you are cleared to drive")]
    lines += [summary.patient_text("Avery Stone", 4), summary.SAFETY_CLOSE]
    lines += [summary.patient_text("Avery Stone", 2, {"quality": {"ok": False}})]
    lines += [llm.SYSTEM.replace("never diagnose", "").replace("return-to-play", "")]
    for line in lines:
        for word in BANNED:
            assert word not in line.lower(), f"banned phrase {word!r} in: {line[:120]!r}"


def test_the_filter_replaces_a_bad_line():
    """Anything carrying a banned phrase is replaced by the redirect, not patched."""
    for bad in ("Your diagnosis is a concussion.", "You are cleared to drive.",
                "Safe to return to play on Friday.", "Double your medication dose."):
        out = safety.clean(bad)
        assert out == safety.SAFE_REDIRECT
        assert not safety.violations(out)


def test_the_filter_leaves_good_lines_alone():
    """A normal instruction passes through unchanged."""
    line = "Follow the dot with your eyes and keep your head still."
    assert safety.clean(line) == line


def test_short_version_rule():
    """Headache or fatigue at 8, or a symptom jump of 10, shortens the call."""
    assert safety.short_version({"headache": 8, "fatigue": 2})
    assert safety.short_version({"headache": 2, "fatigue": 9})
    assert safety.short_version({"headache": 2}, jump=11.0)
    assert not safety.short_version({"headache": 7, "fatigue": 7}, jump=4.0)
    for full in (True, False):
        kept = {s["id"] for s in script.steps(short=True, full=full)}
        assert not kept & set(script.SHORT_DROP)


def test_the_brief_script_is_the_four_minute_one():
    """The default length is about four minutes and the full protocol is about fourteen.

    Both are checked against the minutes the script itself claims, so a step whose timing
    changes cannot quietly turn the stated four minute call into a seven minute one.
    """
    assert 3.5 <= script.minutes(full=False) <= 4.5, script.minutes(full=False)
    assert 12.0 <= script.minutes(full=True) <= 16.0, script.minutes(full=True)
    assert script.ids(full=False) == script.BRIEF_IDS
    assert set(script.BRIEF_IDS) < {s["id"] for s in script.steps(full=True)}
    # The safety screen is first either way: nothing is measured before it has run.
    for full in (True, False):
        assert script.ids(full=full)[0] == "redflags", "the safety screen must come first"
        assert script.ids(full=full)[-1] == "wrap"


def test_the_brief_script_says_what_it_gives_up():
    """The tasks the brief version skips are named in one place, not implied."""
    missing = set(script.BRIEF_MISSING)
    assert missing == {s["id"] for s in script.steps(full=True)} - set(script.BRIEF_IDS)
    # The ones worth knowing about, because their features are absent for the week.
    assert {"saccade", "npc", "picture", "fluency", "speech_ah"} <= missing


def test_recall_is_never_asked_without_encoding():
    """A word list recall score is meaningless if the words were never shown."""
    for full in (True, False):
        for short in (True, False):
            got = script.ids(short=short, full=full)
            if "recall" in got:
                assert "encode" in got and got.index("encode") < got.index("recall")


def test_llm_falls_back_to_the_template_in_mock_mode():
    """With MOCK_LLM on, nothing is sent and the template comes back."""
    assert llm.live() is False
    got = llm.ask("say something else", "the template line")
    assert got["how"] == "template"
    assert got["text"] == "the template line"
    assert llm.ask("x", "You are cleared to play")["text"] == safety.SAFE_REDIRECT


def test_a_red_flag_call_stores_no_measurements(client, seeded):
    """A positive screen stops the real call route before anything is measured."""
    from backend.calls import sessions

    pid = [p["id"] for p in seeded if p["name"] != seeded[0]["name"]][0]
    token = sessions.create(pid)["token"]
    client.post(f"/api/call/{token}/consent",
                json={"calls": True, "ai": True, "recording": True, "genetic": False})
    before = len(db.checkins(pid))

    got = client.post(f"/api/call/{token}/redflags", json={"answers": {"seizure": True}}).json()
    assert got["stop"] is True
    low = got["say"].lower()
    assert "emergency" in low and "now" in low

    assert sessions.get(token)["state"] == "stopped"
    assert len(db.checkins(pid)) == before, "a red flag call must not store a check-in"
    assert any(a["type"] == "red_flag" for a in db.alerts(pid))
    # Every later route on this session is refused, so nothing can be posted after.
    assert client.post(f"/api/call/{token}/symptoms",
                       json={"scores": {"headache": 3}}).status_code == 409


def test_a_red_flag_never_places_a_phone_call(seeded):
    """The red flag path raises an alert and texts. It does not ring anybody.

    An earlier version dialled a clinic number here. A rule that can fire several times in
    a row must not be able to ring a phone several times in a row, so the whole outbound
    call path is gone and this is the test that keeps it gone.
    """
    import backend
    import pkgutil

    pid = seeded[0]["id"]
    alerts.red_flag(pid, {"seizure": True}, notify=False)
    rows = db.rows("select * from events where patient_id=? and kind='clinic_call'", (pid,))
    assert rows == [], "nothing may log an outbound clinic call"

    names = {m.name for m in pkgutil.walk_packages(backend.__path__, "backend.")}
    assert not [n for n in names if "clinic_call" in n or "rig_hub" in n]
