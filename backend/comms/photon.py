"""iMessage through the Node sidecar. Mock mode records the message and sends nothing.

The iMessage SDKs are TypeScript only, so the actual send happens in
`backend/comms/node/send.mjs` and this module is the thin Python side of it. The sidecar
tries Spectrum Cloud first and the local Messages app second, and reports which one
worked so the UI can say iMessage honestly rather than guessing.

Accepted is not delivered. A send comes back with a provider message id and the status
`sent`; `delivery()` polls that id and only returns `delivered` when the provider says
so. Nothing in this file ever reports delivery it has not been told about.

Credentials are handed over in the child's environment, never on its command line.
"""

import json
import subprocess
from pathlib import Path

from .. import db
from ..config import cfg

HERE = Path(__file__).resolve().parent
SIDECAR = HERE / "node" / "send.mjs"
TIMEOUT_S = 45
HANDLERS: list = []


def available() -> bool:
    """True when a real iMessage transport is configured and not mocked."""
    if cfg.mock_photon:
        return False
    return bool(cfg.photon_project and cfg.photon_secret) or bool(cfg.photon_key or cfg.photon_url)


def _env() -> dict:
    """The child environment: the credentials and nothing else that matters."""
    import os

    out = dict(os.environ)
    out["PHOTON_PROJECT_ID"] = cfg.photon_project
    out["PHOTON_PROJECT_SECRET"] = cfg.photon_secret
    return out


def _run(job: dict, args: list[str] | None = None) -> dict:
    """Run the sidecar once and read its one line of JSON."""
    if not SIDECAR.exists():
        return {"ok": False, "error": "the sidecar is missing at backend/comms/node/send.mjs"}
    cmd = ["node", str(SIDECAR), *(args or [])]
    try:
        got = subprocess.run(cmd, input=json.dumps(job), capture_output=True, text=True,
                             timeout=TIMEOUT_S, env=_env(), check=False, cwd=str(HERE / "node"))
    except FileNotFoundError:
        return {"ok": False, "error": "node is not installed, so iMessage cannot be used"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"the sidecar did not answer in {TIMEOUT_S} s"}
    line = (got.stdout or "").strip().splitlines()
    if not line:
        return {"ok": False, "error": (got.stderr or "the sidecar said nothing").strip()[:300]}
    try:
        return json.loads(line[-1])
    except ValueError:
        return {"ok": False, "error": "the sidecar did not return JSON"}


def docs() -> dict:
    """What the sidecar can actually do here, for make check and the preflight."""
    if not SIDECAR.exists():
        return {"installed": False, "reason": "sidecar missing"}
    got = _run({}, ["--probe"])
    return {
        "installed": bool(got.get("cloud") or got.get("local")),
        "cloud": bool(got.get("cloud")),
        "local": bool(got.get("local")),
        "credentials": bool(got.get("credentials")),
        "platform": got.get("platform"),
        "node": got.get("node"),
        "hint": "cd backend/comms/node && npm install   enables the real transports",
    }


def send(to: str, body: str, pid: str | None = None, kind: str = "") -> dict:
    """Send one iMessage. Returns the channel that actually carried it.

    Nothing is sent to a number outside DEMO_PHONES, and `channel` is only ever
    "imessage" when a real iMessage transport reported success.
    """
    if not available():
        if pid:
            db.message(pid, "out", body, channel="mock", kind=kind)
        return {"ok": True, "channel": "mock", "how": "mock", "to": to}

    if not to:
        return {"ok": False, "channel": "none", "error": "no number to send to"}
    if not cfg.may_text(to):
        return {"ok": False, "channel": "none",
                "error": "that number is not in DEMO_PHONES, so nothing was sent"}

    got = _run({"to": to, "body": body})
    if got.get("ok"):
        if pid:
            db.message(pid, "out", body, channel="imessage", kind=kind, status="sent",
                       provider_id=str(got.get("id") or ""),
                       space_id=str(got.get("space") or ""))
        return {"ok": True, "channel": "imessage", "how": got.get("how"), "to": to,
                "status": "sent", "id": got.get("id", ""), "space": got.get("space", "")}
    return {"ok": False, "channel": "none", "how": got.get("how"),
            "status": "failed",
            "error": str(got.get("error") or "the sidecar failed")[:300],
            "why": str(got.get("why") or "")[:300],
            "tried": got.get("tried", [])}


def delivery(how: str, space: str, mid: str) -> dict:
    """Ask the provider whether one sent message actually arrived.

    Three answers, and the difference matters: `delivered` means the provider said so,
    `sent` means it was accepted and nothing has confirmed it, and `unknown` means the
    question could not be asked. The UI shows all three differently and never upgrades
    `sent` to `delivered` on its own.
    """
    if not available():
        return {"ok": True, "status": "mock"}
    if not mid:
        return {"ok": True, "status": "sent", "note": "the provider returned no message id"}
    got = _run({"how": how or "cloud", "space": space, "id": mid}, ["--status"])
    if not got.get("ok"):
        return {"ok": False, "status": "unknown", "error": str(got.get("error") or "")[:300]}
    return {"ok": True, "status": str(got.get("status") or "sent"),
            "delivered": bool(got.get("delivered"))}


def on_message(handler) -> None:
    """Register a handler called with (pid, body) for every incoming reply."""
    HANDLERS.append(handler)


def incoming(pid: str, body: str, channel: str = "") -> dict:
    """Handle a reply: log it, parse a symptom score, honour STOP, run the handlers.

    The channel is only called imessage when a real iMessage transport is live, the same
    rule the outbound side follows. An inbound row in mock mode says mock.
    """
    import re

    if channel not in ("imessage", "sms", "mock"):
        channel = "imessage" if available() else "mock"
    db.message(pid, "in", body, channel=channel, kind="reply")
    out = {"pid": pid, "body": body, "score": None, "stopped": False, "channel": channel}

    if body.strip().upper() == "STOP":
        row = db.consent_for(pid)
        if row:
            db.patch("consents", row["token"],
                     {"withdrawn": 1, "calls": 0, "ai": 0, "recording": 0, "genetic": 0},
                     key="token")
        db.event(pid, "consent_withdrawn", {"via": "imessage"})
        from . import notify

        notify.send(pid, "withdrawn")
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
    from . import notify

    out = []
    for row in db.patients():
        con = db.consent_for(row["id"])
        if con is None or int(con["withdrawn"] or 0) or not int(con["calls"] or 0):
            continue
        if midweek_due(row["id"], days):
            got = notify.send(row["id"], "midweek")
            out.append({"patient_id": row["id"], "ok": got.get("ok", False),
                        "channel": got.get("channel")})
    return out
