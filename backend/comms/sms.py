"""Twilio SMS, the fallback when iMessage is not available.

Same interface as photon.send, and it labels itself `sms` rather than `imessage`. That
distinction matters: an SMS lands in the Messages app looking much the same, and calling
it iMessage when it was not would be a lie the UI then repeats.
"""

from .. import db
from ..config import cfg


def available() -> bool:
    """True when Twilio is configured for SMS and not mocked."""
    return bool(not cfg.mock_twilio and cfg.twilio_sid and cfg.twilio_token and cfg.twilio_from)


def send(to: str, body: str, pid: str | None = None, kind: str = "") -> dict:
    """Send one SMS. Nothing goes to a number outside DEMO_PHONES."""
    if not available():
        if pid:
            db.message(pid, "out", body, channel="mock", kind=kind)
        return {"ok": True, "channel": "mock", "how": "mock", "to": to}

    if not to:
        return {"ok": False, "channel": "none", "error": "no number to send to"}
    if not cfg.may_text(to):
        return {"ok": False, "channel": "none",
                "error": "that number is not in DEMO_PHONES, so nothing was sent"}

    try:
        from twilio.rest import Client

        client = Client(cfg.twilio_sid, cfg.twilio_token)
        got = client.messages.create(to=to, from_=cfg.twilio_from, body=body)
    except Exception as exc:
        return {"ok": False, "channel": "none", "how": "twilio", "error": str(exc)[:300]}

    if pid:
        db.message(pid, "out", body, channel="sms", kind=kind)
    return {"ok": True, "channel": "sms", "how": "twilio", "sid": got.sid, "to": to}
