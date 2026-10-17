"""The red flag screen, the banned phrase filter and the alert it raises."""

from backend import alerts, db, demo
from backend.agent import llm, safety, script, summary

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
    lines = script.all_lines(short=False) + script.all_lines(short=True)
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
    dropped = {s["id"] for s in script.plan(short=True)}
    assert not dropped & set(script.SHORT_DROP)


def test_the_script_is_fourteen_minutes():
    """The full script adds up to the stated length."""
    assert abs(script.minutes() - 14.0) < 0.01
    assert len(script.steps()) == 12
    assert [s["id"] for s in script.steps()][0] == "consent", "consent must come first"


def test_llm_falls_back_to_the_template_in_mock_mode():
    """With MOCK_LLM on, nothing is sent and the template comes back."""
    assert llm.live() is False
    got = llm.ask("say something else", "the template line")
    assert got["how"] == "template"
    assert got["text"] == "the template line"
    assert llm.ask("x", "You are cleared to play")["text"] == safety.SAFE_REDIRECT


def test_a_red_flag_call_stores_no_measurements(seeded):
    """When the screen is positive the call stops before anything is measured."""
    from backend import rig_hub

    pid = [p["id"] for p in seeded if p["name"] != seeded[0]["name"]][0]
    week = int(db.patient(pid)["week"] or 0) + 1
    truth = demo.truth_of(pid)
    if week not in truth:
        truth[week] = demo.extend_truth(pid, truth, week)
        demo.set_truth(pid, truth)

    hub = rig_hub.MockHub(pid, week, truth[week])
    hub.listen = lambda seconds, prompt="": "yes" if "?" in prompt else "okay"
    before = len(db.checkins(pid))
    from backend.agent import dialog

    got = dialog.run(hub, pid, week)
    assert got["red_flags"], "the screen should have fired"
    assert got["session"] is None and got["pipeline"] is None
    assert len(db.checkins(pid)) == before, "a red flag call must not store a check-in"
    assert db.observations(pid) == db.observations(pid)
