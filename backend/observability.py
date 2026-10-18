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
