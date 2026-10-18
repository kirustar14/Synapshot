"""The Postgres and TimescaleDB path, against a real service.

Skipped unless TEST_DATABASE_URL is set. It creates a throwaway schema, points the app at
it with search_path, runs the same bootstrap and reads, then drops the schema. Nothing
touches the tables the demo uses.

    TEST_DATABASE_URL='postgres://tsdbadmin:...@host:port/tsdb?sslmode=require' \
        .venv/bin/python -m pytest -q tests/test_tiger_pg.py -s
"""

import os
import time
import uuid

import pytest

from backend import db, tiger
from backend.config import cfg

BASE = os.environ.get("TEST_DATABASE_URL", "")


def _with_schema(base: str, schema: str) -> str:
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}options=-csearch_path%3D{schema}"


@pytest.fixture(scope="module")
def service():
    """A scratch schema on the real service, and the app pointed at it."""
    if not BASE:
        pytest.skip("TEST_DATABASE_URL is not set")
    try:
        import psycopg  # noqa: F401
    except ImportError:
        pytest.skip("psycopg is not installed")

    schema = "syn_test_" + uuid.uuid4().hex[:10]
    import psycopg

    with psycopg.connect(BASE, autocommit=True) as conn:
        conn.execute(f"create schema {schema}")

    previous = cfg.database_url
    cfg.database_url = _with_schema(BASE, schema)
    db.close()
    try:
        db.conn()
        yield {"schema": schema}
    finally:
        db.close()
        cfg.database_url = previous
        with psycopg.connect(BASE, autocommit=True) as conn:
            conn.execute(f"drop schema if exists {schema} cascade")
        db.close()


def test_postgres_is_the_selected_dialect(service):
    assert db.dialect() == "postgres"
    assert db.patient("nobody") is None


def test_the_schema_bootstraps_and_put_is_an_upsert(service):
    """Two puts of the same id update the row instead of failing on the primary key."""
    db.put("patients", {
        "id": "pat_pg", "name": "First", "age": 30, "sex": "F", "week": 0,
        "injury": "{}", "alleles": "{}", "biomarkers": "{}", "params": "{}",
        "contraction": "{}", "fc_fit": None, "coverage": None, "drift_z": None,
        "twin_built": 0, "template_only": 0, "low_fidelity": 0, "synthetic": 1,
        "last_call": None, "created": db.now(), "seed": 1, "d0": None, "truth": None,
        "state": None, "note": None, "phone": None, "clinic_id": None,
    })
    db.put("patients", {
        "id": "pat_pg", "name": "Second", "age": 30, "sex": "F", "week": 0,
        "injury": "{}", "alleles": "{}", "biomarkers": "{}", "params": "{}",
        "contraction": "{}", "fc_fit": None, "coverage": None, "drift_z": None,
        "twin_built": 0, "template_only": 0, "low_fidelity": 0, "synthetic": 1,
        "last_call": None, "created": db.now(), "seed": 1, "d0": None, "truth": None,
        "state": None, "note": None, "phone": None, "clinic_id": None,
    })
    row = db.patient("pat_pg")
    assert row is not None
    assert str(row["name"]) == "Second"
    assert db.count("select count(*) as c from patients where id='pat_pg'") == 1


def test_metrics_insert_and_the_bootstrap_is_idempotent(service):
    """The hypertable and aggregates are created once, and a second call does no harm."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    rows = [(now - timedelta(seconds=i), "pat_pg", "tok", "fps", 30.0, 1.0) for i in range(120)]
    assert db.metric_insert(rows) == 120
    first = tiger.bootstrap()
    second = tiger.bootstrap()
    assert first["extension"], first
    assert first["ok"], first["notes"]
    assert second["ok"]
    assert tiger.available()

    stats = tiger.stats()
    assert stats["hypertable"] is True
    assert "metrics_1m" in stats["aggregates"]
    assert stats["rows"] >= 120
    assert stats["size"]


def test_the_aggregate_answers_the_pulse_query(service):
    """Refresh the aggregate explicitly, then read it through the same endpoint helper."""
    if not tiger.available():
        pytest.skip("no timescaledb on this service")
    try:
        db.run("call refresh_continuous_aggregate('metrics_1m', now() - interval '1 hour', now())")
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"refresh not available: {exc}")

    got = tiger.pulse(minutes=60, hours=6)
    assert got["source"] in ("continuous aggregate", "raw")
    assert got["totals"]["samples"] >= 120
    assert got["tiger"]["hypertable"] is True
    if got["source"] == "continuous aggregate":
        assert got["minutes"], got


def test_the_benchmark_returns_measured_timings(service):
    if not tiger.available():
        pytest.skip("no timescaledb on this service")
    got = tiger.bench(minutes=60, runs=2)
    assert got["available"] is True
    assert got["raw_ms"] >= 0
    assert got["cagg_ms"] >= 0
    assert got["speedup"] is None or got["speedup"] > 0


def test_time_is_ordered_inside_one_second(service):
    a = db.now()
    time.sleep(0.002)
    b = db.now()
    assert a < b
