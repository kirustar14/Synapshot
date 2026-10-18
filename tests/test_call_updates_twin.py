"""A check-in has to change the brain, and the change has to be reported honestly.

This started as a question rather than a test: after a call, does the 3D view actually
move. The answer at the time was no. `demo.assimilate` updated the filter and rebuilt the
forecast, so every chart responded, but the twin, which is what the brain is drawn from,
was written once when the patient was created and never touched again. A hundred regions,
none of them ever moving. `scripts/call_update_report.py` printed 0 of 100.

So these hold two things: the regions move when a call lands, and what gets reported
about the move is the truth, including when the truth is that it was small.
"""

import pytest

from backend import db, demo
from backend.calls import run as callrun
from backend.calls import sessions
from backend.twin import build


@pytest.fixture
def fresh(client):
    """A patient of this module's own, with a twin built and no calls yet.

    Not the shared `seeded` ones. Every test here runs a real check-in, which writes a
    row dated today and advances the week, and doing that to the six demo patients broke
    two tests in other files that depend on their history being exactly what the seed
    wrote. A fixture that mutates what other tests read is a fixture that makes unrelated
    failures.
    """
    made = client.post("/api/patients", json={"name": "Twin Update Check", "age": 30, "sex": "F"})
    assert made.status_code in (200, 201), made.text
    pid = str(made.json()["id"])
    client.post(f"/api/patients/{pid}/build-twin")
    return pid


def twin_of(pid: str) -> dict:
    """The stored twin, which is what the workspace draws."""
    row = db.twin_inputs(pid)
    return (db.dec(row["payload"], {}) or {}).get("twin") or {}


def latest_update(pid: str) -> dict:
    """The call_update event the stream pushed and latest-update serves."""
    rows = db.rows("select * from events where patient_id=? and kind='call_update' "
                   "order by time desc, rowid desc limit 1", (pid,))
    return db.dec(rows[0]["payload"], {}) if rows else {}


def damage_at(twin: dict, week: int) -> dict[int, float]:
    """Damage per region id at one week."""
    out = {}
    for r in twin.get("regions", []):
        series = r.get("damage") or [0.0]
        out[int(r["id"])] = float(series[min(max(week, 0), len(series) - 1)])
    return out


def run_call(pid: str, degrade: float = 0.0) -> dict:
    """One generated call all the way through finish."""
    return callrun.mock_call(sessions.create(pid)["token"], degrade=degrade)


def test_a_call_moves_the_regions(fresh):
    """The thing that was broken: the twin has to change when a call lands."""
    pid = fresh
    before = twin_of(pid)
    assert before.get("regions"), "no twin to compare against"

    got = run_call(pid, degrade=1.0)
    assert got["ok"], got

    week = int(db.patient(pid)["week"] or 0)
    after = twin_of(pid)
    was, now = damage_at(before, week), damage_at(after, week)
    moved = [rid for rid, v in now.items() if abs(v - was.get(rid, v)) > build.MOVED_FLOOR]
    assert moved, "not one region moved, which is the bug this test exists for"


def test_the_update_event_names_what_moved(fresh):
    """The payload carries the regions, the parameters and a sentence about them."""
    pid = fresh
    assert run_call(pid, degrade=1.0)["ok"]

    up = latest_update(pid)
    assert up, "no call_update event was recorded"
    assert up["changed_count"] >= 1
    assert up["summary"].strip()
    assert up["k"] is not None and up["p"] is not None
    for r in up["changed_regions"]:
        # Full Schaefer name and network, never a bare "left cortex".
        assert r["name"] and r["name"].lower() != "left cortex"
        assert "before" in r and "after" in r


def test_the_summary_passes_the_banned_phrase_filter(fresh):
    """It is shown to a clinician, so it goes through the same filter as a spoken line."""
    from backend.agent import safety

    pid = fresh
    assert run_call(pid, degrade=0.6)["ok"]
    assert not safety.violations(latest_update(pid)["summary"])


def test_latest_update_serves_the_same_payload(client, fresh):
    """A page that loads after the call must see what a page that was open saw."""
    pid = fresh
    assert run_call(pid, degrade=1.0)["ok"]

    got = client.get(f"/api/patients/{pid}/latest-update")
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["changed_count"] == latest_update(pid)["changed_count"]
    assert body["summary"] == latest_update(pid)["summary"]


def test_a_patient_with_no_calls_has_no_update(client, seeded):
    """Null rather than an invented one."""
    made = client.post("/api/patients", json={"name": "No Calls Yet", "age": 30, "sex": "F"})
    assert made.status_code in (200, 201), made.text
    pid = made.json()["id"]
    got = client.get(f"/api/patients/{pid}/latest-update")
    assert got.status_code == 200
    assert got.json() is None


def test_a_worse_week_moves_more_than_a_better_one(fresh):
    """The degrade knob has to actually drive the measurements, not the result.

    It shifts the week's truth before anything is generated, so the whole pipeline still
    has to measure it back out of frames and audio. If this stops holding, the knob has
    become a way of writing the answer down rather than a way of producing it.
    """
    pid = fresh

    def one(size: float) -> float:
        before = twin_of(pid)
        assert run_call(pid, degrade=size)["ok"]
        week = int(db.patient(pid)["week"] or 0)
        was, now = damage_at(before, week), damage_at(twin_of(pid), week)
        return max((abs(v - was.get(rid, v)) for rid, v in now.items()), default=0.0)

    quiet = one(0.0)
    loud = one(2.0)
    assert loud > quiet, f"a much worse week moved the brain {loud} against {quiet}"


def test_the_mock_generator_does_not_lose_the_face_by_default(fresh):
    """A default call sees a face. Losing it is a scenario, not the starting state.

    One demo patient showed "a face was visible in only 0% of frames" on an ordinary
    call, which reads as a broken camera rather than as the deliberately poor channel it
    was meant to be.
    """
    pid = fresh
    assert run_call(pid)["ok"]
    row = db.one("select * from checkins where patient_id=? order by week desc, rowid desc limit 1", (pid,))
    chan = db.dec(row["channel"], {}) or {}
    assert float(chan.get("face_share", 0)) > 0.5, chan


def test_a_poor_channel_is_still_able_to_be_poor(seeded):
    """The low quality profile keeps its low face share, or the scenario is gone.

    Reads the check-ins the seed already wrote rather than running another call. Running
    one here would advance that patient's week and date a row today, which two tests in
    other files read as a broken history.
    """
    poor = [p for p in seeded if demo.profile_of(str(p["id"])) == "low_quality"]
    if not poor:
        return
    rows = db.rows("select * from checkins where patient_id=?", (str(poor[0]["id"]),))
    shares = [float((db.dec(r["channel"], {}) or {}).get("face_share", 1.0)) for r in rows]
    assert shares, "the low quality patient has no check-ins"
    assert min(shares) < 0.9, shares
    # Poor, but not absent. A zero would be a broken camera, not a poor channel.
    assert min(shares) > 0.0, shares
