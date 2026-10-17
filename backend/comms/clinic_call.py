"""Outbound Twilio call to the clinic that reads the structured update aloud.

Mock mode logs the script and returns success. A Twilio trial account can only call
numbers it has verified, which is in the README.
"""

from .. import db
from ..config import cfg


def available() -> bool:
    """True when Twilio is configured and not mocked."""
    return bool(not cfg.mock_twilio and cfg.twilio_sid and cfg.twilio_token and cfg.twilio_from and cfg.clinic_number)


def twiml(text: str) -> str:
    """TwiML that says the update twice, slowly, so a human can write it down."""
    safe = text.replace("&", "and").replace("<", "").replace(">", "")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Say voice="Polly.Joanna">{safe}</Say>'
        "<Pause length=\"1\"/>"
        f'<Say voice="Polly.Joanna">Repeating. {safe}</Say>'
        "</Response>"
    )


def call(pid: str, text: str, to: str | None = None) -> dict:
    """Place the call, or log it in mock mode. Always records an event."""
    number = to or cfg.clinic_number
    db.event(pid, "clinic_call", {"to": number, "text": text, "live": available()})
    if not available():
        return {"ok": True, "how": "mock", "to": number, "script": text}
    try:
        from twilio.rest import Client

        client = Client(cfg.twilio_sid, cfg.twilio_token)
        got = client.calls.create(to=number, from_=cfg.twilio_from, twiml=twiml(text))
        return {"ok": True, "how": "twilio", "sid": got.sid, "to": number}
    except Exception as exc:
        return {"ok": False, "how": "twilio", "error": str(exc), "to": number}
