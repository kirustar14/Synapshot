"""The outbound call to the clinic that reads the structured update aloud.

Three transports, tried in order:
  1. The ElevenLabs conversational agent, when an agent id and a phone number id are set.
     The update is handed over as the first message so the agent opens with it.
  2. Twilio TwiML, which says the update twice, slowly, so a human can write it down.
  3. Mock, which logs the script and returns success.

The script passes the banned phrase filter before it is spoken either way. A Twilio trial
account can only call numbers it has verified first.
"""

import json
import urllib.error
import urllib.request

from .. import db
from ..agent import safety
from ..config import cfg

ELEVEN_CALL = "https://api.elevenlabs.io/v1/convai/twilio/outbound-call"
TIMEOUT_S = 30


def allowed(number: str) -> bool:
    """Whether a real call may be placed to this number at all.

    Two gates, and both have to pass. LIVE_CLINIC_CALL must be set on purpose: having
    an API key lying in .env is not permission to ring somebody's phone, and that is
    exactly the mistake this guard exists to stop. The number must also be on
    DEMO_PHONES, which is the same allow list the texts have always respected.
    """
    return cfg.live_clinic_call and cfg.may_text(number)


def available(number: str = "") -> bool:
    """True when any real transport can place the call to this number."""
    number = number or cfg.clinic_number
    if not allowed(number):
        return False
    return eleven_ready() or twilio_ready()


def eleven_ready() -> bool:
    """True when the conversational agent is configured. Not on its own permission."""
    return bool(not cfg.mock_eleven and cfg.eleven_key and cfg.eleven_agent
                and cfg.eleven_phone and cfg.clinic_number)


def twilio_ready() -> bool:
    """True when Twilio is configured. Not on its own permission."""
    return bool(not cfg.mock_twilio and cfg.twilio_sid and cfg.twilio_token
                and cfg.twilio_from and cfg.clinic_number)


def why_mock(number: str = "") -> str:
    """Why a call was logged instead of placed, for make check and the event row."""
    number = number or cfg.clinic_number
    if not cfg.live_clinic_call:
        return "LIVE_CLINIC_CALL is not set, so the call was logged and not dialled"
    if not cfg.may_text(number):
        return "that number is not on DEMO_PHONES, so nothing was dialled"
    if not (eleven_ready() or twilio_ready()):
        return "no call transport is configured"
    return ""


def twiml(text: str) -> str:
    """TwiML that says the update twice, slowly, so a human can write it down."""
    safe = text.replace("&", "and").replace("<", "").replace(">", "")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Say voice="Polly.Joanna">{safe}</Say>'
        '<Pause length="1"/>'
        f'<Say voice="Polly.Joanna">Repeating. {safe}</Say>'
        "</Response>"
    )


def via_eleven(number: str, text: str) -> dict:
    """Place the call through the ElevenLabs conversational agent.

    The endpoint and the body shape were read off this account's own convai API, which
    lists the agent and the phone number id, but an actual outbound call has not been
    placed from here, so this path is untested end to end. See DECISIONS.md.
    """
    body = json.dumps({
        "agent_id": cfg.eleven_agent,
        "agent_phone_number_id": cfg.eleven_phone,
        "to_number": number,
        "conversation_initiation_client_data": {
            "conversation_config_override": {
                "agent": {"first_message": text},
            },
            "dynamic_variables": {"clinician_update": text},
        },
    }).encode()
    req = urllib.request.Request(
        ELEVEN_CALL, data=body,
        headers={"xi-api-key": cfg.eleven_key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            got = json.loads(resp.read() or b"{}")
        return {"ok": True, "how": "elevenlabs", "to": number,
                "sid": got.get("callSid") or got.get("conversation_id")}
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:200]
        except Exception:
            detail = ""
        return {"ok": False, "how": "elevenlabs", "error": f"HTTP {exc.code} {detail}"}
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {"ok": False, "how": "elevenlabs", "error": str(exc)[:200]}


def via_twilio(number: str, text: str) -> dict:
    """Place the call through Twilio, reading the update twice."""
    try:
        from twilio.rest import Client

        client = Client(cfg.twilio_sid, cfg.twilio_token)
        got = client.calls.create(to=number, from_=cfg.twilio_from, twiml=twiml(text))
        return {"ok": True, "how": "twilio", "sid": got.sid, "to": number}
    except Exception as exc:
        return {"ok": False, "how": "twilio", "error": str(exc)[:200], "to": number}


def call(pid: str, text: str, to: str | None = None) -> dict:
    """Place the call, or log it. Always records an event either way."""
    number = to or cfg.clinic_number
    text = safety.clean(text)
    live = available(number)
    db.event(pid, "clinic_call", {"to": number, "text": text, "live": live,
                                  "why_mock": why_mock(number)})

    if not live:
        return {"ok": True, "how": "mock", "to": number, "script": text,
                "why": why_mock(number)}

    tried = []
    if eleven_ready():
        got = via_eleven(number, text)
        if got["ok"]:
            return got
        tried.append(got)
    if twilio_ready():
        got = via_twilio(number, text)
        if got["ok"]:
            return {**got, "tried": tried}
        tried.append(got)
    return {"ok": False, "how": "none", "to": number, "script": text, "tried": tried}
