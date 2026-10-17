"""Photon iMessage agent wrapper. Mock mode writes to the messages table instead.

The real SDK is looked up at runtime under a few plausible names, because the hackpack
version is whatever is installed on the day. Nothing here raises if it is absent.
"""

import json
import re
import urllib.error
import urllib.request

from .. import db
from ..config import cfg

HANDLERS: list = []


def available() -> bool:
    """True when a real Photon transport is configured."""
    return bool(not cfg.mock_photon and (cfg.photon_key or cfg.photon_url))


MODULES = ["photon", "photon_sdk", "photonsdk", "photon_messages"]
CLASSES = ["Client", "Photon", "PhotonClient", "Agent"]
SENDERS = ["send_message", "send_text", "send", "message", "imessage"]


def _sdk():
    """The Photon client object, or None.

    The hackpack SDK is whatever version is installed on the day, so the class and the
    send method are discovered by introspection rather than hard coded.
    """
    for mod in MODULES:
        try:
            got = __import__(mod, fromlist=["*"])
        except Exception:
            continue
        for attr in CLASSES:
            cls = getattr(got, attr, None)
            if cls is None:
                continue
            for kwargs in ({"api_key": cfg.photon_key}, {"token": cfg.photon_key}, {}):
                try:
                    return cls(**kwargs)
                except Exception:
                    continue
    return None


def _send_via(client, to: str, body: str) -> bool:
    """Call whichever send method the installed SDK actually exposes."""
    for name in SENDERS:
        fn = getattr(client, name, None)
        if not callable(fn):
            continue
        for args, kwargs in (((), {"to": to, "body": body}), ((), {"to": to, "text": body}),
                             ((to, body), {}), ((), {"recipient": to, "message": body})):
            try:
                fn(*args, **kwargs)
                return True
            except TypeError:
                continue
            except Exception:
                return False
    return False


def docs() -> dict:
    """What the installed SDK looks like, for the preflight and the README."""
    client = _sdk()
    if client is None:
        return {"installed": False, "methods": [], "doc": ""}
    methods = [n for n in dir(client) if not n.startswith("_") and callable(getattr(client, n, None))]
    return {
        "installed": True,
        "klass": type(client).__name__,
        "methods": methods,
        "senders": [n for n in SENDERS if n in methods],
        "doc": (type(client).__doc__ or "").strip()[:400],
    }


def send(to: str, body: str, pid: str | None = None) -> dict:
    """Send an iMessage. Always logs to the messages table so the UI can show it."""
    if pid:
        db.message(pid, "out", body)
    if not available():
        return {"ok": True, "how": "mock", "to": to, "body": body}

    client = _sdk()
    if client is not None:
        if _send_via(client, to, body):
            return {"ok": True, "how": "sdk", "to": to}
        return {"ok": False, "how": "sdk", "error": "no usable send method on the installed SDK"}

    if cfg.photon_url:
        req = urllib.request.Request(
            cfg.photon_url.rstrip("/") + "/messages",
            data=json.dumps({"to": to, "body": body}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {cfg.photon_key}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return {"ok": resp.status < 300, "how": "http", "to": to}
        except (urllib.error.URLError, TimeoutError) as exc:
            return {"ok": False, "how": "http", "error": str(exc)}
    return {"ok": False, "how": "none", "error": "no transport"}


def on_message(handler) -> None:
    """Register a handler called with (pid, body) for every incoming reply."""
    HANDLERS.append(handler)


def incoming(pid: str, body: str) -> dict:
    """Handle a reply: log it, parse a symptom score, honour STOP, run handlers."""
    db.message(pid, "in", body)
    out = {"pid": pid, "body": body, "score": None, "stopped": False}

    if body.strip().upper() == "STOP":
        row = db.consent_for(pid)
        if row:
            db.patch("consents", row["token"], {"withdrawn": 1, "calls": 0, "ai": 0, "recording": 0, "genetic": 0}, key="token")
        db.event(pid, "consent_withdrawn", {"via": "imessage"})
        send("", "Understood. We have stopped the calls and texts. Your clinician has been told.", pid)
        out["stopped"] = True
        return out

    hit = re.search(r"\b(10|[0-9])\b", body)
    if hit:
        score = int(hit.group(1))
        out["score"] = score
        db.event(pid, "midweek_symptom", {"score": score, "body": body})
    for fn in HANDLERS:
        try:
            fn(pid, body)
        except Exception:
            continue
    return out


def consent_request(pid: str, name: str, token: str, to: str = "") -> dict:
    """Ask for consent with a link to the consent page."""
    link = f"{cfg.api_base}/consent/{token}"
    return send(to, f"Hi {name.split()[0]}, this is the UNNAMED study assistant. Before anything else, please read and answer four consent questions here: {link}", pid)


def heads_up(pid: str, name: str, when: str = "tomorrow at 10am", to: str = "") -> dict:
    """Tell the patient a call is coming."""
    return send(to, f"Hi {name.split()[0]}, your weekly check-in call is {when}. It takes about 14 minutes. Somewhere quiet with good light works best. Reply STOP to stop.", pid)


def midweek_check(pid: str, name: str, to: str = "") -> dict:
    """Midweek symptom check, reply parsed 0 to 10."""
    return send(to, f"Hi {name.split()[0]}, quick midweek check. On a scale of 0 to 10, how are your symptoms overall today? Just reply with the number.", pid)


def midweek_due(pid: str, days: int = 3) -> bool:
    """True when the patient is due a midweek check: no outbound text for `days` days."""
    import datetime as dt

    rows = [m for m in db.messages(pid) if m["dir"] == "out"]
    if not rows:
        return True
    try:
        last = dt.datetime.fromisoformat(str(rows[-1]["time"]))
    except ValueError:
        return True
    return (dt.datetime.now() - last).days >= days


def run_midweek(days: int = 3) -> list[dict]:
    """Text every consented patient who is due a midweek symptom check."""
    out = []
    for row in db.patients():
        con = db.consent_for(row["id"])
        if con is None or int(con["withdrawn"] or 0) or not int(con["calls"] or 0):
            continue
        if midweek_due(row["id"], days):
            got = midweek_check(row["id"], str(row["name"]))
            out.append({"patient_id": row["id"], "ok": got.get("ok", False)})
    return out


def post_call(pid: str, name: str, body: str, to: str = "") -> dict:
    """Send the plain language summary after a call."""
    return send(to, body, pid)


def emergency(pid: str, name: str, to: str = "") -> dict:
    """Red flag text. Says to get help now and nothing else."""
    return send(
        to,
        f"{name.split()[0]}, based on what you told me, please stop the call and get medical help now. "
        "Call your local emergency number or go to the nearest emergency department. "
        "If someone is with you, tell them now. Your clinician is being called.",
        pid,
    )
