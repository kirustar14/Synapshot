"""An unreachable DATABASE_URL must fall back to sqlite instead of taking the app down."""

from backend import db, tiger
from backend.config import cfg


def test_an_unreachable_database_url_falls_back_to_sqlite(monkeypatch):
    db.close()
    # Port 1 on localhost refuses at once, so this needs no network and is not slow.
    monkeypatch.setattr(cfg, "database_url", "postgres://u:secretpw@127.0.0.1:1/tsdb?sslmode=disable")
    try:
        assert db.is_pg() is False
        assert db.dialect() == "sqlite"
        assert db.pg_error(), "a fallback must say why"
        assert "secretpw" not in db.pg_error() and "127.0.0.1:1" not in db.pg_error().replace("[url]", "")
        got = tiger.stats()
        assert got["dialect"] == "sqlite" and got["fallback"]
        assert db.one("select 1 as one")["one"] == 1, "queries still work on the fallback"
    finally:
        monkeypatch.setattr(cfg, "database_url", "")
        db.close()


def test_no_database_url_means_sqlite_with_no_probe(monkeypatch):
    db.close()
    monkeypatch.setattr(cfg, "database_url", "")
    assert db.is_pg() is False and db.pg_error() == ""
