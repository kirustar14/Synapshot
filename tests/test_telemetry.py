"""Local telemetry buffering and SQLite dashboard reads."""

from backend import db, telemetry
from backend.config import cfg


def _session(client, pid):
    got = client.post("/api/calls", json={"patient_id": pid, "send": False})
    assert got.status_code == 200, got.text
    return got.json()["token"]


def test_telemetry_buffers_then_writes(client, seeded):
    """One batch, the right columns, and nothing lost."""
    pid = str(seeded[0]["id"])
    token = _session(client, pid)
    pending_before = telemetry.pending()
    before = db.count("select count(*) as c from metric_samples")
    telemetry.add(token, pid, "fps", 29.5)
    telemetry.add(token, pid, "face", 1.0)
    assert telemetry.pending() >= pending_before + 2
    wrote = telemetry.flush(token)
    assert wrote >= 2
    assert telemetry.pending() == pending_before
    after = db.count("select count(*) as c from metric_samples")
    assert after >= before + wrote
    row = db.one("select metric, value from metric_samples where session_token=? order by time desc",
                 (token,))
    assert row is not None
    assert str(row["metric"]) in ("fps", "face")


def test_the_live_route_feeds_the_metric_table(client, seeded):
    """A live post is projected into fps, flags and gaze error without a second request."""
    pid = str(seeded[0]["id"])
    token = _session(client, pid)
    body = {
        "t": 120.0,
        "gaze": {"x": 0.55, "y": 0.45},
        "target": {"x": 0.5, "y": 0.5},
        "quality": {"face": True, "dist": True, "light": True, "fps": 30.0},
        "pursuit_gain": 0.81,
        "step": "pursuit_h",
    }
    got = client.post(f"/api/call/{token}/live", json=body)
    assert got.status_code == 200, got.text
    telemetry.flush(token)
    names = {str(r["metric"]) for r in db.rows(
        "select metric from metric_samples where session_token=?", (token,))}
    assert {"fps", "face", "dist", "light", "gaze_err", "pursuit_gain"} <= names


def test_pulse_uses_local_sqlite(client, seeded):
    """The response says sqlite and still has a series, a total and a guarded stats block."""
    pid = str(seeded[0]["id"])
    token = _session(client, pid)
    telemetry.add(token, pid, "fps", 28.0)
    telemetry.flush(token)
    got = telemetry.pulse()
    assert got["source"] == "sqlite"
    assert got["error"] == ""
    assert got["minutes"], "the demo still draws a chart with no external database"
    assert any("fps" in bucket for bucket in got["minutes"])
    assert got["totals"]["samples"] >= 1
    assert "tiger" not in got


def test_the_pulse_route_is_scoped_and_returns_the_same_shape(client):
    """The HTTP projection is the same object the helper returns."""
    got = client.get("/api/pulse?minutes=30&hours=6")
    assert got.status_code == 200
    body = got.json()
    for key in ("source", "minutes", "hourly", "totals"):
        assert key in body
    assert body["window"] == {"minutes": 30, "hours": 6}


def test_now_is_ordered_inside_one_second():
    """Microseconds, because the old second granularity tied on a rebuild."""
    a = db.now()
    b = db.now()
    assert a <= b
    assert len(a.split(".")[-1]) == 6
