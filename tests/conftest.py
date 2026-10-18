"""Test setup. Everything is forced into mock mode before the backend is imported.

The env has to be set here, at import time, because `backend.config` resolves every
switch once when it is first imported and the test modules import it transitively.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

os.environ["MOCK_RIG"] = "1"
os.environ["MOCK_LLM"] = "1"
os.environ["MOCK_PHOTON"] = "1"
os.environ["MOCK_TWILIO"] = "1"
# A test run must never be able to ring or text a real person. These three are forced
# because the alternative actually happened: MOCK_ELEVEN did not exist yet, the key
# alone made the clinic call live, and every alert the suite fires placed a real call.
# Setting them here means turning the switches on in .env for a demo cannot leak into
# the tests.
os.environ["MOCK_ELEVEN"] = "1"
# Same reason for CREAO: a test run must never spend credits or reach the real agent.
os.environ["MOCK_CREAO"] = "1"
# And Sentry: a test run must not report its deliberate errors to the real project.
os.environ["SENTRY_DSN"] = ""
os.environ["AUTO_AGENT_PIPELINE"] = "0"
os.environ["LIVE_CLINIC_CALL"] = "0"
os.environ["DEMO_PHONES"] = ""
os.environ["OFFLINE"] = "1"
os.environ["REACH"] = "1"
# A separate database so a test run never touches the demo one. The cache directory is
# shared on purpose: the template bundle and the surrogate table are expensive and the
# same for everybody.
os.environ["DB_PATH"] = "data/test_synapshot.db"

import pytest  # noqa: E402

from backend import db, demo  # noqa: E402
from backend.config import cfg  # noqa: E402


def pytest_sessionstart(session) -> None:
    """Start from an empty test database."""
    del session
    path = Path(cfg.db_path)
    if path.exists():
        path.unlink()


@pytest.fixture(scope="session")
def seeded():
    """The six demo patients, built once for the whole session."""
    db.conn()
    if not db.patients():
        demo.reset(quiet=True)
    return [dict(r) for r in db.patients()]


@pytest.fixture(scope="session")
def client(seeded):
    """A TestClient against the real app, with the demo data in place."""
    from fastapi.testclient import TestClient

    from backend.app import app

    del seeded
    with TestClient(app) as cli:
        yield cli


@pytest.fixture(scope="session")
def cohort():
    """One 50 patient cohort run, shared by the EnKF and population tests."""
    from backend import seed

    return seed.run_cohort(size=50, weeks=12, quiet=True)
