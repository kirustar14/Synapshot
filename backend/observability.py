"""Sentry: errors, tracing, profiling and logs for the backend.

Off unless SENTRY_DSN is set, so mock mode and the tests never touch the network.

The one rule this file exists to keep: a call token is the only credential a patient
has, and it travels in the URL path. logs.py already keeps it out of the local logs;
everything here runs the same mask over whatever goes to Sentry, so a token never
leaves this machine in full either.
"""

import logging
import os

from . import logs

_ON = False


def _scrub(obj):
    """Mask call tokens anywhere in a nested event payload."""
    if isinstance(obj, str):
        return logs.mask(obj)
    if isinstance(obj, dict):
        return {k: _scrub(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_scrub(v) for v in obj]
    return obj


def _before_send(event, _hint):
    return _scrub(event)


def _before_send_log(log, _hint):
    return _scrub(log)


def init() -> bool:
    """Start Sentry if a DSN is configured. Safe to call more than once."""
    global _ON
    from . import config  # noqa: F401  loads .env into the environment

    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if _ON or not dsn:
        return _ON
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except ImportError:
        logging.getLogger(__name__).warning("SENTRY_DSN set but sentry-sdk is not installed")
        return False

    from .config import cfg

    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("SENTRY_ENV") or cfg.mode(),
        release=os.environ.get("SENTRY_RELEASE") or None,
        # Patient data: never attach IPs, cookies or request bodies.
        send_default_pii=False,
        # Hackathon volume, so keep every trace and profile.
        traces_sample_rate=float(os.environ.get("SENTRY_TRACES_RATE", "1.0")),
        profile_session_sample_rate=float(os.environ.get("SENTRY_PROFILE_RATE", "1.0")),
        profile_lifecycle="trace",
        enable_logs=True,
        integrations=[
            # Route templates (/api/call/{token}/finish) as transaction names, not raw URLs.
            StarletteIntegration(transaction_style="url"),
            FastApiIntegration(transaction_style="url"),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR,
                               sentry_logs_level=logging.INFO),
        ],
        before_send=_before_send,
        before_send_transaction=_before_send,
        before_send_log=_before_send_log,
    )
    _ON = True
    # Python drops INFO records before any handler sees them unless the logger allows it.
    logging.getLogger("unnamed").setLevel(logging.INFO)
    logging.getLogger("unnamed").info("sentry on, mode=%s", cfg.mode())
    return True


def span(op: str, name: str, **data):
    """A tracing span, or a no-op context manager when Sentry is off."""
    if not _ON:
        from contextlib import nullcontext

        return nullcontext()
    import sentry_sdk

    s = sentry_sdk.start_span(op=op, name=name)
    for k, v in data.items():
        s.set_data(k, v)
    return s


def capture(exc: BaseException) -> None:
    """Report an exception the caller handles itself, so it is not lost silently."""
    if _ON:
        import sentry_sdk

        sentry_sdk.capture_exception(exc)


def tag(key: str, value) -> None:
    """Tag the current scope so issues and traces can be filtered by it."""
    if _ON:
        import sentry_sdk

        sentry_sdk.set_tag(key, value)


# ---------------------------------------------------------------- demo hooks
# Two buttons on the Settings page call these, so the Sentry integration can be shown
# working live: one real handled error, and one traced run with logs on every step.
# Neither touches patient data.

PRODUCTS = ["errors", "tracing", "profiling", "logs", "session replay", "user feedback"]


def status() -> dict:
    """What the backend is sending, for the Settings page."""
    if not _ON:
        return {"on": False, "environment": None, "products": []}
    import sentry_sdk

    client = sentry_sdk.get_client()
    return {
        "on": True,
        "environment": client.options.get("environment"),
        "release": client.options.get("release"),
        "products": [p for p in PRODUCTS if p not in ("session replay", "user feedback")],
    }


def _trace_id() -> str | None:
    import sentry_sdk

    s = sentry_sdk.get_current_span()
    return getattr(s, "trace_id", None) if s else None


class DemoError(RuntimeError):
    """Raised on purpose by the Sentry demo button. Not a real failure."""


def demo_error() -> dict:
    """Raise and capture a handled error with useful context, and say where it went."""
    import sentry_sdk

    log = logging.getLogger("unnamed.sentry_demo")
    with sentry_sdk.new_scope() as scope:
        scope.set_tag("demo", "sentry-button")
        scope.set_context("demo", {"what": "a deliberate error from the Settings page"})
        try:
            with span("demo.step", "parse check-in features"):
                raise DemoError("Synapshot demo: feature parser rejected a check-in (deliberate)")
        except DemoError as exc:
            log.warning("demo error raised on purpose: %s", exc)
            event_id = sentry_sdk.capture_exception(exc)
    return {"event_id": event_id, "trace_id": _trace_id()}


def demo_trace() -> dict:
    """A short run shaped like a check-in, with a span and a log line per step."""
    import random
    import time

    log = logging.getLogger("unnamed.sentry_demo")
    steps = [
        ("call.audio", "decode audio", 0.06),
        ("call.asr", "transcribe speech", 0.18),
        ("features.pipeline", "extract speech, memory and gaze features", 0.12),
        ("twin.enkf", "update the brain twin", 0.09),
        ("db.store", "store the timepoint", 0.03),
    ]
    with span("demo.checkin", "demo check-in run", synthetic=True):
        for op, name, secs in steps:
            with span(op, name, synthetic=True):
                time.sleep(secs * (0.8 + 0.4 * random.random()))
                log.info("demo step done: %s", name)
        log.info("demo check-in finished, drift_z=%.2f", 0.4 + random.random())
    return {"trace_id": _trace_id(), "steps": [s[1] for s in steps]}
