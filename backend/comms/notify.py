"""One way out for every text. Tries iMessage, then SMS, then mock, and records which.

Every outbound message in the system goes through `send`. That is the only place the
channel is decided, the only place the DEMO_PHONES allow list is enforced, and the only
place the message bodies live, so there is one thing to read to know what a patient can
possibly receive.

The post-call summary has the clinician sentence appended here, after any model has
finished with the text. A model was once asked to rephrase the whole message and quietly
dropped that sentence, which is the only part that matters when something is going wrong.
"""

from .. import db
from ..agent import safety
from ..agent.summary import SAFETY_CLOSE
from ..config import cfg
from . import photon, sms

KINDS = ["consent", "heads_up", "call_link", "midweek", "post_call", "emergency",
         "low_quality", "missed_call", "withdrawn"]


def phone_of(pid: str) -> str:
    """The number for a patient.

    No synthetic patient has a real number, so the demo falls back to the first entry in
    DEMO_PHONES, which only ever holds numbers of people who agreed to be texted. With
    no DEMO_PHONES there is nothing to send to and everything stays mock.
    """
    row = db.patient(pid)
    if row is not None:
        try:
            got = str(row["phone"] or "")
        except (IndexError, KeyError):
            got = ""
        if got:
            return got
    return cfg.demo_phones[0] if cfg.demo_phones else ""


def first_name(pid: str) -> str:
    """The patient's first name, or a neutral word."""
    row = db.patient(pid)
    name = str(row["name"]) if row is not None else ""
    return name.split()[0] if name else "there"


def body_for(pid: str, kind: str, link: str = "", body: str = "") -> str:
    """The text for one kind of message, already filtered.

    `body` is only used by post_call, which carries the generated summary.
    """
    who = first_name(pid)
    if kind == "consent":
        return (f"Hi {who}, this is the UNNAMED study assistant. Before anything else, "
                f"please read and answer the consent questions here: {link}")
    if kind == "heads_up":
        return (f"Hi {who}, your weekly check-in is due tomorrow. It takes about fourteen "
                "minutes on your phone, somewhere quiet with good light. I will text you "
                "the link. Reply STOP to stop.")
    if kind == "call_link":
        return (f"Hi {who}, here is your check-in for this week: {link} It takes about "
                "fourteen minutes and runs in your browser. Prop your phone up at eye "
                "level with light on your face. Reply STOP to stop.")
    if kind == "midweek":
        return (f"Hi {who}, quick midweek check. On a scale of 0 to 10, how are your "
                "symptoms overall today? Just reply with the number.")
    if kind == "post_call":
        return with_close(body or f"Thanks {who}, that is this week's check-in done.")
    if kind == "emergency":
        return (f"{who}, based on what you told me, please stop and get medical help now. "
                "Call your local emergency number or go to the nearest emergency "
                "department. If someone is with you, tell them now. Your clinician is "
                "being called.")
    if kind == "low_quality":
        return (f"Hi {who}, the camera on that check-in was too dark or too far away to "
                "measure properly. We will try again next week, nothing for you to do.")
    if kind == "missed_call":
        return (f"Hi {who}, we missed you this week. Reply with a day that works and we "
                "will send the link then.")
    if kind == "withdrawn":
        return ("Understood. We have stopped the calls and texts. Your clinician has been "
                "told.")
    raise KeyError(kind)


def with_close(text: str) -> str:
    """The patient summary with the clinician sentence on the end, exactly once.

    Appended here rather than inside the summary so no model ever gets the chance to
    paraphrase it away.
    """
    got = safety.clean(str(text)).strip()
    if SAFETY_CLOSE in got:
        return got
    return f"{got} {SAFETY_CLOSE}"


def send(pid: str, kind: str, link: str = "", body: str = "", to: str = "") -> dict:
    """Send one message. iMessage first, then SMS, then mock, recording the channel.

    Exactly one row goes in the messages table, written here once the channel is known,
    so a fallback chain cannot leave the thread showing the same text three times.
    """
    if kind not in KINDS:
        raise KeyError(kind)
    text = safety.clean(body_for(pid, kind, link=link, body=body))
    number = to or phone_of(pid)

    im = photon.send(number, text)
    if im.get("ok") and im.get("channel") == "imessage":
        db.message(pid, "out", text, channel="imessage", kind=kind)
        db.event(pid, "notify", {"kind": kind, "channel": "imessage"})
        return {**im, "kind": kind, "body": text}

    txt = sms.send(number, text)
    if txt.get("ok") and txt.get("channel") == "sms":
        db.message(pid, "out", text, channel="sms", kind=kind)
        db.event(pid, "notify", {"kind": kind, "channel": "sms",
                                 "imessage_error": im.get("error")})
        return {**txt, "kind": kind, "body": text, "imessage_error": im.get("error")}

    # Neither real transport carried it, so the row says mock and the UI says mock.
    db.message(pid, "out", text, channel="mock", kind=kind)
    db.event(pid, "notify", {"kind": kind, "channel": "mock",
                             "imessage_error": im.get("error"), "sms_error": txt.get("error")})
    return {"ok": True, "channel": "mock", "kind": kind, "to": number, "body": text,
            "imessage_error": im.get("error"), "sms_error": txt.get("error")}


def status() -> dict:
    """Which transports are live, for make check and the demo console."""
    return {
        "imessage": photon.available(),
        "sms": sms.available(),
        "sidecar": photon.docs(),
        "allow_list": len(cfg.demo_phones),
        "note": "A message is only ever labelled imessage when a real iMessage transport "
                "reported success. Otherwise the row says sms or mock.",
    }
